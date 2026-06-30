import type {
  AmplificationOption,
  AmplificationSelection,
  AmplificationTier,
  CommandEnvelope,
  GameEvent,
  GameStatus,
  HandCardView,
  MatchResult,
  PendingPrompt,
  Phase,
  PublicGameState,
  PublicMinion,
  PublicPlayer,
  Seat,
  TargetRef,
  TurnState,
  VoteEvent
} from "@twcardgame/shared";
import type { CardDefinition, CardKeywords, EffectDefinition } from "@twcardgame/cards";
import type { CardType, Rarity } from "@twcardgame/shared";

export interface RuntimeCard {
  instanceId: string;
  cardId: string;
  ownerSeat: Seat;
  name: string;
  category: string;
  cost: number;
  type: CardType;
  rarity: Rarity;
  description: string;
  image: string;
  attack?: number;
  health?: number;
  keywords: CardKeywords;
  bounce_bonus?: number;
  hanBounceBonus?: number;
  isReduced?: boolean;
}

export interface TempBuff {
  attack: number;
  health: number;
}

/**
 * The cause of a minion's death, surfaced in the `DESTROY` event payload so the
 * client can show a clear battle-log line:
 * - `FULL_HAND` — a bounce had nowhere to go (hand already at 10) so the minion
 *   died on the board instead of returning to hand → "滿手死亡".
 * - `EVENT` — a referendum / environment event killed it → "因【label】死亡".
 */
export type DeathReason = { kind: "FULL_HAND" } | { kind: "EVENT"; label: string };

export interface RuntimeMinion {
  instanceId: string;
  cardId: string;
  ownerSeat: Seat;
  name: string;
  category: string;
  cost: number;
  type: "MINION";
  rarity: Rarity;
  attack: number;
  baseAttack: number;
  health: number;
  currentHealth: number;
  keywords: CardKeywords;
  sleeping: boolean;
  canAttack: boolean;
  isEnraged: boolean;
  lockedTurns: number;
  deathTimer?: number;
  temporaryUntilTurn?: number;
  /**
   * Why this minion is about to die, read by `resolveDeaths` to tag the `DESTROY`
   * event so the battle log can explain the cause (滿手死亡 / 因某事件死亡) rather
   * than a generic 陣亡. Transient: set just before `currentHealth` hits 0 and
   * cleared when the death is settled.
   */
  deathReason?: DeathReason;
  questTurns?: number;
  auraAttack: number;
  auraHealth: number;
  auraTaunt: boolean;
  tempBuffs: TempBuff[];
  bounce_bonus?: number;
  hanBounceBonus?: number;
  /** Marks a 1/1 token spawned by 普渡 so it cannot itself re-revive. */
  revivedByPurdo?: boolean;
}

/**
 * Flat, cheap-to-read flags derived from a player's bound amplifications. Hot
 * paths (cost reader, hero damage, summon) consult these instead of scanning an
 * effect list. Populated by `applyAugmentSelection`; reset to defaults at match
 * creation. See [[packages/rules/src/effects/augments.ts]].
 */
