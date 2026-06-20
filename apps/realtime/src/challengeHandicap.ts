import type { MatchState } from "@twcardgame/rules";
import type { AiDifficulty, Seat } from "@twcardgame/shared";

/**
 * Challenge-mode (挑戰模式) AI handicaps — applied ONLY when `BotGameSession` is in
 * challenge mode (電腦模式 practice gets fair stats). The PvE opponent is buffed by
 * tier so the higher tiers are a real "challenge": a bigger hero pool and a head
 * start on crystals (which also persists as a permanent lead, since the per-turn
 * mana ramp keeps adding on top of it). In challenge mode every tier already uses
 * the `hard` decision engine; this handicap is what differentiates the tiers.
 *
 * - 專家級 (`normal`): start with 2 crystals, hero HP 45.
 * - 大師級 (`hard`):   start with 3 crystals, hero HP 60.
 * - 普通級 (`easy`):   no handicap — the standard 1-crystal / 30-HP opening.
 *
 * `startingCrystals` is the crystal count the bot should have available on its
 * FIRST turn. Because `startTurn` does `mana.max = min(cap, mana.max + growth)`
 * (default growth = 1), we seed `mana.max` one below the target at match
 * creation so the first ramp lands exactly on `startingCrystals`.
 */
interface ChallengeHandicap {
  startingCrystals: number;
  heroHp: number;
}

const HANDICAPS: Record<AiDifficulty, ChallengeHandicap | null> = {
  easy: null,
  normal: { startingCrystals: 2, heroHp: 45 },
  hard: { startingCrystals: 3, heroHp: 60 }
};

/**
 * Applies the difficulty handicap to the bot seat. Called from
 * `BotGameSession.customizeInitialMatch`, i.e. at match creation while the match
 * is still in the mulligan phase and before the bot's first `startTurn`.
 */
export function applyChallengeHandicap(state: MatchState, botSeat: Seat, difficulty: AiDifficulty): void {
  const handicap = HANDICAPS[difficulty];
  if (!handicap) return;

  const bot = state.players[botSeat];
  bot.hero.hp = handicap.heroHp;
  bot.hero.maxHp = handicap.heroHp;
  // Seed one below the target so the first-turn ramp (growth 1) reaches it.
  bot.mana.max = Math.max(0, handicap.startingCrystals - 1);
  bot.mana.current = bot.mana.max;
}
