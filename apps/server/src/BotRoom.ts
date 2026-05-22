import { CARD_CATALOG } from "@twcardgame/cards";
import { decide, legalMoves, normalizeSeed, type BotRngState } from "@twcardgame/rules";
import {
  AI_THEMES,
  AI_THEME_DECKS,
  isAiTheme,
  type AiDifficulty,
  type AiTheme,
  type CommandEnvelope,
  type Seat
} from "@twcardgame/shared";
import { type Client } from "colyseus";
import { GameRoom, type GameRoomCreateOptions } from "./GameRoom.js";
import { defaultDeckIds, type JoinOptions, type PlayerSetup } from "./accounts.js";
import type { MatchPersistenceMetadata } from "./persistence.js";

const BOT_MULLIGAN_DELAY_MS = parseInt(process.env.BOT_MULLIGAN_DELAY_MS ?? process.env.BOT_THINK_DELAY_MS ?? "1000", 10);
const BOT_DRAW_DELAY_MS = parseInt(
  process.env.BOT_DRAW_DELAY_MS ?? process.env.BOT_TURN_START_DELAY_MS ?? process.env.BOT_THINK_DELAY_MS ?? "2200",
  10
);
const BOT_PLAY_INTERVAL_MS = parseInt(
  process.env.BOT_PLAY_INTERVAL_MS ?? process.env.BOT_ACTION_DELAY_MS ?? process.env.BOT_THINK_DELAY_MS ?? "1700",
  10
);
const BOT_END_TURN_DELAY_MS = parseInt(
  process.env.BOT_END_TURN_DELAY_MS ?? process.env.BOT_ACTION_DELAY_MS ?? process.env.BOT_THINK_DELAY_MS ?? "900",
  10
);

const ALLOWED_DIFFICULTIES: readonly AiDifficulty[] = ["easy", "normal", "hard"];

export interface BotRoomCreateOptions extends GameRoomCreateOptions {
  difficulty?: AiDifficulty;
  theme?: AiTheme;
}

const BOT_NAMES: Record<AiDifficulty, string> = {
  easy: "AI 初心者",
  normal: "AI 對手",
  hard: "AI 老將"
};

export class BotRoom extends GameRoom {
  override maxClients = 1;
  private difficulty: AiDifficulty = "normal";
  private theme?: AiTheme;
  private botSeat: Seat = "player2";
  private humanSeat: Seat = "player1";
  // RNG seeded deterministically from the roomId so a recorded command log
  // replays identically. Kept separate from the match rngState because the
  // bot's choices must not perturb gameplay randomness.
  private botRng: BotRngState = { state: 0 };
  private commandCounter = 0;
  private botStepScheduled = false;
  private lastBotTurnKey?: string;

  override onCreate(options: BotRoomCreateOptions = {}): void {
    super.onCreate({ ...options, joinCode: options.joinCode, private: true });
    if (options.difficulty && ALLOWED_DIFFICULTIES.includes(options.difficulty)) {
      this.difficulty = options.difficulty;
    }
    if (isAiTheme(options.theme)) {
      this.theme = options.theme;
    }
    this.botRng = {
      state: normalizeSeed(seedFromString(`${this.roomId}:${this.difficulty}:${this.theme ?? "default"}`))
    };
    this.setMetadata({
      ...(this.metadata ?? {}),
      mode: "pve",
      difficulty: this.difficulty,
      theme: this.theme ?? null
    });
  }

  override async onJoin(client: Client, options: JoinOptions = {}, auth?: PlayerSetup): Promise<void> {
    if (this.match) {
      client.send("error", { message: "Bot room already has a match in progress." });
      return;
    }
    const humanSetup = auth ?? (await this.accountStore.resolvePlayerSetup(client.sessionId, options));

    this.seats.set(client.sessionId, this.humanSeat);
    this.setup.set(this.humanSeat, humanSetup);
    this.setup.set(this.botSeat, this.buildBotSetup());
    client.send("seat", { seat: this.humanSeat });
    client.send("bot", { seat: this.botSeat, difficulty: this.difficulty, theme: this.theme ?? null });

    this.createMatch();
  }

  override async onLeave(client: Client): Promise<void> {
    // PvE rooms don't bother with reconnection windows — if the human drops, dispose.
    this.seats.delete(client.sessionId);
    if (this.match && this.match.status !== "finished" && this.match.status !== "abandoned") {
      this.finalizer.finish(this.match, { reason: "abandoned" });
    }
    await this.disconnect();
  }

