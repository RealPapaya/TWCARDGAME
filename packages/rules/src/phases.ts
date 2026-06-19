import {
  SEATS,
  type AiPartyTag,
  type AmplificationOption,
  type AmplificationTier,
  type GameEvent,
  type Phase,
  type Seat,
  type VoteEvent,
  type VoteWeights
} from "@twcardgame/shared";
import {
  AMPLIFICATION_DB,
  VOTE_EVENT_DB,
  type AmplificationDbEntry,
  type CardDefinition,
  type EnvironmentDescriptor,
  type VoteEventDbEntry
} from "@twcardgame/cards";
import { applyAugmentSelection, finishIfHeroDead, resolveEffect, resolvePostAction } from "./effects.js";
import { applyEnvironmentTick, environmentTurnTimeLimitMs } from "./effects/environment.js";
import { enforceBoardLimit } from "./effects/voteEvents.js";
import { nextInt, normalizeSeed } from "./rng.js";
import { addEvent } from "./state.js";
import { turnTimeLimitForPlayer } from "./timing.js";
import type { MatchState, PlayerState, RuntimeCard, RuntimeMinion, SpecialPhaseState } from "./types.js";

const VOTE_ROLL_RESOLUTION = 1_000_000;

/** One seat's referendum pick, carried on the `VOTE_RESOLVED` event payload. */
export interface VoteResolvedChoice {
  seat: Seat;
  optionIndex: number;
  eventId: string;
  eventName: string;
}

// --- Trigger configuration -------------------------------------------------

/** Turns that open the deck-based amplification phase. */
export const AMPLIFICATION_TURNS: readonly number[] = [7, 14];
/** Turn that opens the inverse-HP referendum phase. */
export const VOTING_TURN = 20;
/** Independent countdown for both special phases (max 30s). */
export const SPECIAL_PHASE_TIME_LIMIT_MS = 30_000;

/** The three political-figure faction categories, in fixed tie-break order. */
export const FACTION_CATEGORIES: readonly string[] = ["民進黨政治人物", "國民黨政治人物", "民眾黨政治人物"];

const PARTY_BY_CATEGORY: Record<string, AiPartyTag> = {
  民進黨政治人物: "民進黨",
  國民黨政治人物: "國民黨",
  民眾黨政治人物: "民眾黨"
};

/** Maps a just-started turn number to the special phase it triggers, if any. */
export function phaseTriggerForTurn(turnNumber: number): Exclude<Phase, "NORMAL_PLAY"> | undefined {
  if (turnNumber === VOTING_TURN) return "VOTING_PHASE";
  if (AMPLIFICATION_TURNS.includes(turnNumber)) return "AMPLIFICATION_PHASE";
  return undefined;
}

// --- Deck analyzer ----------------------------------------------------------

export interface FactionComposition {
  dominantCategory?: string;
  dominantParty?: AiPartyTag;
  count: number;
  total: number;
}

/**
 * Finds the player's dominant political faction from their registered deck
 * histogram. Considers only the three `…政治人物` categories; ties break by the
 * fixed {@link FACTION_CATEGORIES} order (deterministic, no RNG). A deck with no
 * faction cards yields `dominantCategory: undefined` → neutral fallback pool.
 */
export function dominantFaction(counts: Record<string, number>): FactionComposition {
  let dominantCategory: string | undefined;
  let best = 0;
  let total = 0;
  for (const category of FACTION_CATEGORIES) {
    const count = counts[category] ?? 0;
    total += count;
    if (count > best) {
      best = count;
      dominantCategory = category;
    }
  }
  return {
    dominantCategory,
    dominantParty: dominantCategory ? PARTY_BY_CATEGORY[dominantCategory] : undefined,
    count: best,
    total
  };
}

// --- Inverse-HP weighted roulette ------------------------------------------

/**
 * Integer roulette weights for the referendum: a seat's weight is the OPPONENT's
 * HP, so the lower-HP/underdog player is favored ("弱勢族群加成"). Both at 0 → even.
 */
