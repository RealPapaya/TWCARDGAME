import type { CardDefinition } from "@twcardgame/cards";
import type { GameCommand, Seat } from "@twcardgame/shared";
import type { BotRngState } from "../bot.js";
import type { MatchState } from "../types.js";

/**
 * Everything the engines need to make (and simulate) a decision, bundled so the
 * per-engine functions share one signature. Pure: the only randomness is the
 * seeded `rng`, and any forward simulation goes through `reduce` with `nowMs`.
 */
export interface EngineContext {
  readonly state: MatchState;
  readonly seat: Seat;
  readonly rng: BotRngState;
  readonly catalog: readonly CardDefinition[];
  readonly nowMs: number;
}

export interface ScoredMove {
  readonly move: GameCommand;
  readonly score: number;
}
