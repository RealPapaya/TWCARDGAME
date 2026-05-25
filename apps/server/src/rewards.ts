import { applyMatchRewards, createSupabaseServerClient } from "@twcardgame/db";
import type { MatchState } from "@twcardgame/rules";
import {
  calculatePvPExp,
  SEATS,
  type RewardSummary,
  type Seat
} from "@twcardgame/shared";
import { logger as defaultLogger } from "./logger.js";
import type { MatchPersistenceMetadata, MatchResultLogger } from "./persistence.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface MatchRewardDispatcher {
  enabled: boolean;
  grantForMatch(
    state: MatchState,
    metadata?: MatchPersistenceMetadata
  ): Promise<Map<Seat, RewardSummary>>;
}

export function createMatchRewardsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  matchLogger: MatchResultLogger = defaultLogger
): MatchRewardDispatcher {
  const url = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return noopMatchRewards;
  const client = createSupabaseServerClient({ url, serviceRoleKey });
  return createMatchRewardsWithClient((input) => applyMatchRewards(client, input), matchLogger);
}

export const noopMatchRewards: MatchRewardDispatcher = {
  enabled: false,
  grantForMatch: async (state, metadata) => buildLocalSummaries(state, metadata)
};

/**
 * Factory used by tests so a fake RPC implementation can stand in for Supabase.
 * The fake just needs to return a payload shaped like the SQL function.
 */
export function createMatchRewardsWithClient(
  rpc: (input: Parameters<typeof applyMatchRewards>[1]) => Promise<Awaited<ReturnType<typeof applyMatchRewards>>>,
  matchLogger: MatchResultLogger = defaultLogger
): MatchRewardDispatcher {
  return {
    enabled: true,
    grantForMatch: async (state, metadata) => {
      const summaries = new Map<Seat, RewardSummary>();
      const winnerSeat = state.result?.winnerSeat;
      const mode: "pvp" | "pve" = metadata?.isVsAi ? "pve" : "pvp";

      for (const seat of SEATS) {
        const player = state.players[seat];
        const isWinner = seat === winnerSeat;
        if (!isHumanUser(player.userId) || !isWinner) {
          summaries.set(seat, zeroSummary(state, metadata, seat, winnerSeat));
          continue;
        }

        try {
          const payload = await rpc({
            userId: player.userId,
            matchId: state.matchId,
            mode,
            aiTheme: metadata?.aiTheme ?? null,
            aiDifficulty: metadata?.aiDifficulty ?? null,
            pvpXp:
              mode === "pvp"
                ? calculatePvPExp(player.hero.hp, state.turn.number)
                : 0
          });
          summaries.set(seat, { result: "win", ...payload });
        } catch (error) {
          matchLogger.warn("match.rewards.failed", {
            matchId: state.matchId,
            userId: player.userId,
            error
          });
          summaries.set(seat, zeroSummary(state, metadata, seat, winnerSeat, "rpc_failed"));
        }
      }

      return summaries;
    }
  };
}

export function isHumanUser(userId: string | undefined | null): boolean {
  return typeof userId === "string" && UUID_PATTERN.test(userId);
}

function zeroSummary(
  state: MatchState,
  metadata: MatchPersistenceMetadata | undefined,
  seat: Seat,
  winnerSeat: Seat | undefined,
  diagnostic?: RewardSummary["diagnostic"]
): RewardSummary {
  const isWin = seat === winnerSeat;
  return {
    result: isWin ? "win" : "loss",
    mode: metadata?.isVsAi ? "pve" : "pvp",
    source: "none",
    ...(diagnostic && isWin ? { diagnostic } : {}),
    aiTheme: metadata?.aiTheme ?? null,
    aiDifficulty: metadata?.aiDifficulty ?? null,
    xp: { before: 0, after: 0, gained: 0 },
    level: { before: 1, after: 1 },
    levelUps: [],
    gold: { before: 0, after: 0, gained: 0, breakdown: {} }
  };
}

function buildLocalSummaries(
  state: MatchState,
  metadata: MatchPersistenceMetadata | undefined
): Map<Seat, RewardSummary> {
  const map = new Map<Seat, RewardSummary>();
  const winner = state.result?.winnerSeat;
  for (const seat of SEATS) map.set(seat, zeroSummary(state, metadata, seat, winner, "rewards_disabled"));
  return map;
}