export function voteWeightsInt(hpPlayer1: number, hpPlayer2: number): Record<Seat, number> {
  const player1 = Math.max(0, hpPlayer2);
  const player2 = Math.max(0, hpPlayer1);
  if (player1 + player2 === 0) return { player1: 1, player2: 1 };
  return { player1, player2 };
}

/** Picks the winning seat and a replayable roulette position from integer weights. */
export function weightedPickSeat(
  rngState: number,
  weights: Record<Seat, number>
): { seat: Seat; rngState: number; rollMillionths: number } {
  const total = weights.player1 + weights.player2;
  const roll = nextInt(rngState, VOTE_ROLL_RESOLUTION);
  const player1Boundary = Math.floor((weights.player1 / total) * VOTE_ROLL_RESOLUTION);
  return {
    seat: roll.value < player1Boundary ? "player1" : "player2",
    rngState: roll.state,
    rollMillionths: roll.value
  };
}

/** Converts integer roulette weights into display win percentages summing to ~100. */
export function voteWeightsDisplay(weights: Record<Seat, number>): VoteWeights {
  const total = weights.player1 + weights.player2;
  if (total === 0) return { player1: 50, player2: 50 };
  return {
    player1: Math.round((weights.player1 / total) * 100),
    player2: Math.round((weights.player2 / total) * 100)
  };
}

// --- Tier-probability sampling ---------------------------------------------

/** Picks an index proportional to integer weights, threading the seeded RNG. */
export function weightedIndex(rngState: number, weights: readonly number[]): { value: number; state: number } {
  const total = weights.reduce((sum, w) => sum + Math.max(0, w), 0);
  if (total <= 0) return { value: 0, state: rngState };
  const roll = nextInt(rngState, total);
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += Math.max(0, weights[i]);
    if (roll.value < acc) return { value: i, state: roll.state };
  }
  return { value: weights.length - 1, state: roll.state };
}

// --- Game-start tier roll ---------------------------------------------------

/** Per-phase tier probabilities (加減賺 45% / 蕭貪 35% / 卯死 20%). */
const TIER_ROLL_WEIGHTS: ReadonlyArray<readonly [AmplificationTier, number]> = [
  ["加減賺", 45],
  ["蕭貪", 35],
  ["卯死", 20]
];

function rollOneTier(state: number): { tier: AmplificationTier; state: number } {
  const pick = weightedIndex(state, TIER_ROLL_WEIGHTS.map(([, weight]) => weight));
  return { tier: TIER_ROLL_WEIGHTS[pick.value][0], state: pick.state };
}

/**
 * Rolls the two amplification-phase tiers (turn 7, turn 14) at match creation.
 * Uses a seed derived from the match seed so the MAIN RNG stream (deck shuffle /
 * opening hands) is untouched — keeping existing seeded goldens stable. Both seats
 * share the result; only the per-seat option content differs.
 */
export function rollAugmentTiers(seed: number): [AmplificationTier, AmplificationTier] {
  let state = normalizeSeed(seed ^ 0x9e3779b9);
  const first = rollOneTier(state);
  state = first.state;
  const second = rollOneTier(state);
  return [first.tier, second.tier];
}

/**
 * Builds a player's amplification options for one phase: `count` picks of the
 * phase's single tier, weighted by deck composition, without repeating an
 * already-selected augment. Generic augments carry a flat base weight; faction
 * augments (颱風假 / 島嶼天光) are weighted by their category's deck share and dropped
 * when the deck has none. `0050` / `違約交割` are first-phase-only, and `0050` is
 * dropped when the second phase is already 卯死. Deterministic for a given seed.
 */