export interface AugmentFlags {
  /** 言論自由: flat NEWS cost reduction. */
  newsCostReduce: number;
  /** 新青年安心成家貸款: flat 建築 cost reduction. */
  buildingCostReduce: number;
  /** 乞丐超人: cost multiplier in tenths (7 = ×0.7) once past `costMultiplierAfterTurn`. */
  costMultiplierTenths?: number;
  costMultiplierAfterTurn?: number;
  /** 股東紀念品: the next drawn card is half-costed, then this clears. */
  nextDrawHalfCost: boolean;
  /** 颱風假: persistent stat buff to summoned minions of a category (and current board). */
  categoryBuff?: { category: string; value: number; stat: "ATTACK" | "HEALTH" | "ALL" };
  /** 基本工資調漲: +attack to summoned minions of printed cost 1-4. */
  lowCostMinionAttackBuff: number;
  /** 育兒津貼: +maxHP to every minion this player plays. */
  playedMinionMaxHpBonus: number;
  /** 島嶼天光: minions of this category have attack & health doubled. */
  doubleCategory?: string;
  /** Permanent flat cost reductions keyed by card category. */
  categoryCostReductions?: Array<{ category: string; value: number }>;
  /** Categories whose minions are shuffled into their owner's deck after death. */
  shuffleIntoDeckOnDeathCategories?: string[];
  /** Heal granted to the surviving, death-time neighbors of a dying category minion. */
  categoryDeathrattleAdjacentHeals?: Array<{ augmentId: string; category: string; value: number }>;
  /** Temporary current-mana grants when any minion of a category dies. */
  categoryDeathManaGains?: Array<{ augmentId: string; category: string; value: number }>;
  /** Attack granted whenever a category minion gains or enters play with divine shield. */
  categoryDivineShieldAttackBuffs?: Array<{ augmentId: string; category: string; value: number }>;
  /** Summon-trigger augments that place cards on the opponent's board. */
  summonEnemyOnCategory?: Array<{ augmentId: string; category: string; cardId: string; count: number }>;
  /** 減稅: hero takes this much less from every damage instance. */
  damageReductionPerInstance: number;
  /** 普渡: own minions revive once as a 1/1 when they die. */
  reviveOnceAsVanilla: boolean;
  /** 潛逃國外: exempt from the turn-20 referendum effect. */
  referendumImmune: boolean;
  /** 違約交割: cannot attack / play cards while `turn.number <= frozenUntilTurn`. */
  frozenUntilTurn?: number;
  /** 消費券3600: crystals granted at the start of the player's next turn (one-shot). */
  bonusCrystalsNextTurn?: number;
  /** Augment ids contributing to the next-turn crystal grant. */
  bonusCrystalsNextTurnSources: string[];
  /** 大薯買一送一: extra card drawn at the start of each of the next N turns. */
  extraDrawTurnsRemaining: number;
  /** 要拚: extra rerolls available in the next amplification phase. */
  extraAmplificationRerollsNextPhase: number;
  /** 廠商回扣: gain printed-cost crystals whenever any minion is destroyed. */
  destroyedMinionCostRebate: boolean;
  /** 台雞電OFFER: convert card costs to hero HP payment on the next own turn. */
  payCostWithHealthNextTurn: boolean;
  /** 台雞電OFFER: active for the current own turn only. */
  payCostWithHealthThisTurn: boolean;
  /** Turn-gated mana ramps. Active ramps combine by highest cap and highest growth. */
  manaRamps: Array<{ augmentId: string; turnThreshold: number; cap: number; growth: number }>;
  /** Permanent bonus to the player's crystal cap from instant crystal augments. */
  manaCapBonus: number;
  /** 壽險理賠: HP threshold and cap, latched permanently by `lowHpManaCapUnlocked`. */
  lowHpManaCapThreshold?: number;
  lowHpManaCap?: number;
  lowHpManaCapUnlocked: boolean;
}

export interface PlayerState {
  seat: Seat;
  userId: string;
  displayName: string;
  connected: boolean;
  reconnectUntilMs?: number;
  hero: { hp: number; maxHp: number };
  mana: { current: number; max: number };
  hand: RuntimeCard[];
  deck: RuntimeCard[];
  graveyard: RuntimeCard[];
  board: RuntimeMinion[];
  mulliganReady: boolean;
  shortTurnPenalty: boolean;
  /**
   * 疲勞層數:牌庫抽乾後每次再嘗試抽牌就 +1,並對自身英雄造成等量傷害(第一次 1 點、
   * 第二次 2 點…依此類推)。整場累加,永不重置。見 effects/fatigue.ts。
   */
  fatigue: number;
  /** Most-recently bound amplification; shown by the avatar badge (back-compat). */
  amplification?: AmplificationSelection;
  /** All amplifications bound to this player (0..2), in phase order. */
  augments: AmplificationSelection[];
  /** Derived flat flags consulted by the hot-path passive readers (cost / damage / summon). */
  augmentFlags: AugmentFlags;
  /**
   * Card-category histogram of the registered 30-card deck, computed once at
   * match creation. Drives the deck analyzer. NEVER projected to public state
   * (it reveals the archetype).
   */
  registeredCategoryCounts: Record<string, number>;
}

/**
 * Transient state of an active special phase (amplification or voting). Lives on
 * `MatchState` only while `phase !== "NORMAL_PLAY"` and is cleared on resolution.
 * Amplification options are kept here (private) — only the matching seat's options
 * are projected into that seat's private message; the public view exposes counts
 * and "selected" flags only.
 */
