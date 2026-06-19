import {
  applyMatchRewards,
  createSupabaseServerClient,
  emitUserProgressEvent,
  persistMatchHistory,
  recordPvpWin,
  type ApplyMatchRewardsInput,
  type EmitUserEventInput,
  type MatchHistoryRow
} from "@twcardgame/db";
import { toPublicState, type MatchState } from "@twcardgame/rules";
import {
  calculatePvPExp,
  calculatePvPGold,
  SEATS,
  type AiDifficulty,
  type AiTheme,
  type GameEvent,
  type RewardSummary,
  type Seat
} from "@twcardgame/shared";

/**
 * Match finalization side-effects — the Durable Object port of
 * apps/server/src/{persistence,rewards,taskEvents,matchFinalizer}.ts. This is
 * lifecycle/persistence plumbing, NOT deterministic gameplay, so it lives in
 * apps/realtime rather than packages/rules — exactly the boundary the migration
 * preserves. The behaviour (XP/gold math, history row, quest events) is a faithful
 * port; only the env plumbing changes (Worker `env` binding instead of
 * `process.env`).
 *
 * It is env-gated: with `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` set on the
 * Worker it performs the real Supabase writes; without them it returns
 * server-authoritative zero-value reward summaries so the client still shows a
 * result screen (replacing the web client's 800ms fabricated fallback).
 */

export interface RealtimeEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

/** Per-match context the room records server-side (mirrors MatchPersistenceMetadata). */
export interface MatchMetadata {
  isVsAi: boolean;
  aiDifficulty?: AiDifficulty;
  aiTheme?: AiTheme;
  /** Wall-clock match start (ms) so history can show real duration. */
  startedAtMs?: number;
  /**
   * Localhost dev-test match: the DO skips all finalize side-effects
   * (persistence + rewards + reward_summary), mirroring the server's
   * `shouldPersistMatchSideEffects() === false` branch.
   */
  devTest?: boolean;
}

export interface MatchLogger {
  warn(event: string, fields?: Record<string, unknown>): void;
}

const consoleLogger: MatchLogger = {
  warn: (event, fields) => console.warn(event, fields ?? {})
};

type SupabaseClient = ReturnType<typeof createSupabaseServerClient>;
type ApplyRewardsResult = Omit<RewardSummary, "result"> & { idempotent: boolean };
type ApplyRewardsFn = (input: ApplyMatchRewardsInput) => Promise<ApplyRewardsResult>;
type EmitEventFn = (input: EmitUserEventInput) => Promise<void>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Port of rewards.isHumanUser: only real (UUID) accounts earn/persist anything. */
export function isHumanUser(userId: string | undefined | null): userId is string {
  return typeof userId === "string" && UUID_PATTERN.test(userId);
}

export interface MatchServices {
  /** True when wired to a real Supabase backend (vs the dev no-op). */
  readonly persistsRemotely: boolean;
  /**
   * Persist history, grant rewards, and emit quest events ONCE for a finished
   * match. Returns the per-seat {@link RewardSummary} the room delivers to each
   * client as a `reward_summary` message (mirrors GameRoom.finalizeAndReward).
   */
  finalize(state: MatchState, metadata: MatchMetadata): Promise<Map<Seat, RewardSummary>>;
}

/** Env-gated factory (port of the server's createXFromEnv trio, unified). */
export function createMatchServices(env: RealtimeEnv, logger: MatchLogger = consoleLogger): MatchServices {
  const url = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return createLocalMatchServices();
  const client = createSupabaseServerClient({ url, serviceRoleKey });
  return createSupabaseMatchServices(client, logger);
}

/**
 * No backend: emit zero-value summaries (diagnostic `rewards_disabled`) so the
 * client still renders a result screen authoritatively from the server.
 */
export function createLocalMatchServices(): MatchServices {
  return {
    persistsRemotely: false,
    finalize: async (state, metadata) => buildLocalSummaries(state, metadata, "rewards_disabled")
  };
}