export function sampleAugmentOptions(args: {
  rngState: number;
  pool: readonly AmplificationDbEntry[];
  categoryCounts: Record<string, number>;
  excludeIds: ReadonlySet<string>;
  isFirstPhase: boolean;
  secondPhaseTier: AmplificationTier;
  count?: number;
}): { options: AmplificationOption[]; rngState: number } {
  const count = args.count ?? 3;
  let state = args.rngState;
  const deckTotal = Object.values(args.categoryCounts).reduce((sum, n) => sum + n, 0) || 1;

  const candidates: Array<{ entry: AmplificationDbEntry; weight: number }> = [];
  for (const entry of args.pool) {
    if (args.excludeIds.has(entry.id)) continue;
    if (entry.firstPhaseOnly && !args.isFirstPhase) continue;
    if (entry.id === "AMP_0050" && args.secondPhaseTier === "卯死") continue;
    let weight = 10;
    if (entry.factionTags.length > 0) {
      const supported = entry.factionTags.reduce((best, tag) => Math.max(best, args.categoryCounts[tag] ?? 0), 0);
      if (supported <= 0) continue; // no deck support → never offered
      weight = Math.round(10 * (0.25 + 4 * (supported / deckTotal)));
    }
    candidates.push({ entry, weight });
  }

  const options: AmplificationOption[] = [];
  while (options.length < count && candidates.length > 0) {
    const pick = weightedIndex(state, candidates.map((candidate) => candidate.weight));
    state = pick.state;
    const [chosen] = candidates.splice(pick.value, 1);
    options.push(toOption(chosen.entry));
  }
  return { options, rngState: state };
}

function toOption(entry: AmplificationDbEntry): AmplificationOption {
  return {
    id: entry.id,
    tier: entry.tier,
    name: entry.name,
    description: entry.description,
    relatedCardIds: entry.relatedCardIds
  };
}

/** Draws `count` unique vote events weighted by their tier weight. Deterministic per seed. */
export function sampleVoteEvents(
  rngState: number,
  db: readonly VoteEventDbEntry[],
  count = 3
): { events: VoteEvent[]; rngState: number } {
  let state = rngState;
  const remaining = [...db];
  const events: VoteEvent[] = [];
  for (let i = 0; i < count && remaining.length > 0; i++) {
    const pick = weightedIndex(state, remaining.map((entry) => entry.tierWeight));
    state = pick.state;
    const entry = remaining.splice(pick.value, 1)[0];
    events.push({ id: entry.id, name: entry.name, options: [...entry.options] as [string, string, string] });
  }
  return { events, rngState: state };
}

// --- State machine: enter / resolve ----------------------------------------

/**
 * Switches the match into a special phase, builds its transient state, draws its
 * options/events (threading the seeded RNG) and emits `PHASE_STARTED`. Called at
 * the end of `startTurn`; the turn's draw/mana/clock have already happened, so the
 * interrupted turn simply resumes once the phase resolves (never re-runs startTurn).
 */
export function enterSpecialPhase(
  state: MatchState,
  phase: Exclude<Phase, "NORMAL_PLAY">,
  nowMs: number,
  events: GameEvent[]
): void {
  const resumeSeat = state.turn.activeSeat;
  state.phase = phase;
  const sp: SpecialPhaseState = {
    phase,
    phaseDeadlineAtMs: nowMs + SPECIAL_PHASE_TIME_LIMIT_MS,
    resumeSeat,
    resumeTurnNumber: state.turn.number
  };

  if (phase === "AMPLIFICATION_PHASE") {
    sp.amplificationOptions = { player1: [], player2: [] };
    sp.amplificationChoice = {};
    sp.amplificationRerollUsed = {};
    sp.amplificationRerollLimit = {};
    sp.amplificationRerollCount = {};
    // Both phases share their tier (rolled at match creation); only the per-seat
    // option content differs, weighted by each deck and excluding prior picks.
    const phaseIndex = Math.max(0, AMPLIFICATION_TURNS.indexOf(state.turn.number));
    const tier = state.augmentTiers[phaseIndex] ?? state.augmentTiers[0];
    const pool = AMPLIFICATION_DB.filter((entry) => entry.tier === tier);
    for (const seat of SEATS) {
      const flags = state.players[seat].augmentFlags;
      const extraRerolls = Math.max(0, flags.extraAmplificationRerollsNextPhase);
      sp.amplificationRerollLimit[seat] = 1 + extraRerolls;
      sp.amplificationRerollCount[seat] = 0;
      flags.extraAmplificationRerollsNextPhase = 0;
      const excludeIds = new Set(state.players[seat].augments.map((augment) => augment.id));
      const sampled = sampleAugmentOptions({
        rngState: state.private.rngState,
        pool,
        categoryCounts: state.players[seat].registeredCategoryCounts,
        excludeIds,
        isFirstPhase: phaseIndex === 0,
        secondPhaseTier: state.augmentTiers[1]
      });
      state.private.rngState = sampled.rngState;
      sp.amplificationOptions[seat] = sampled.options;
    }
  } else {
    const drawn = sampleVoteEvents(state.private.rngState, VOTE_EVENT_DB);
    state.private.rngState = drawn.rngState;
    sp.voteEvents = drawn.events;
    sp.voteChoice = {};
    sp.voteWeightsInt = voteWeightsInt(state.players.player1.hero.hp, state.players.player2.hero.hp);
  }

  state.specialPhase = sp;
  addEvent(state, events, "PHASE_STARTED", { phase, phaseDeadlineAtMs: sp.phaseDeadlineAtMs }, resumeSeat);
}

