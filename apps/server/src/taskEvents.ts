import { createSupabaseServerClient, emitUserProgressEvent, type EmitUserEventInput } from "@twcardgame/db";
import type { MatchState } from "@twcardgame/rules";
import { SEATS, type GameEvent, type Seat } from "@twcardgame/shared";
import { logger as defaultLogger } from "./logger.js";
import type { MatchPersistenceMetadata, MatchResultLogger } from "./persistence.js";
import { isHumanUser } from "./rewards.js";

/**
 * Emits server-authoritative account-level events (user_events) that drive the
 * quest/task progress system, once per finished match. This is the ONLY way
 * task progress advances — the underlying `emit_user_progress_event` RPC is
 * service_role-only, so clients cannot fabricate progress.
 *
 * Deliberately does NOT emit `pvp_win` / `match_finished`: those are already
 * emitted by `record_pvp_win` (persistence.ts) for PvP winners. Re-emitting
 * would double-count achievements keyed on `pvp_win`.
 */
export interface MatchTaskEventDispatcher {
  enabled: boolean;
  emitForMatch(state: MatchState, metadata?: MatchPersistenceMetadata): Promise<void>;
}

export function createTaskEventsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  matchLogger: MatchResultLogger = defaultLogger
): MatchTaskEventDispatcher {
  const url = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return noopTaskEvents;
  const client = createSupabaseServerClient({ url, serviceRoleKey });
  return createTaskEventsWithEmit((input) => emitUserProgressEvent(client, input), matchLogger);
}

export const noopTaskEvents: MatchTaskEventDispatcher = {
  enabled: false,
  emitForMatch: async () => {}
};

/**
 * Factory used by tests so a fake emitter can stand in for Supabase.
 */
export function createTaskEventsWithEmit(
  emit: (input: EmitUserEventInput) => Promise<void>,
  matchLogger: MatchResultLogger = defaultLogger
): MatchTaskEventDispatcher {
  return {
    enabled: true,
    emitForMatch: async (state, metadata) => {
      const mode: "pvp" | "pve" = metadata?.isVsAi ? "pve" : "pvp";
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
            if (mode === "pve") {
              await emit({ userId, eventType: "pve_win", sourceType: "match", sourceId });
            }
          }

          if (winnerSeat !== undefined && seat !== winnerSeat) {
            await emit({ userId, eventType: "match_lost", sourceType: "match", sourceId, metadata: { mode } });
          }
          if (seat === winnerSeat && mode === "pve" && metadata?.aiDifficulty) {
            // Difficulty-qualified PvE win, e.g. `pve_win:hard`, in addition to
            // the plain `pve_win` emitted above.
            await emit({ userId, eventType: `pve_win:${metadata.aiDifficulty}`, sourceType: "match", sourceId });
          }

          const s = stats[seat];
          if (s.cardsPlayed > 0) {
            await emit({ userId, eventType: "cards_played", amount: s.cardsPlayed, sourceType: "match", sourceId });
          }
          if (s.minionsSummoned > 0) {
            await emit({ userId, eventType: "minions_summoned", amount: s.minionsSummoned, sourceType: "match", sourceId });
          }
          if (s.damageDealt > 0) {
            await emit({ userId, eventType: "damage_dealt", amount: s.damageDealt, sourceType: "match", sourceId });
          }
          if (s.damageToMinions > 0) {
            await emit({ userId, eventType: "damage_dealt_minion", amount: s.damageToMinions, sourceType: "match", sourceId });
          }
          if (s.minionsKilled > 0) {
            await emit({ userId, eventType: "minions_killed", amount: s.minionsKilled, sourceType: "match", sourceId });
          }
          if (s.healthRestored > 0) {
            await emit({ userId, eventType: "health_restored", amount: s.healthRestored, sourceType: "match", sourceId });
          }
          if (s.minionsResurrected > 0) {
            await emit({ userId, eventType: "minions_resurrected", amount: s.minionsResurrected, sourceType: "match", sourceId });
          }
          if (s.minionsBounced > 0) {
            await emit({ userId, eventType: "minions_bounced", amount: s.minionsBounced, sourceType: "match", sourceId });
          }
        } catch (error) {
          // Best-effort gamification: one seat's failure must not block the other.
          matchLogger.warn("match.taskEvents.seat_failed", { matchId: sourceId, seat, error });
        }
      }
    }
  };
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

/**
 * Aggregates per-seat match stats from the authoritative event log. Every combat
 * event carries `seat` = the OWNER of the affected unit (not the actor), so
 * actor-credited stats are derived as follows:
 * - cardsPlayed / minionsSummoned: counted by the acting seat (unambiguous).
 * - damageDealt: damage to the ENEMY hero only, excluding self-inflicted
 *   health-payment / life-loss.
 * - damageToMinions: damage to a minion, credited to the victim owner's opponent.
 * - minionsKilled: an enemy minion's DESTROY, credited to the owner's opponent.
 * - healthRestored: HEAL to a unit, credited to that unit's owner (the side that
 *   regained life).
 * - minionsResurrected: RESURRECT, credited to the reviving owner.
 * - minionsBounced: BOUNCE, credited to the caster via `payload.actorSeat`
 *   (omitted for ownerless/global board wipes, which are then not counted).
 */
export function aggregateMatchStats(eventLog: readonly GameEvent[]): Record<Seat, SeatStats> {
  const stats: Record<Seat, SeatStats> = {
    player1: emptySeatStats(),
    player2: emptySeatStats()
  };

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
      if (isHeroTarget(target)) {
        // event.seat owns the damaged hero, so the dealer is its opponent.
        stats[opponentOf(event.seat)].damageDealt += amount;
      } else {
        stats[opponentOf(event.seat)].damageToMinions += amount;
      }
    } else if (event.type === "DESTROY") {
      // event.seat owns the dead minion; credit the kill to its opponent.
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