/** Supabase-backed services. Persist first, then reward, then quest events (order matters). */
export function createSupabaseMatchServices(client: SupabaseClient, logger: MatchLogger = consoleLogger): MatchServices {
  const persisted = new Set<string>();
  const apply: ApplyRewardsFn = (input) => applyMatchRewards(client, input);
  const emit: EmitEventFn = (input) => emitUserProgressEvent(client, input);
  return {
    persistsRemotely: true,
    finalize: async (state, metadata) => {
      // Persist first so the match_history row exists before reward events
      // reference it (the RPC uses match_id as source_id in user_events).
      if (!persisted.has(state.matchId)) {
        persisted.add(state.matchId);
        try {
          await persistMatchHistory(client, buildMatchHistoryRow(state, new Date(), metadata));
          if (!metadata.isVsAi && state.result?.winnerSeat) await recordPvpWin(client, state.matchId);
        } catch (error) {
          logger.warn("match.persist.failed", { matchId: state.matchId, error: String(error) });
        }
      }

      let summaries: Map<Seat, RewardSummary>;
      try {
        summaries = await grantForMatch(apply, state, metadata, logger);
      } catch (error) {
        logger.warn("match.rewards.dispatch_failed", { matchId: state.matchId, error: String(error) });
        summaries = buildLocalSummaries(state, metadata, "rpc_failed");
      }

      // Emit task/achievement progress after rewards, isolated so a failure never
      // blocks reward delivery (mirrors GameRoom.finalizeAndReward).
      try {
        await emitTaskEvents(emit, state, metadata, logger);
      } catch (error) {
        logger.warn("match.taskEvents.failed", { matchId: state.matchId, error: String(error) });
      }

      return summaries;
    }
  };
}

/* --------------------------------- rewards (port of rewards.ts) --------------------------------- */

/** Port of createMatchRewardsWithClient.grantForMatch. `apply` is injected for testability. */
export async function grantForMatch(
  apply: ApplyRewardsFn,
  state: MatchState,
  metadata: MatchMetadata,
  logger: MatchLogger = consoleLogger
): Promise<Map<Seat, RewardSummary>> {
  const summaries = new Map<Seat, RewardSummary>();
  const winnerSeat = state.result?.winnerSeat;
  const mode: "pvp" | "pve" = metadata.isVsAi ? "pve" : "pvp";

  // Pre-compute PvP gold for both players when there is a winner.
  let pvpGoldByResult: { winnerGold: number; loserGold: number } | undefined;
  if (mode === "pvp" && winnerSeat) {
    const winner = state.players[winnerSeat];
    const loserSeat = winnerSeat === "player1" ? "player2" : "player1";
    const loser = state.players[loserSeat];
    pvpGoldByResult = calculatePvPGold(winner.hero.hp, loser.hero.hp, state.turn.number);
  }

  for (const seat of SEATS) {
    const player = state.players[seat];
    const isWinner = seat === winnerSeat;
    if (!isHumanUser(player.userId)) {
      summaries.set(seat, zeroSummary(metadata, seat, winnerSeat));
      continue;
    }
    // PvE: only the winner gets rewards.
    if (mode === "pve" && !isWinner) {
      summaries.set(seat, zeroSummary(metadata, seat, winnerSeat));
      continue;
    }

    const pvpGold =
      mode === "pvp" && pvpGoldByResult ? (isWinner ? pvpGoldByResult.winnerGold : pvpGoldByResult.loserGold) : 0;

    try {
      const payload = await apply({
        userId: player.userId,
        matchId: state.matchId,
        mode,
        aiTheme: metadata.aiTheme ?? null,
        aiDifficulty: metadata.aiDifficulty ?? null,
        pvpXp: mode === "pvp" && isWinner ? calculatePvPExp(player.hero.hp, state.turn.number) : 0,
        pvpGold
      });
      summaries.set(seat, { result: isWinner ? "win" : "loss", ...payload });
    } catch (error) {
      logger.warn("match.rewards.failed", { matchId: state.matchId, userId: player.userId, error: String(error) });
      summaries.set(seat, zeroSummary(metadata, seat, winnerSeat, "rpc_failed"));
    }
  }

  return summaries;
}