export interface SpecialPhaseState {
  phase: Exclude<Phase, "NORMAL_PLAY">;
  phaseDeadlineAtMs: number;
  /** Whose turn was interrupted and resumes once the phase resolves. */
  resumeSeat: Seat;
  /** Turn number when the phase opened — guards against re-triggering it. */
  resumeTurnNumber: number;
  amplificationOptions?: Record<Seat, AmplificationOption[]>;
  amplificationChoice?: Partial<Record<Seat, string>>;
  amplificationRerollUsed?: Partial<Record<Seat, boolean>>;
  amplificationRerollLimit?: Partial<Record<Seat, number>>;
  amplificationRerollCount?: Partial<Record<Seat, number>>;
  voteEvents?: VoteEvent[];
  /** Integer roulette weights (a seat's weight is the OPPONENT's HP). */
  voteWeightsInt?: Record<Seat, number>;
  voteChoice?: Partial<Record<Seat, 0 | 1 | 2>>;
}

/** A global environment effect applied by a referendum, with optional expiry. */
export interface ActiveEnvironment {
  id: string;
  name: string;
  appliedTurn: number;
  /** First turn number where the effect is no longer active; omitted for permanent effects. */
  expiresTurn?: number;
  effect: EffectDefinition;
}

export interface PrivateMatchState {
  rngState: number;
  nextInstanceSeq: number;
  nextEventSeq: number;
  processedCommandIds: string[];
  actionLog: CommandEnvelope[];
  eventLog: GameEvent[];
  turnActionTaken: boolean;
  turnTimeLimitMs: number;
  devTestInfiniteMana?: Partial<Record<Seat, boolean>>;
  /**
   * 起底 / Discover candidates pulled out of the prompted seat's deck while
   * `pendingPrompt` is open. Private — never projected to public state (it would
   * leak deck order). On resolve the chosen card goes to hand and the rest are
   * shuffled back into the deck.
   */
  pendingChoice?: PendingChoice;
}

export interface PendingChoice {
  promptId: string;
  seat: Seat;
  sourceInstanceId: string;
  label?: string;
  cards: RuntimeCard[];
  /** True when candidates were pulled from the graveyard (陣亡區) instead of the deck. */
  fromGraveyard?: boolean;
  /** The originating CHANNEL effect, retained so a multi-pick (起底兩張) can re-open. */
  channelEffect?: EffectDefinition;
  /** Remaining pick-one rounds including this one; a value > 1 chains another reveal. */
  remainingPicks?: number;
}

export interface MatchState {
  matchId: string;
  schemaVersion: number;
  cardCatalogVersion: string;
  status: GameStatus;
  phase: Phase;
  turn: TurnState;
  /** The two amplification-phase tiers, rolled once at match creation and shared by both seats. */
  augmentTiers: [AmplificationTier, AmplificationTier];
  players: Record<Seat, PlayerState>;
  pendingPrompt?: PendingPrompt;
  specialPhase?: SpecialPhaseState;
  currentEnvironment?: ActiveEnvironment;
  result?: MatchResult;
  private: PrivateMatchState;
}

export interface PlayerSetup {
  seat: Seat;
  userId: string;
  displayName: string;
  deckIds: string[];
  ownedCardIds?: string[];
}

export interface CreateMatchInput {
  matchId: string;
  cardCatalogVersion: string;
  players: [PlayerSetup, PlayerSetup];
  seed: number;
  nowMs: number;
  mulliganTimeLimitMs?: number;
  turnTimeLimitMs?: number;
  catalog: readonly CardDefinition[];
}

export interface RulesResult {
  state: MatchState;
  events: GameEvent[];
}

export interface EffectContext {
  state: MatchState;
  activeSeat: Seat;
  source?: RuntimeCard | RuntimeMinion;
  target?: TargetRef;
  events: GameEvent[];
  catalog: Map<string, CardDefinition>;
}

export interface EffectHandler {
  (effect: EffectDefinition, context: EffectContext): void;
}

export interface TargetUnitRef {
  owner: PlayerState;
  kind: "HERO" | "MINION";
  unit: PlayerState["hero"] | RuntimeMinion;
}

export type PublicStateProjector = (state: MatchState) => PublicGameState;
export type HandProjector = (state: MatchState, seat: Seat) => HandCardView[];
export type PublicMinionProjector = (minion: RuntimeMinion) => PublicMinion;
export type PublicPlayerProjector = (player: PlayerState) => PublicPlayer;