/** Replaces one seat's unsubmitted amplification offer once per amplification phase. */
export function handleRerollAmplification(
  state: MatchState,
  seat: Seat,
  events: GameEvent[]
): void {
  const sp = state.specialPhase;
  if (!sp || sp.phase !== "AMPLIFICATION_PHASE") {
    rejectPhase(state, events, seat, "No amplification phase is active.");
    return;
  }
  if (sp.amplificationChoice?.[seat] !== undefined) {
    rejectPhase(state, events, seat, "Amplification is already selected.");
    return;
  }
  const used = sp.amplificationRerollCount?.[seat] ?? (sp.amplificationRerollUsed?.[seat] ? 1 : 0);
  const limit = sp.amplificationRerollLimit?.[seat] ?? 1;
  if (used >= limit) {
    rejectPhase(state, events, seat, "Amplification reroll has already been used.");
    return;
  }

  const currentOptions = sp.amplificationOptions?.[seat] ?? [];
  const phaseIndex = Math.max(0, AMPLIFICATION_TURNS.indexOf(sp.resumeTurnNumber));
  const tier = currentOptions[0]?.tier ?? state.augmentTiers[phaseIndex] ?? state.augmentTiers[0];
  const pool = AMPLIFICATION_DB.filter((entry) => entry.tier === tier);
  const boundIds = new Set(state.players[seat].augments.map((augment) => augment.id));
  const currentIds = new Set(currentOptions.map((option) => option.id));
  const preferredExcludeIds = new Set([...boundIds, ...currentIds]);
  const first = sampleAugmentOptionsForSeat(state, seat, pool, preferredExcludeIds, phaseIndex, 3);
  let nextOptions = first.options;

  if (nextOptions.length < 3) {
    const excludeIds = new Set([...boundIds, ...nextOptions.map((option) => option.id)]);
    const fill = sampleAugmentOptionsForSeat(state, seat, pool, excludeIds, phaseIndex, 3 - nextOptions.length);
    nextOptions = [...nextOptions, ...fill.options];
  }

  if (nextOptions.length === 0) {
    rejectPhase(state, events, seat, "No amplification options are available.");
    return;
  }

  if (!sp.amplificationOptions) sp.amplificationOptions = { player1: [], player2: [] };
  sp.amplificationOptions[seat] = nextOptions;
  sp.amplificationRerollUsed = { ...sp.amplificationRerollUsed, [seat]: true };
  sp.amplificationRerollCount = { ...sp.amplificationRerollCount, [seat]: used + 1 };
  addEvent(
    state,
    events,
    "AMPLIFICATION_REROLLED",
    { tier, optionIds: nextOptions.map((option) => option.id), rerollsRemaining: Math.max(0, limit - used - 1) },
    seat
  );
}

function sampleAugmentOptionsForSeat(
  state: MatchState,
  seat: Seat,
  pool: readonly AmplificationDbEntry[],
  excludeIds: ReadonlySet<string>,
  phaseIndex: number,
  count: number
): { options: AmplificationOption[] } {
  const sampled = sampleAugmentOptions({
    rngState: state.private.rngState,
    pool,
    categoryCounts: state.players[seat].registeredCategoryCounts,
    excludeIds,
    isFirstPhase: phaseIndex === 0,
    secondPhaseTier: state.augmentTiers[1],
    count
  });
  state.private.rngState = sampled.rngState;
  return { options: sampled.options };
}

