import { CARD_CATALOG } from "@twcardgame/cards";
import {
  decide,
  legalMoves,
  normalizeSeed,
  type BotRngState,
  type MatchState
} from "@twcardgame/rules";
import {
  AI_DIFFICULTIES,
  AI_THEME_DECKS,
  AI_THEMES,
  estimateEventAnimationMs,
  isAiTheme,
  type AiDifficulty,
  type AiTheme,
  type CommandEnvelope,
  type DevTestMatchSetup,
  type GameEvent,
  type Seat
} from "@twcardgame/shared";
import { applyChallengeHandicap } from "./challengeHandicap.js";
import { defaultDeckIds } from "./decks.js";
import { applyDevTestMatchSetup } from "./devTest.js";
import { seedFromString } from "./finalize.js";
import {
  GameSession,
  type GameSessionOptions,
  type PlayerSetup,
  type SessionHost
} from "./GameSession.js";
import type { MatchMetadata } from "./matchServices.js";

// Pacing defaults, ported from apps/server/src/BotRoom.ts. (The Colyseus version
// reads BOT_*_DELAY_MS env overrides; on Workers these are plain constants — the
// overrides were only ever for local tuning.)
const BOT_MULLIGAN_DELAY_MS = 1_000;
const BOT_DRAW_DELAY_MS = 2_200;
const BOT_PLAY_INTERVAL_MS = 1_700;
const BOT_END_TURN_DELAY_MS = 900;
const BOT_ANIMATION_BUFFER_MS = 200;

const BOT_NAMES: Record<AiDifficulty, string> = {
  easy: "AI 初心者",
  normal: "AI 對手",
  hard: "AI 老將"
};

export interface BotGameSessionOptions extends GameSessionOptions {
  difficulty?: AiDifficulty;
  theme?: AiTheme;
  /**
   * Challenge mode (挑戰模式). When true the bot always uses the `hard` decision
   * engine regardless of the selected tier, and the per-tier stat handicap is
   * applied. 電腦模式 (practice) leaves this false: the tier picks the engine and
   * there is no handicap. `difficulty` still carries the tier (rewards/labels).
   */
  challenge?: boolean;
  /**
   * Localhost-only dev-test board setup. When present the match is created with a
   * scripted board instead of a normal mulligan opening (mirrors BotRoom's
   * `customizeInitialMatch`), and finalize side-effects are skipped.
   */
  devTest?: DevTestMatchSetup;
}

/**
 * PvE session — the Durable Object port of apps/server/src/BotRoom.ts. The bot's
 * decision logic (`decide` / `legalMoves`) is byte-identical; only the pacing
 * changes: BotRoom's many `clock.setTimeout` calls become a single pending
 * "bot step" time folded into the one DO Alarm (via `additionalDeadline` /
 * `additionalWake`). `bot.decide` and the seeded `BotRngState` are untouched, so
 * a recorded command log still replays identically.
 */
export class BotGameSession extends GameSession {
  private readonly difficulty: AiDifficulty;
  private readonly challenge: boolean;
  private readonly theme?: AiTheme;
  private readonly botSeat: Seat = "player2";
  private readonly humanSeat: Seat = "player1";
  // Seeded deterministically from the room id, kept separate from the match RNG
  // so the bot's choices never perturb gameplay randomness (BotRoom parity).
  private botRng: BotRngState;
  private botStepAtMs?: number;
  private botPending?: "step" | "endTurn";
  private lastBotTurnKey?: string;
  private lastBatchAnimationMs = 0;
  // Dev-test board setup (consumed once at match creation) + a sticky flag so a
  // restored/hibernated dev-test match still skips finalize side-effects.
  private readonly devTestSetup?: DevTestMatchSetup;
  private devTestActive = false;

  constructor(host: SessionHost, options: BotGameSessionOptions) {
    super(host, options);
    this.difficulty = options.difficulty && AI_DIFFICULTIES.includes(options.difficulty) ? options.difficulty : "normal";
    this.challenge = options.challenge === true;
    this.theme = isAiTheme(options.theme) ? options.theme : undefined;
    this.devTestSetup = options.devTest;
    this.botRng = {
      state: normalizeSeed(seedFromString(`${options.matchId}:${this.difficulty}:${this.theme ?? "default"}`))
    };
    // Pre-occupy the bot seat so the lone human's join immediately starts the
    // match (BotRoom.onJoin sets both seats then createMatch — maxClients = 1).
    this.fillSeat(this.botSeat, "bot", this.buildBotSetup());
  }