function zeroSummary(
  metadata: MatchMetadata,
  seat: Seat,
  winnerSeat: Seat | undefined,
  diagnostic?: RewardSummary["diagnostic"]
): RewardSummary {
  const isWin = seat === winnerSeat;
  return {
    result: isWin ? "win" : "loss",
    mode: metadata.isVsAi ? "pve" : "pvp",
    source: "none",
    ...(diagnostic && isWin ? { diagnostic } : {}),
    aiTheme: metadata.aiTheme ?? null,
    aiDifficulty: metadata.aiDifficulty ?? null,
    xp: { before: 0, after: 0, gained: 0 },
    level: { before: 1, after: 1 },
    levelUps: [],
    gold: { before: 0, after: 0, gained: 0, breakdown: {} }
  };
}

function buildLocalSummaries(
  state: MatchState,
  metadata: MatchMetadata,
  diagnostic: RewardSummary["diagnostic"]
): Map<Seat, RewardSummary> {
  const map = new Map<Seat, RewardSummary>();
  const winner = state.result?.winnerSeat;
  for (const seat of SEATS) map.set(seat, zeroSummary(metadata, seat, winner, diagnostic));
  return map;
}

/* --------------------------------- persistence (port of persistence.ts) --------------------------------- */

export function buildMatchHistoryRow(state: MatchState, finishedAt: Date, metadata: MatchMetadata): MatchHistoryRow {
  return {
    id: state.matchId,
    card_catalog_version: state.cardCatalogVersion,
    player1_user_id: uuidOrNull(state.players.player1.userId),
    player2_user_id: uuidOrNull(state.players.player2.userId),
    winner_seat: state.result?.winnerSeat,
    result_reason: state.result?.reason ?? "abandoned",
    final_state: toPublicState(state),
    is_vs_ai: metadata.isVsAi,
    ai_difficulty: metadata.aiDifficulty ?? null,
    ai_theme: metadata.aiTheme ?? null,
    created_at: metadata.startedAtMs ? new Date(metadata.startedAtMs).toISOString() : undefined,
    finished_at: finishedAt.toISOString()
  };
}

function uuidOrNull(value: string): string | null {
  return UUID_PATTERN.test(value) ? value : null;
}

/* --------------------------------- task / quest events (port of taskEvents.ts) --------------------------------- */

/** Port of createTaskEventsWithEmit.emitForMatch. `emit` is injected for testability. */
export async function emitTaskEvents(
  emit: EmitEventFn,
  state: MatchState,
  metadata: MatchMetadata,
  logger: MatchLogger = consoleLogger
): Promise<void> {
  const mode: "pvp" | "pve" = metadata.isVsAi ? "pve" : "pvp";
  const winnerSeat = state.result?.winnerSeat;
  const stats = aggregateMatchStats(state.private.eventLog);
  const sourceId = state.matchId;

  for (const seat of SEATS) {
    const userId = state.players[seat].userId;
    if (!isHumanUser(userId)) continue;

    try {
      await emit({ userId, eventType: "match_played", sourceType: "match", sourceId, metadata: { mode } });
      if (seat === winnerSeat) {
        await emit({ userId, eventType: "match_won", sourceType: "match", sourceId, metadata: { mode } });
        if (mode === "pve") await emit({ userId, eventType: "pve_win", sourceType: "match", sourceId });
      }
      if (winnerSeat !== undefined && seat !== winnerSeat) {
        await emit({ userId, eventType: "match_lost", sourceType: "match", sourceId, metadata: { mode } });
      }
      if (seat === winnerSeat && mode === "pve" && metadata.aiDifficulty) {
        await emit({ userId, eventType: `pve_win:${metadata.aiDifficulty}`, sourceType: "match", sourceId });
      }

      const s = stats[seat];
      if (s.cardsPlayed > 0) await emit({ userId, eventType: "cards_played", amount: s.cardsPlayed, sourceType: "match", sourceId });
      if (s.minionsSummoned > 0) await emit({ userId, eventType: "minions_summoned", amount: s.minionsSummoned, sourceType: "match", sourceId });
      if (s.damageDealt > 0) await emit({ userId, eventType: "damage_dealt", amount: s.damageDealt, sourceType: "match", sourceId });
      if (s.damageToMinions > 0) await emit({ userId, eventType: "damage_dealt_minion", amount: s.damageToMinions, sourceType: "match", sourceId });
      if (s.minionsKilled > 0) await emit({ userId, eventType: "minions_killed", amount: s.minionsKilled, sourceType: "match", sourceId });
      if (s.healthRestored > 0) await emit({ userId, eventType: "health_restored", amount: s.healthRestored, sourceType: "match", sourceId });
      if (s.minionsResurrected > 0) await emit({ userId, eventType: "minions_resurrected", amount: s.minionsResurrected, sourceType: "match", sourceId });
      if (s.minionsBounced > 0) await emit({ userId, eventType: "minions_bounced", amount: s.minionsBounced, sourceType: "match", sourceId });
    } catch (error) {
      logger.warn("match.taskEvents.seat_failed", { matchId: sourceId, seat, error: String(error) });
    }
  }
}