/** Records (or force-defaults) a seat's amplification choice and resolves once both are in. */
export function handleSelectAmplification(
  state: MatchState,
  seat: Seat,
  optionId: string,
  serverTimeout: boolean,
  nowMs: number,
  events: GameEvent[]
): void {
  const sp = state.specialPhase;
  if (!sp || sp.phase !== "AMPLIFICATION_PHASE") {
    rejectPhase(state, events, seat, "現在不是增幅選擇階段。");
    return;
  }

  if (serverTimeout) {
    for (const target of SEATS) {
      if (sp.amplificationChoice?.[target] === undefined) {
        const fallback = defaultAmplification(sp.amplificationOptions?.[target] ?? []);
        if (fallback) recordAmplification(state, sp, target, fallback.id, fallback.tier, events);
      }
    }
    resolveAmplificationPhase(state, nowMs, events);
    return;
  }

  if (sp.amplificationChoice?.[seat] !== undefined) return;
  const chosen = (sp.amplificationOptions?.[seat] ?? []).find((option) => option.id === optionId);
  if (!chosen) {
    rejectPhase(state, events, seat, "無效的增幅選項。");
    return;
  }
  recordAmplification(state, sp, seat, chosen.id, chosen.tier, events);
  if (SEATS.every((s) => sp.amplificationChoice?.[s] !== undefined)) resolveAmplificationPhase(state, nowMs, events);
}

function recordAmplification(
  state: MatchState,
  sp: SpecialPhaseState,
  seat: Seat,
  optionId: string,
  tier: string,
  events: GameEvent[]
): void {
  sp.amplificationChoice = { ...sp.amplificationChoice, [seat]: optionId };
  addEvent(state, events, "AMPLIFICATION_SELECTED", { optionId, tier }, seat);
}

function defaultAmplification(options: readonly AmplificationOption[]): AmplificationOption | undefined {
  // Single-tier phases now: the timeout fallback is simply the first offered option.
  return options[0];
}

function resolveAmplificationPhase(state: MatchState, nowMs: number, events: GameEvent[]): void {
  const sp = state.specialPhase;
  if (!sp) return;
  for (const seat of SEATS) {
    const choiceId = sp.amplificationChoice?.[seat];
    const option = sp.amplificationOptions?.[seat]?.find((o) => o.id === choiceId);
    if (!option) continue;
    const selection = { id: option.id, tier: option.tier, name: option.name };
    state.players[seat].amplification = selection; // most-recent (badge back-compat)
    state.players[seat].augments.push(selection); // accumulate (drives indicators / no-repeat)
    const entry = AMPLIFICATION_DB.find((e) => e.id === option.id);
    if (entry) applyAugmentSelection(state, seat, entry, events);
  }
  finishIfHeroDead(state, events);
  endSpecialPhase(state, nowMs, "AMPLIFICATION_PHASE", events);
}

/**
 * Returns to NORMAL_PLAY and refreshes the interrupted turn's clock from `nowMs`,
 * so the resumed player gets a full turn timer instead of inheriting the deadline
 * that was set when the (now-elapsed) special phase opened.
 */
function endSpecialPhase(state: MatchState, nowMs: number, phase: string, events: GameEvent[]): void {
  state.phase = "NORMAL_PLAY";
  state.specialPhase = undefined;
  const resumeSeat = state.turn.activeSeat;
  state.turn.startedAtMs = nowMs;
  state.turn.deadlineAtMs =
    nowMs +
    turnTimeLimitForPlayer(
      state.players[resumeSeat],
      state.private.turnTimeLimitMs,
      environmentTurnTimeLimitMs(state, resumeSeat)
    );
  addEvent(state, events, "PHASE_ENDED", { phase });
}