  /** Identity for the client's `bot` message (mirrors BotRoom's client.send("bot", …)). */
  get botInfo(): { seat: Seat; difficulty: AiDifficulty; theme: AiTheme | null } {
    return { seat: this.botSeat, difficulty: this.difficulty, theme: this.theme ?? null };
  }

  /**
   * The decision engine the bot actually plays with. Challenge mode forces `hard`
   * for every tier; practice mode uses the selected tier. (The `difficulty` tier is
   * still what drives rewards, labels, the seed and `botInfo`.)
   */
  get engineDifficulty(): AiDifficulty {
    return this.challenge ? "hard" : this.difficulty;
  }

  protected override get kind(): "pvp" | "pve" {
    return "pve";
  }

  protected override matchMetadata(): MatchMetadata {
    return {
      isVsAi: true,
      aiDifficulty: this.difficulty,
      aiTheme: this.theme,
      startedAtMs: super.matchMetadata().startedAtMs,
      // Dev-test matches are throwaway: the DO uses this to skip persistence/rewards.
      devTest: this.devTestActive
    };
  }

  /**
   * Port of BotRoom.customizeInitialMatch: when a dev-test setup is present,
   * discard the normal opening (events + mulligan) and stamp the scripted board.
   * Runs inside GameSession.createMatch before the first broadcast.
   */
  protected override customizeInitialMatch(state: MatchState, events: GameEvent[]): void {
    // Challenge-mode handicap buffs the bot's hero HP + starting crystals by tier
    // (專家級/大師級; 普通級 is a no-op). Challenge-only: 電腦模式 (practice) gets the
    // selected engine but fair stats. Applied before the dev-test override so a
    // scripted board still gets the handicap.
    if (this.challenge) applyChallengeHandicap(state, this.botSeat, this.difficulty);
    if (!this.devTestSetup) return;
    this.devTestActive = true;
    events.length = 0;
    applyDevTestMatchSetup(state, this.devTestSetup, this.now(), events);
  }

  // PvE has no turn clock for the human (BotRoom.usesActionDeadlines === false);
  // the only scheduled work is bot pacing (+ the reconnect window).
  protected override usesActionDeadlines(): boolean {
    return false;
  }

  protected override afterMatchCreated(): void {
    this.scheduleBotStep();
  }

  protected override afterReconnect(_seat: Seat): void {
    // Resume pacing in case it was the bot's turn when the human dropped.
    this.scheduleBotStep();
  }

  protected override afterCommandApplied(_envelope: CommandEnvelope, events: GameEvent[]): void {
    this.lastBatchAnimationMs = estimateEventAnimationMs(events);
    this.scheduleBotStep();
  }

  protected override additionalDeadline(): number | null {
    return this.botStepAtMs ?? null;
  }

  protected override additionalWake(now: number): void {
    if (this.botStepAtMs === undefined || now < this.botStepAtMs) return;
    const pending = this.botPending;
    this.botStepAtMs = undefined;
    this.botPending = undefined;
    if (pending === "endTurn") this.runBotEndTurn();
    else this.runBotStep();
  }

  /* --------------------------------- bot pacing (DO Alarm) --------------------------------- */

  /** Port of BotRoom.scheduleBotStep — decide WHEN the bot's next action runs. */
  private scheduleBotStep(): void {
    if (this.botStepAtMs !== undefined) return; // already scheduled
    const match = this.match;
    if (!match) return;
    if (match.status === "finished" || match.status === "abandoned") return;
    // Don't let the bot play on while the human is disconnected — wait for them
    // to return (or for the reconnect window to expire and finalize the match).
    if (!match.players[this.humanSeat].connected) return;

    if (match.status === "mulligan") {
      if (match.players[this.botSeat].mulliganReady) return;
      this.armBotStep("step", BOT_MULLIGAN_DELAY_MS);
      return;
    }

    // Special phases (amplification/voting) let either seat act, so the bot must
    // make its choice regardless of whose turn was interrupted.
    if (match.phase !== "NORMAL_PLAY") {
      if (legalMoves(match, this.botSeat).length === 0) return; // bot already chose
      this.armBotStep("step", BOT_PLAY_INTERVAL_MS);
      return;
    }

    if (match.turn.activeSeat !== this.botSeat) return;
    if (match.pendingPrompt && match.pendingPrompt.seat !== this.botSeat) return;

    const botTurnKey = `${match.turn.number}:${match.turn.activeSeat}`;
    const isFirstStepThisTurn = this.lastBotTurnKey !== botTurnKey;
    this.lastBotTurnKey = botTurnKey;
    const baseDelay = isFirstStepThisTurn ? BOT_DRAW_DELAY_MS : BOT_PLAY_INTERVAL_MS;
    const animationDelay = this.lastBatchAnimationMs > 0 ? this.lastBatchAnimationMs + BOT_ANIMATION_BUFFER_MS : 0;
    this.lastBatchAnimationMs = 0;
    this.armBotStep("step", Math.max(baseDelay, animationDelay));
  }