interface SeatStats {
  cardsPlayed: number;
  minionsSummoned: number;
  damageDealt: number;
  damageToMinions: number;
  minionsKilled: number;
  healthRestored: number;
  minionsResurrected: number;
  minionsBounced: number;
}

function emptySeatStats(): SeatStats {
  return {
    cardsPlayed: 0,
    minionsSummoned: 0,
    damageDealt: 0,
    damageToMinions: 0,
    minionsKilled: 0,
    healthRestored: 0,
    minionsResurrected: 0,
    minionsBounced: 0
  };
}

function opponentOf(seat: Seat): Seat {
  return seat === "player1" ? "player2" : "player1";
}

function isHeroTarget(target: string): boolean {
  return target.endsWith(":hero");
}

function asSeat(value: unknown): Seat | undefined {
  return value === "player1" || value === "player2" ? value : undefined;
}

/** Port of taskEvents.aggregateMatchStats — per-seat stats from the authoritative event log. */
export function aggregateMatchStats(eventLog: readonly GameEvent[]): Record<Seat, SeatStats> {
  const stats: Record<Seat, SeatStats> = { player1: emptySeatStats(), player2: emptySeatStats() };

  for (const event of eventLog) {
    const payload = event.payload ?? {};
    if (event.type === "CARD_PLAYED") {
      if (event.seat) stats[event.seat].cardsPlayed += 1;
    } else if (event.type === "MINION_SUMMONED") {
      if (event.seat) stats[event.seat].minionsSummoned += 1;
    } else if (event.type === "DAMAGE") {
      if (payload.lifeLoss === true || payload.payment === "HEALTH") continue;
      const target = payload.target;
      const amount = typeof payload.amount === "number" ? payload.amount : 0;
      if (amount <= 0 || typeof target !== "string" || !event.seat) continue;
      if (isHeroTarget(target)) stats[opponentOf(event.seat)].damageDealt += amount;
      else stats[opponentOf(event.seat)].damageToMinions += amount;
    } else if (event.type === "DESTROY") {
      if (event.seat) stats[opponentOf(event.seat)].minionsKilled += 1;
    } else if (event.type === "HEAL") {
      const amount = typeof payload.amount === "number" ? payload.amount : 0;
      if (amount > 0 && event.seat) stats[event.seat].healthRestored += amount;
    } else if (event.type === "RESURRECT") {
      if (event.seat) stats[event.seat].minionsResurrected += 1;
    } else if (event.type === "BOUNCE") {
      const actor = asSeat(payload.actorSeat);
      if (actor) stats[actor].minionsBounced += 1;
    }
  }

  return stats;
}