/** Records (or force-defaults) a seat's referendum vote and resolves once both are in. */
export function handleSubmitVote(
  state: MatchState,
  seat: Seat,
  optionIndex: 0 | 1 | 2,
  serverTimeout: boolean,
  nowMs: number,
  events: GameEvent[],
  catalog: Map<string, CardDefinition>
): void {
  const sp = state.specialPhase;
  if (!sp || sp.phase !== "VOTING_PHASE") {
    rejectPhase(state, events, seat, "現在不是公投階段。");
    return;
  }

  if (serverTimeout) {
    for (const target of SEATS) {
      if (sp.voteChoice?.[target] === undefined) recordVote(state, sp, target, 0, events);
    }
    resolveVotingPhase(state, nowMs, events, catalog);
    return;
  }

  if (sp.voteChoice?.[seat] !== undefined) return;
  const eventCount = sp.voteEvents?.length ?? 0;
  if (optionIndex < 0 || optionIndex >= eventCount) {
    rejectPhase(state, events, seat, "無效的公投選項。");
    return;
  }
  recordVote(state, sp, seat, optionIndex, events);
  if (SEATS.every((s) => sp.voteChoice?.[s] !== undefined)) resolveVotingPhase(state, nowMs, events, catalog);
}

function recordVote(
  state: MatchState,
  sp: SpecialPhaseState,
  seat: Seat,
  optionIndex: 0 | 1 | 2,
  events: GameEvent[]
): void {
  sp.voteChoice = { ...sp.voteChoice, [seat]: optionIndex };
  addEvent(state, events, "VOTE_CAST", { optionIndex }, seat);
}

function resolveVotingPhase(
  state: MatchState,
  nowMs: number,
  events: GameEvent[],
  catalog: Map<string, CardDefinition>
): void {
  const sp = state.specialPhase;
  if (!sp || !sp.voteEvents || !sp.voteWeightsInt) return;

  const voteEvents = sp.voteEvents;
  const pick = weightedPickSeat(state.private.rngState, sp.voteWeightsInt);
  state.private.rngState = pick.rngState;
  const winningSeat = pick.seat;
  const winningIndex = sp.voteChoice?.[winningSeat] ?? 0;
  const winningEvent = voteEvents[winningIndex] ?? voteEvents[0];
  const display = voteWeightsDisplay(sp.voteWeightsInt);

  // Exact weights and roll let every client render the same near-boundary result
  // without trusting any client-side random value.
  const ballotChoice = (seat: Seat): VoteResolvedChoice => {
    const optionIndex = sp.voteChoice?.[seat] ?? 0;
    const event = voteEvents[optionIndex] ?? voteEvents[0];
    return { seat, optionIndex, eventId: event.id, eventName: event.name };
  };
  const choices: Record<Seat, VoteResolvedChoice> = {
    player1: ballotChoice("player1"),
    player2: ballotChoice("player2")
  };

  const dbEntry = VOTE_EVENT_DB.find((entry) => entry.id === winningEvent.id);
  if (dbEntry) {
    // 潛逃國外: snapshot any referendum-immune seat's units/resources, then restore
    // them after the effect resolves so they end up untouched by this turn-20 event.
    // Scoped here (not in the shared handlers) so card effects reusing the same
    // effect types are unaffected. Persistent referendum environments separately
    // skip immune seats (silence tick + getCardActualCost).
    const immuneSnapshot = snapshotReferendumImmune(state);
    const glowFromIndex = events.length;
    applyVoteEventEffect(state, dbEntry.apply, winningEvent.id, winningEvent.name, winningSeat, events, catalog);
    restoreReferendumImmune(state, immuneSnapshot);
    emitVoteEventGlow(state, events, glowFromIndex);
  }

  const winnerName = state.players[winningSeat].displayName;
  const processText = `中選會公投：${winnerName}（中選率 ${display[winningSeat]}%，弱勢族群加成）勝出，通過「${winningEvent.name}」。`;
  addEvent(
    state,
    events,
    "VOTE_RESOLVED",
    {
      winningSeat,
      eventId: winningEvent.id,
      eventName: winningEvent.name,
      weights: display,
      weightsInt: sp.voteWeightsInt,
      rollMillionths: pick.rollMillionths,
      choices,
      processText
    },
    winningSeat
  );

  endSpecialPhase(state, nowMs, "VOTING_PHASE", events);
}