  private armBotStep(pending: "step" | "endTurn", delayMs: number): void {
    this.botPending = pending;
    this.botStepAtMs = this.now() + delayMs;
    this.scheduleWake();
  }

  private runBotStep(): void {
    const match = this.match;
    if (!match) return;
    if (match.status === "mulligan") {
      this.runBotMulligan();
      return;
    }
    if (match.phase !== "NORMAL_PLAY") {
      this.runBotPhaseStep();
      return;
    }
    this.runBotTurnStep();
  }

  private runBotMulligan(): void {
    const match = this.match;
    if (!match || match.status !== "mulligan") return;
    this.applyServerCommand(this.botSeat, "bot-mull", { type: "submitMulligan", replaceHandInstanceIds: [] });
  }

  private runBotTurnStep(): void {
    const match = this.match;
    if (!match) return;
    if (match.turn.activeSeat !== this.botSeat) return;
    if (match.status !== "in_progress") return;

    const moves = legalMoves(match, this.botSeat);
    if (moves.length === 0) {
      this.scheduleBotEndTurn();
      return;
    }

    const move = decide(match, this.botSeat, this.engineDifficulty, this.botRng, CARD_CATALOG, this.now());
    if (!move || move.type === "endTurn") {
      this.scheduleBotEndTurn();
      return;
    }
    this.applyServerCommand(this.botSeat, "bot-act", move);
  }

  private runBotPhaseStep(): void {
    const match = this.match;
    if (!match || match.phase === "NORMAL_PLAY") return;
    if (legalMoves(match, this.botSeat).length === 0) return;
    const move = decide(match, this.botSeat, this.engineDifficulty, this.botRng, CARD_CATALOG, this.now());
    if (!move) return;
    this.applyServerCommand(this.botSeat, "bot-phase", move);
  }

  private scheduleBotEndTurn(): void {
    if (this.botStepAtMs !== undefined) return;
    const animationDelay = this.lastBatchAnimationMs > 0 ? this.lastBatchAnimationMs + BOT_ANIMATION_BUFFER_MS : 0;
    this.lastBatchAnimationMs = 0;
    this.armBotStep("endTurn", Math.max(BOT_END_TURN_DELAY_MS, animationDelay));
  }

  private runBotEndTurn(): void {
    const match = this.match;
    if (!match || match.status !== "in_progress") return;
    if (match.turn.activeSeat !== this.botSeat) return;
    this.applyServerCommand(this.botSeat, "bot-end", { type: "endTurn" });
  }

  private buildBotSetup(): PlayerSetup {
    const themeDeck = this.theme ? AI_THEME_DECKS[this.theme] : undefined;
    return {
      userId: `bot-${this.matchId}`,
      displayName: this.botDisplayName(),
      // Themed deck when the player picked a challenge, otherwise the dev fallback.
      deckIds: themeDeck ? [...themeDeck] : defaultDeckIds()
    };
  }

  private botDisplayName(): string {
    if (this.theme) {
      const definition = AI_THEMES.find((entry) => entry.id === this.theme);
      if (definition) return definition.name;
    }
    return BOT_NAMES[this.difficulty];
  }

  /* --------------------------------- persistence --------------------------------- */

  protected override snapshotExtra(): Record<string, unknown> {
    return {
      difficulty: this.difficulty,
      challenge: this.challenge,
      theme: this.theme ?? null,
      botRng: this.botRng,
      botStepAtMs: this.botStepAtMs ?? null,
      botPending: this.botPending ?? null,
      lastBotTurnKey: this.lastBotTurnKey ?? null,
      lastBatchAnimationMs: this.lastBatchAnimationMs,
      devTestActive: this.devTestActive
    };
  }

  protected override restoreExtra(extra: Record<string, unknown>): void {
    if (extra.botRng) this.botRng = extra.botRng as BotRngState;
    this.botStepAtMs = typeof extra.botStepAtMs === "number" ? extra.botStepAtMs : undefined;
    this.botPending = (extra.botPending as "step" | "endTurn" | null | undefined) ?? undefined;
    this.lastBotTurnKey = (extra.lastBotTurnKey as string | null | undefined) ?? undefined;
    if (typeof extra.lastBatchAnimationMs === "number") this.lastBatchAnimationMs = extra.lastBatchAnimationMs;
    this.devTestActive = extra.devTestActive === true;
  }
}