  protected override afterMatchCreated(): void {
    this.scheduleBotStep();
  }

  protected override afterCommandApplied(_envelope: CommandEnvelope): void {
    this.scheduleBotStep();
  }

  protected override getMatchPersistenceMetadata(): MatchPersistenceMetadata {
    return { isVsAi: true, aiDifficulty: this.difficulty };
  }

  private buildBotSetup(): PlayerSetup {
    const themeDeck = this.theme ? AI_THEME_DECKS[this.theme] : undefined;
    return {
      userId: `bot-${this.roomId}`,
      displayName: this.botDisplayName(),
      // A themed deck when the player picked a challenge, otherwise the static
      // dev fallback so the bot doesn't mirror the human.
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

  private scheduleBotStep(): void {
    if (this.botStepScheduled) return;
    if (!this.match) return;
    if (this.match.status === "finished" || this.match.status === "abandoned") return;

    if (this.match.status === "mulligan") {
      const botPlayer = this.match.players[this.botSeat];
      if (botPlayer.mulliganReady) return;
      this.botStepScheduled = true;
      this.clock.setTimeout(() => {
        this.botStepScheduled = false;
        this.runBotMulligan();
      }, BOT_MULLIGAN_DELAY_MS);
      return;
    }

    if (this.match.turn.activeSeat !== this.botSeat) return;
    if (this.match.pendingPrompt && this.match.pendingPrompt.seat !== this.botSeat) return;

    const botTurnKey = `${this.match.turn.number}:${this.match.turn.activeSeat}`;
    const isFirstStepThisTurn = this.lastBotTurnKey !== botTurnKey;
    this.lastBotTurnKey = botTurnKey;
    this.botStepScheduled = true;
    this.clock.setTimeout(() => {
      this.botStepScheduled = false;
      this.runBotTurnStep();
    }, isFirstStepThisTurn ? BOT_DRAW_DELAY_MS : BOT_PLAY_INTERVAL_MS);
  }

  private runBotMulligan(): void {
    if (!this.match || this.match.status !== "mulligan") return;
    const envelope: CommandEnvelope = {
      commandId: this.nextCommandId("mull"),
      seat: this.botSeat,
      nowMs: Date.now(),
      command: { type: "submitMulligan", replaceHandInstanceIds: [] }
    };
    this.applyEnvelope(envelope);
  }

  private runBotTurnStep(): void {
    if (!this.match) return;
    if (this.match.turn.activeSeat !== this.botSeat) return;
    if (this.match.status !== "in_progress") return;

    const moves = legalMoves(this.match, this.botSeat);
    if (moves.length === 0) {
      // Defensive: always end the turn if the bot somehow has nothing legal.
      this.scheduleBotEndTurn();
      return;
    }

    const move = decide(this.match, this.botSeat, this.difficulty, this.botRng, CARD_CATALOG, Date.now());
    if (!move) {
      this.scheduleBotEndTurn();
      return;
    }

    if (move.type === "endTurn") {
      this.scheduleBotEndTurn();
      return;
    }

    this.applyEnvelope({
      commandId: this.nextCommandId("act"),
      seat: this.botSeat,
      nowMs: Date.now(),
      command: move
    });
  }

  private scheduleBotEndTurn(): void {
    if (this.botStepScheduled) return;
    this.botStepScheduled = true;
    this.clock.setTimeout(() => {
      this.botStepScheduled = false;
      if (!this.match) return;
      if (this.match.status !== "in_progress") return;
      if (this.match.turn.activeSeat !== this.botSeat) return;
      this.applyEnvelope({
        commandId: this.nextCommandId("end"),
        seat: this.botSeat,
        nowMs: Date.now(),
        command: { type: "endTurn" }
      });
    }, BOT_END_TURN_DELAY_MS);
  }

  private nextCommandId(tag: string): string {
    this.commandCounter += 1;
    return `bot-${this.roomId}-${tag}-${this.commandCounter}`;
  }
}

function seedFromString(input: string): number {
  let seed = 2166136261;
  for (let i = 0; i < input.length; i++) {
    seed ^= input.charCodeAt(i);
    seed = Math.imul(seed, 16777619);
  }
  return seed >>> 0;
}