/**
 * 公投事件影響賽局時,額外發一個 `VOTE_EVENT_GLOW`,讓客戶端在輪盤結束後對「受影響
 * 且仍留場/新登場」的單位打上紫光(增幅發光的紫色變體)。只收會留在場上或之後才登場的
 * 目標(治療/光盾/增益/召喚);死亡與回手的單位已各有碎裂/收回動畫,故排除,避免客戶端
 * 對不存在的節點空轉重試。無受影響單位(例如純水晶/環境事件)則不發光。
 */
const VOTE_GLOW_EVENT_TYPES = new Set<string>([
  "HEAL",
  "BUFF",
  "DAMAGE",
  "MINION_SUMMONED",
  "SHIELD_POPPED"
]);

function emitVoteEventGlow(state: MatchState, events: GameEvent[], fromIndex: number): void {
  const targets: string[] = [];
  const seen = new Set<string>();
  for (let i = fromIndex; i < events.length; i++) {
    const event = events[i];
    if (!VOTE_GLOW_EVENT_TYPES.has(event.type)) continue;
    const target = event.payload?.target;
    if (typeof target !== "string" || seen.has(target)) continue;
    seen.add(target);
    targets.push(target);
  }
  if (targets.length === 0) return;
  addEvent(state, events, "VOTE_EVENT_GLOW", { targets });
}

function applyVoteEventEffect(
  state: MatchState,
  descriptor: EnvironmentDescriptor,
  eventId: string,
  eventName: string,
  activeSeat: Seat,
  events: GameEvent[],
  catalog: Map<string, CardDefinition>
): void {
  if (descriptor.mode === "IMMEDIATE") {
    resolveEffect(descriptor.effect, { state, activeSeat, events, catalog });
    resolvePostAction(state, events, catalog);
    return;
  }
  const expiresTurn = descriptor.durationTurns ? state.turn.number + descriptor.durationTurns : undefined;
  state.currentEnvironment = {
    id: eventId,
    name: eventName,
    appliedTurn: state.turn.number,
    expiresTurn,
    effect: descriptor.effect
  };
  addEvent(state, events, "ENVIRONMENT_APPLIED", { id: eventId, name: eventName, expiresTurn });
  applyEnvironmentTick(state, events);
  // 社交距離: trim each side down to the freshly-installed board cap once, then
  // resolve any minions that died because their owner's hand was already full.
  if (descriptor.effect.type === "ENV_BOARD_LIMIT") {
    enforceBoardLimit(descriptor.effect, { state, activeSeat, events, catalog });
    resolvePostAction(state, events, catalog);
  }
}

type ImmuneSnapshot = Partial<
  Record<
    Seat,
    {
      board: RuntimeMinion[];
      hero: PlayerState["hero"];
      mana: PlayerState["mana"];
      hand: RuntimeCard[];
      deck: RuntimeCard[];
      graveyard: RuntimeCard[];
    }
  >
>;

/** Captures referendum-immune seats' mutable units/resources before a vote effect. */
function snapshotReferendumImmune(state: MatchState): ImmuneSnapshot {
  const snapshot: ImmuneSnapshot = {};
  for (const seat of SEATS) {
    if (!state.players[seat].augmentFlags.referendumImmune) continue;
    const player = state.players[seat];
    snapshot[seat] = {
      board: structuredClone(player.board),
      hero: structuredClone(player.hero),
      mana: structuredClone(player.mana),
      hand: structuredClone(player.hand),
      deck: structuredClone(player.deck),
      graveyard: structuredClone(player.graveyard)
    };
  }
  return snapshot;
}

/** Restores the snapshot so a referendum-immune seat ends up untouched by the vote effect. */
function restoreReferendumImmune(state: MatchState, snapshot: ImmuneSnapshot): void {
  for (const seat of SEATS) {
    const saved = snapshot[seat];
    if (!saved) continue;
    const player = state.players[seat];
    player.board = saved.board;
    player.hero = saved.hero;
    player.mana = saved.mana;
    player.hand = saved.hand;
    player.deck = saved.deck;
    player.graveyard = saved.graveyard;
  }
}

function rejectPhase(state: MatchState, events: GameEvent[], seat: Seat, reason: string): void {
  addEvent(state, events, "COMMAND_REJECTED", { reason }, seat);
}

