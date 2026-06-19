import type {
  AmplificationOption,
  GameCommand,
  GameEvent,
  HandCardView,
  PublicMinion,
  PublicPlayer,
  Seat,
  TargetRef
} from "@twcardgame/shared";
import { AMPLIFICATION_DB, VOTE_EVENT_DB } from "@twcardgame/cards";
import type {
  TrainingAllowedAction,
  TrainingHighlight,
  TrainingLevelInfo,
  TrainingPrompt,
  TrainingSession,
  TrainingSpecialPhase
} from "./training.js";

/**
 * --- SCRIPTED TRAINING LESSONS (第3~5關) ---
 *
 * These guided "watch-and-try" levels teach card mechanics. Unlike the legacy
 * switch-based levels 1-2 in training.ts, they are data-driven: each level is an
 * ordered list of {@link TrainingScriptStep}s run by a tiny generic engine. A
 * step is either an INFO step (`action: "next"`, shows the coach panel; its
 * `apply` plays a scripted demo when the player clicks 下一步) or a GATED step
 * (the player must do the indicated action — play a card, attack, pick an
 * amplification, or vote — before advancing).
 *
 * This module imports ONLY types from training.ts (erased at runtime), so the
 * runtime dependency edge is one-way (training.ts → training-scripts.ts) and
 * there is no import cycle.
 */

const PLAYER: Seat = "player1";
const OPPONENT: Seat = "player2";
const HERO_HP = 30;

export interface TrainingScriptStep {
  id: string;
  title: string;
  body: string;
  action: TrainingAllowedAction;
  highlights?: TrainingHighlight[];
  /** Hand card the player is allowed to select/play on a gated `script_play` step. */
  selectHandId?: string;
  /** Attacker the player is allowed to select on a gated `script_attack` step. */
  selectAttackerId?: string;
  /** INFO steps: scripted demo to play when the player advances past this step. */
  apply?: (session: TrainingSession) => GameEvent[];
  /** GATED steps: validate the player's command. */
  match?: (command: GameCommand, session: TrainingSession) => boolean;
  /** GATED steps: mutate state + emit events when the command matches. */
  resolve?: (session: TrainingSession, command: GameCommand) => GameEvent[];
}

export interface ScriptSetup {
  players: { player1: PublicPlayer; player2: PublicPlayer };
  hand: HandCardView[];
}

export interface TrainingScript {
  level: TrainingLevelInfo;
  setup: (playerName: string) => ScriptSetup;
  steps: TrainingScriptStep[];
}

export interface ScriptStepResult {
  events: GameEvent[];
  completed?: boolean;
  rejected?: string;
}

// ─── Level metadata ──────────────────────────────────────────────────────────

export const CARD_TYPES_TRAINING = {
  id: "card_types",
  name: "卡牌種類介紹",
  rewardGold: 100,
  heroHealth: HERO_HP,
  description: "認識沙包、光盾、觸發三種常見關鍵字。"
} as const;

export const ADVANCED_KEYWORDS_TRAINING = {
  id: "advanced_keywords",
  name: "進階關鍵字",
  rewardGold: 100,
  heroHealth: HERO_HP,
  description: "認識激怒、遺志、持續效果、回手牌。"
} as const;

export const AMP_FIELD_TRAINING = {
  id: "amp_field",
  name: "增幅與場地",
  rewardGold: 100,
  heroHealth: HERO_HP,
  description: "認識回合 7/14 的增幅與回合 20 的公投場地效果。"
} as const;

// ─── Generic engine ──────────────────────────────────────────────────────────

export function createScriptedSession(script: TrainingScript, playerName: string): TrainingSession {
  const init = script.setup(playerName);
  return {
    level: script.level,
    step: "completed",
    script,
    stepIndex: 0,
    status: "in_progress",
    activeSeat: PLAYER,
    turnNumber: 1,
    actionSeq: 0,
    seq: 1,
    phase: "NORMAL_PLAY",
    players: init.players,
    hand: init.hand
  };
}

function currentStep(session: TrainingSession): TrainingScriptStep | undefined {
  return session.script?.steps[session.stepIndex ?? 0];
}

export function scriptPrompt(session: TrainingSession): TrainingPrompt | undefined {
  const step = currentStep(session);
  if (!step) return undefined;
  return { title: step.title, body: step.body, allowedAction: step.action, highlights: step.highlights ?? [] };
}

export function advanceScript(session: TrainingSession): ScriptStepResult {
  const step = currentStep(session);
  if (!step) return { events: [], completed: true };
  if (step.action !== "next") return { events: [], rejected: "請照教學指示操作。" };
  const events = step.apply ? step.apply(session) : [];
  return commitStep(session, events);
}

export function handleScriptCommand(session: TrainingSession, command: GameCommand): ScriptStepResult {
  const step = currentStep(session);
  if (!step) return { events: [], completed: true };
  if (step.action === "next") return { events: [], rejected: "請點下一步繼續。" };
  if (step.match && !step.match(command, session)) {
    return { events: [], rejected: "這一步只能照教學指定的操作進行。" };
  }
  const events = step.resolve ? step.resolve(session, command) : [];
  return commitStep(session, events);
}

function commitStep(session: TrainingSession, events: GameEvent[]): ScriptStepResult {
  session.stepIndex = (session.stepIndex ?? 0) + 1;
  const done = session.stepIndex >= (session.script?.steps.length ?? 0);
  if (done) {
    session.status = "finished";
    session.result = { winnerSeat: PLAYER, reason: "hero_destroyed" };
    return {
      events: [...events, ev(session, "GAME_FINISHED", PLAYER, { winnerSeat: PLAYER, reason: "hero_destroyed" })],
      completed: true
    };
  }
  return { events };
}

export function scriptCanSelectHand(session: TrainingSession, handInstanceId: string | undefined): boolean {
  if (!handInstanceId) return true;
  return currentStep(session)?.selectHandId === handInstanceId;
}

export function scriptCanSelectAttacker(session: TrainingSession, attackerInstanceId: string | undefined): boolean {
  if (!attackerInstanceId) return true;
  return currentStep(session)?.selectAttackerId === attackerInstanceId;
}

export function scriptCanEndTurn(): boolean {
  // Lessons never use the end-turn button.
  return false;
}

// ─── Builders ────────────────────────────────────────────────────────────────

function ev(session: TrainingSession, type: GameEvent["type"], seat: Seat, payload: Record<string, unknown> = {}): GameEvent {
  return { seq: session.seq++, type, seat, payload };
}

function makePlayer(seat: Seat, displayName: string, manaCurrent: number, board: PublicMinion[], handCount: number): PublicPlayer {
  return {
    userId: `training-${seat}`,
    displayName,
    connected: true,
    hero: { hp: HERO_HP, maxHp: HERO_HP },
    mana: { current: manaCurrent, max: Math.max(manaCurrent, 10) },
    handCount,
    deckCount: 0,
    graveyardCount: 0,
    mulliganReady: true,
    board
  };
}

function makeMinion(
  instanceId: string,
  cardId: string,
  ownerSeat: Seat,
  attack: number,
  health: number,
  opts: Partial<PublicMinion> = {}
): PublicMinion {
  return {
    instanceId,
    cardId,
    ownerSeat,
    attack,
    baseAttack: attack,
    health,
    currentHealth: health,
    taunt: false,
    charge: false,
    divineShield: false,
    lockedTurns: 0,
    sleeping: false,
    canAttack: false,
    isEnraged: false,
    ...opts
  };
}

function handCard(instanceId: string, cardId: string, cost: number, type: HandCardView["type"], attack?: number, health?: number): HandCardView {
  return { instanceId, cardId, cost, type, attack, health };
}

/** Replaces a seat's board, emitting a summon cue for each freshly placed minion. */
function setBoard(session: TrainingSession, seat: Seat, board: PublicMinion[]): GameEvent[] {
  session.players[seat] = { ...session.players[seat], board };
  return board.map((m) => ev(session, "MINION_SUMMONED", seat, { target: m.instanceId, cardId: m.cardId }));
}

function findMinion(session: TrainingSession, seat: Seat, instanceId: string): PublicMinion | undefined {
  return session.players[seat].board.find((m) => m.instanceId === instanceId);
}

function setPlayerBoard(session: TrainingSession, seat: Seat, board: PublicMinion[]): void {
  session.players[seat] = { ...session.players[seat], board };
}

function addHand(session: TrainingSession, card: HandCardView): void {
  session.hand = [...session.hand, card];
  session.players[PLAYER] = { ...session.players[PLAYER], handCount: session.hand.length };
}

function removeHand(session: TrainingSession, instanceId: string): void {
  session.hand = session.hand.filter((c) => c.instanceId !== instanceId);
  session.players[PLAYER] = { ...session.players[PLAYER], handCount: session.hand.length };
}

function isAttack(command: GameCommand, attackerId: string, target: TargetRef): boolean {
  return command.type === "attack" && command.attackerInstanceId === attackerId && sameTarget(command.target, target);
}

function sameTarget(a: TargetRef | undefined, b: TargetRef): boolean {
  if (!a || a.type !== b.type || a.side !== b.side) return false;
  if (a.type === "MINION" && b.type === "MINION") return a.instanceId === b.instanceId;
  return true;
}

// ─── Lesson 3: 卡牌種類介紹 (沙包 / 光盾 / 觸發) ──────────────────────────────

const L3_TAUNT_HAND = "l3-taunt-hand";
const L3_TAUNT = "l3-taunt";
const L3_SAVED = "l3-saved";
const L3_ENEMY = "l3-enemy";
const L3_SHIELD = "l3-shield";
const L3_ATTACKER = "l3-attacker";
const L3_FRIEND_A = "l3-friend-a";
const L3_FRIEND_B = "l3-friend-b";
const L3_BATTLECRY_HAND = "l3-battlecry-hand";
const L3_BATTLECRY_MINION = "l3-battlecry-minion";
const L3_BC_ENEMY = "l3-bc-enemy";

const CARD_TYPES_SCRIPT: TrainingScript = {
  level: CARD_TYPES_TRAINING,
  setup: () => ({
    players: {
      player1: makePlayer(PLAYER, "玩家", 10, [makeMinion(L3_SAVED, "TW044", PLAYER, 3, 2)], 1),
      player2: makePlayer(OPPONENT, "訓練教官", 0, [makeMinion(L3_ENEMY, "TW045", OPPONENT, 4, 5, { canAttack: true })], 0)
    },
    hand: [handCard(L3_TAUNT_HAND, "TW023", 7, "MINION", 3, 8)]
  }),
  steps: [
    {
      id: "l3_intro",
      title: "第三關：卡牌種類介紹",
      body: "這一關介紹三種常見的卡牌關鍵字：沙包、光盾、觸發。先看【沙包】——敵方的『蘇巧慧』有 4 攻擊，下個回合就會撲過來殺掉你生命只剩 2 的『黃捷』。我們用沙包把它擋下，保住黃捷。",
      action: "next",
      highlights: [
        { type: "unit", seat: OPPONENT, instanceId: L3_ENEMY },
        { type: "unit", seat: PLAYER, instanceId: L3_SAVED }
      ]
    },
    {
      id: "l3_taunt_explain",
      title: "沙包",
      body: "【沙包】：只要場上有沙包隨從，敵方就必須先攻擊它，不能越過去打你的英雄或其他隨從。你手上的『陳玉珍』是 3/8 沙包，把她擋在前線，後面的黃捷就安全了。",
      action: "next",
      highlights: [{ type: "hand", instanceId: L3_TAUNT_HAND }, { type: "cardCost", instanceId: L3_TAUNT_HAND }]
    },
    {
      id: "l3_taunt_do",
      title: "換你操作：築起沙包牆",
      body: "把手牌的『陳玉珍』打到戰場上，擋在黃捷前面。",
      action: "script_play",
      selectHandId: L3_TAUNT_HAND,
      highlights: [{ type: "hand", instanceId: L3_TAUNT_HAND }],
      match: (command) => command.type === "playCard" && command.handInstanceId === L3_TAUNT_HAND,
      resolve: (session) => {
        removeHand(session, L3_TAUNT_HAND);
        setPlayerBoard(session, PLAYER, [
          ...session.players[PLAYER].board,
          makeMinion(L3_TAUNT, "TW023", PLAYER, 3, 8, { taunt: true, sleeping: true })
        ]);
        return [
          ev(session, "CARD_PLAYED", PLAYER, { handInstanceId: L3_TAUNT_HAND, cardId: "TW023" }),
          ev(session, "MINION_SUMMONED", PLAYER, { target: L3_TAUNT, cardId: "TW023" })
        ];
      }
    },
    {
      id: "l3_taunt_demo",
      title: "沙包生效",
      body: "陳玉珍站上了前線。按下一步，看敵方蘇巧慧的行動——它被迫攻擊有沙包的陳玉珍，完全碰不到後面的黃捷。",
      action: "next",
      highlights: [
        { type: "unit", seat: PLAYER, instanceId: L3_TAUNT },
        { type: "unit", seat: PLAYER, instanceId: L3_SAVED }
      ],
      apply: (session) => {
        const taunt = findMinion(session, PLAYER, L3_TAUNT)!;
        const enemy = findMinion(session, OPPONENT, L3_ENEMY)!;
        setPlayerBoard(session, PLAYER, session.players[PLAYER].board.map((m) =>
          m.instanceId === L3_TAUNT ? { ...m, currentHealth: m.currentHealth - enemy.attack } : m));
        setPlayerBoard(session, OPPONENT, session.players[OPPONENT].board.map((m) =>
          m.instanceId === L3_ENEMY ? { ...m, currentHealth: m.currentHealth - taunt.attack, canAttack: false } : m));
        return [
          ev(session, "ATTACK", OPPONENT, { attackerInstanceId: L3_ENEMY, target: { type: "MINION", side: PLAYER, instanceId: L3_TAUNT } }),
          ev(session, "DAMAGE", PLAYER, { target: L3_TAUNT, amount: enemy.attack }),
          ev(session, "DAMAGE", OPPONENT, { target: L3_ENEMY, amount: taunt.attack })
        ];
      }
    },
    {
      id: "l3_taunt_result",
      title: "沙包的用途",
      body: "成功擋下！蘇巧慧的攻擊被陳玉珍吸走，後面的黃捷毫髮無傷地活了下來。沙包能把威脅引到沙包隨從身上，是保護其他隨從與英雄、穩住戰局的防守關鍵字。",
      action: "next",
      highlights: [
        { type: "unit", seat: PLAYER, instanceId: L3_TAUNT },
        { type: "unit", seat: PLAYER, instanceId: L3_SAVED }
      ],
      apply: (session) => {
        // Switch to the divine-shield demo.
        const events = setBoard(session, PLAYER, [makeMinion(L3_ATTACKER, "TW045", PLAYER, 4, 5, { canAttack: true })]);
        events.push(...setBoard(session, OPPONENT, [makeMinion(L3_SHIELD, "TW058", OPPONENT, 1, 1, { divineShield: true })]));
        return events;
      }
    },
    {
      id: "l3_shield_explain",
      title: "光盾",
      body: "接下來是【光盾】。敵方的『蔡想想』有光盾（金色外框），光盾能完全擋下一次傷害，之後才會消失。",
      action: "next",
      highlights: [{ type: "unit", seat: OPPONENT, instanceId: L3_SHIELD }]
    },
    {
      id: "l3_shield_do",
      title: "換你操作：打破光盾",
      body: "選擇我方發亮的隨從，攻擊敵方有光盾的蔡想想，把光盾打破。",
      action: "script_attack",
      selectAttackerId: L3_ATTACKER,
      highlights: [
        { type: "unit", seat: PLAYER, instanceId: L3_ATTACKER },
        { type: "unit", seat: OPPONENT, instanceId: L3_SHIELD }
      ],
      match: (command) => isAttack(command, L3_ATTACKER, { type: "MINION", side: OPPONENT, instanceId: L3_SHIELD }),
      resolve: (session) => {
        const shield = findMinion(session, OPPONENT, L3_SHIELD)!;
        setPlayerBoard(session, OPPONENT, session.players[OPPONENT].board.map((m) =>
          m.instanceId === L3_SHIELD ? { ...m, divineShield: false } : m));
        setPlayerBoard(session, PLAYER, session.players[PLAYER].board.map((m) =>
          m.instanceId === L3_ATTACKER ? { ...m, currentHealth: m.currentHealth - shield.attack, canAttack: false } : m));
        return [
          ev(session, "ATTACK", PLAYER, { attackerInstanceId: L3_ATTACKER, target: { type: "MINION", side: OPPONENT, instanceId: L3_SHIELD } }),
          ev(session, "SHIELD_POPPED", OPPONENT, { target: L3_SHIELD }),
          ev(session, "DAMAGE", PLAYER, { target: L3_ATTACKER, amount: shield.attack })
        ];
      }
    },
    {
      id: "l3_shield_result",
      title: "光盾破了",
      body: "蔡想想擋下了你的傷害但完全沒受傷，現在光盾消失了；下一次攻擊就會正常扣血。",
      action: "next",
      highlights: [{ type: "unit", seat: OPPONENT, instanceId: L3_SHIELD }],
      apply: (session) => {
        // Switch to the battlecry demo: 王定宇 (2/7) + 條碼師 (1/4) — original card stats — plus an enemy threat and a battlecry card in hand.
        const events = setBoard(session, PLAYER, [
          makeMinion(L3_FRIEND_A, "TW066", PLAYER, 2, 7, { canAttack: true }),
          makeMinion(L3_FRIEND_B, "TW004", PLAYER, 1, 4, { canAttack: true })
        ]);
        events.push(...setBoard(session, OPPONENT, [makeMinion(L3_BC_ENEMY, "TW045", OPPONENT, 2, 5)]));
        addHand(session, handCard(L3_BATTLECRY_HAND, "TW016", 5, "MINION", 2, 3));
        events.push(ev(session, "CARD_DRAWN", PLAYER, { cardId: "TW016" }));
        return events;
      }
    },
    {
      id: "l3_battlecry_explain",
      title: "觸發",
      body: "最後是【觸發】，觸發是隨從『打出當下』觸發一次的效果。敵方有個 2/5 隨從；你場上有一個 2 攻擊的『王定宇』和 1 攻擊的『條碼師』，合計只有 3 攻擊，差一點打不死它。手牌的『吳敦義』觸發是：賦予所有友方隨從 +1 攻擊力。",
      action: "next",
      highlights: [
        { type: "hand", instanceId: L3_BATTLECRY_HAND },
        { type: "cardCost", instanceId: L3_BATTLECRY_HAND },
        { type: "unit", seat: PLAYER, instanceId: L3_FRIEND_A },
        { type: "unit", seat: PLAYER, instanceId: L3_FRIEND_B },
        { type: "unit", seat: OPPONENT, instanceId: L3_BC_ENEMY }
      ]
    },
    {
      id: "l3_battlecry_do",
      title: "換你操作：打出觸發",
      body: "把『吳敦義』打到戰場上，看觸發如何讓兩個友方隨從各 +1 攻擊——攻擊力會變成綠色，代表被強化了。",
      action: "script_play",
      selectHandId: L3_BATTLECRY_HAND,
      highlights: [{ type: "hand", instanceId: L3_BATTLECRY_HAND }],
      match: (command) => command.type === "playCard" && command.handInstanceId === L3_BATTLECRY_HAND,
      resolve: (session) => {
        removeHand(session, L3_BATTLECRY_HAND);
        // Raise attack only (leave baseAttack) so the buffed value renders green (stat-higher).
        const buffed = session.players[PLAYER].board.map((m) => ({ ...m, attack: m.attack + 1 }));
        const newcomer = makeMinion(L3_BATTLECRY_MINION, "TW016", PLAYER, 2, 3, { sleeping: true });
        setPlayerBoard(session, PLAYER, [...buffed, newcomer]);
        const events = [
          ev(session, "CARD_PLAYED", PLAYER, { handInstanceId: L3_BATTLECRY_HAND, cardId: "TW016" }),
          ev(session, "MINION_SUMMONED", PLAYER, { target: L3_BATTLECRY_MINION, cardId: "TW016" })
        ];
        for (const m of buffed) events.push(ev(session, "BUFF", PLAYER, { target: m.instanceId, stat: "ATTACK", value: 1 }));
        return events;
      }
    },
    {
      id: "l3_battlecry_payoff_a",
      title: "換你操作：聯手解決威脅 (1/2)",
      body: "綠色的攻擊力代表被觸發強化了：2 攻擊的『王定宇』+1 變成 3。先用它攻擊敵方的 2/5 隨從，把它打到只剩 2 點生命。",
      action: "script_attack",
      selectAttackerId: L3_FRIEND_A,
      highlights: [
        { type: "unit", seat: PLAYER, instanceId: L3_FRIEND_A },
        { type: "minionStat", instanceId: L3_FRIEND_A, stat: "attack" },
        { type: "unit", seat: OPPONENT, instanceId: L3_BC_ENEMY }
      ],
      match: (command) => isAttack(command, L3_FRIEND_A, { type: "MINION", side: OPPONENT, instanceId: L3_BC_ENEMY }),
      resolve: (session) => {
        const attacker = findMinion(session, PLAYER, L3_FRIEND_A)!;
        const enemy = findMinion(session, OPPONENT, L3_BC_ENEMY)!;
        setPlayerBoard(session, PLAYER, session.players[PLAYER].board.map((m) =>
          m.instanceId === L3_FRIEND_A ? { ...m, currentHealth: m.currentHealth - enemy.attack, canAttack: false } : m));
        setPlayerBoard(session, OPPONENT, session.players[OPPONENT].board.map((m) =>
          m.instanceId === L3_BC_ENEMY ? { ...m, currentHealth: m.currentHealth - attacker.attack } : m));
        return [
          ev(session, "ATTACK", PLAYER, { attackerInstanceId: L3_FRIEND_A, target: { type: "MINION", side: OPPONENT, instanceId: L3_BC_ENEMY } }),
          ev(session, "DAMAGE", OPPONENT, { target: L3_BC_ENEMY, amount: attacker.attack }),
          ev(session, "DAMAGE", PLAYER, { target: L3_FRIEND_A, amount: enemy.attack })
        ];
      }
    },
    {
      id: "l3_battlecry_payoff_b",
      title: "換你操作：補上最後一擊 (2/2)",
      body: "條碼師也被 +1，攻擊力從 1 變成 2。用條碼師攻擊敵方隨從，補上最後 2 點傷害——3+2 剛好等於 5，把它解決掉。",
      action: "script_attack",
      selectAttackerId: L3_FRIEND_B,
      highlights: [
        { type: "unit", seat: PLAYER, instanceId: L3_FRIEND_B },
        { type: "minionStat", instanceId: L3_FRIEND_B, stat: "attack" },
        { type: "unit", seat: OPPONENT, instanceId: L3_BC_ENEMY }
      ],
      match: (command) => isAttack(command, L3_FRIEND_B, { type: "MINION", side: OPPONENT, instanceId: L3_BC_ENEMY }),
      resolve: (session) => {
        const attacker = findMinion(session, PLAYER, L3_FRIEND_B)!;
        const enemy = findMinion(session, OPPONENT, L3_BC_ENEMY)!;
        setPlayerBoard(session, PLAYER, session.players[PLAYER].board.map((m) =>
          m.instanceId === L3_FRIEND_B ? { ...m, currentHealth: m.currentHealth - enemy.attack, canAttack: false } : m));
        setPlayerBoard(session, OPPONENT, session.players[OPPONENT].board.filter((m) => m.instanceId !== L3_BC_ENEMY));
        session.players[OPPONENT] = {
          ...session.players[OPPONENT],
          graveyardCount: session.players[OPPONENT].graveyardCount + 1
        };
        return [
          ev(session, "ATTACK", PLAYER, { attackerInstanceId: L3_FRIEND_B, target: { type: "MINION", side: OPPONENT, instanceId: L3_BC_ENEMY } }),
          ev(session, "DAMAGE", OPPONENT, { target: L3_BC_ENEMY, amount: attacker.attack }),
          ev(session, "DAMAGE", PLAYER, { target: L3_FRIEND_B, amount: enemy.attack }),
          ev(session, "DESTROY", OPPONENT, { target: L3_BC_ENEMY, cardId: "TW045" })
        ];
      }
    },
    {
      id: "l3_battlecry_result",
      title: "觸發觸發了",
      body: "看到了嗎？吳敦義的觸發讓兩個隨從各 +1 攻擊（綠字），合計攻擊力從 3 變成 5，剛好聯手解決掉敵人，自己都還存活下來。觸發雖然只在打出當下觸發一次，但這一下就足以扭轉場面。",
      action: "next",
      highlights: [
        { type: "unit", seat: PLAYER, instanceId: L3_FRIEND_A },
        { type: "unit", seat: PLAYER, instanceId: L3_FRIEND_B }
      ]
    },
    {
      id: "l3_done",
      title: "完成第三關",
      body: "太棒了！你已經實際操作過沙包、光盾、觸發。點下一步完成第三關。",
      action: "next"
    }
  ]
};

// ─── Lesson 4: 進階關鍵字 (激怒 / 遺志 / 持續效果 / 回手牌) ────────────────────

const L4_ENRAGE = "l4-enrage";
const L4_ENEMY = "l4-enrage-enemy";
const L4_DEATH = "l4-death";
const L4_DEATH_HAND = "l4-death-hand";
const L4_KILLER = "l4-killer";
const L4_AURA = "l4-aura";
const L4_AURA_L = "l4-aura-left";
const L4_AURA_R = "l4-aura-right";
const L4_AURA_HAND = "l4-aura-hand";
const L4_BOUNCE = "l4-bounce";
const L4_BOUNCE_HAND = "l4-bounce-hand";

const ADVANCED_KEYWORDS_SCRIPT: TrainingScript = {
  level: ADVANCED_KEYWORDS_TRAINING,
  setup: () => ({
    players: {
      player1: makePlayer(PLAYER, "玩家", 10, [makeMinion(L4_ENRAGE, "TW009", PLAYER, 1, 4)], 0),
      player2: makePlayer(OPPONENT, "訓練教官", 0, [makeMinion(L4_ENEMY, "TW045", OPPONENT, 2, 4)], 0)
    },
    hand: []
  }),
  steps: [
    {
      id: "l4_intro",
      title: "第四關：進階關鍵字",
      body: "這一關介紹激怒、遺志、持續效果、回手牌，這次每一個都換你親自操作。場上敵方有個 2/4 隨從；先看我方『台積電工程師』(1/4) 的【激怒】，它現在只有 1 攻擊。",
      action: "next",
      highlights: [
        { type: "unit", seat: PLAYER, instanceId: L4_ENRAGE },
        { type: "minionStat", instanceId: L4_ENRAGE, stat: "attack" },
        { type: "unit", seat: OPPONENT, instanceId: L4_ENEMY }
      ]
    },
    {
      id: "l4_enrage_explain",
      title: "激怒",
      body: "【激怒】：當隨從受傷（生命未滿）時獲得加成。台積電工程師激怒：+3 攻擊。按下一步，讓它受到 1 點傷害觸發激怒。",
      action: "next",
      highlights: [{ type: "minionStat", instanceId: L4_ENRAGE, stat: "attack" }],
      apply: (session) => {
        setPlayerBoard(session, PLAYER, session.players[PLAYER].board.map((m) =>
          m.instanceId === L4_ENRAGE ? { ...m, currentHealth: m.currentHealth - 1, attack: m.attack + 3, isEnraged: true, canAttack: true } : m));
        return [
          ev(session, "DAMAGE", PLAYER, { target: L4_ENRAGE, amount: 1 }),
          ev(session, "BUFF", PLAYER, { target: L4_ENRAGE, stat: "ATTACK", value: 3 })
        ];
      }
    },
    {
      id: "l4_enrage_do",
      title: "換你操作：用怒氣反擊",
      body: "激怒觸發了！攻擊力從 1 暴增到 4。換你操作：用發亮的台積電工程師攻擊敵方的 2/4 隨從，一擊把威脅解決掉。",
      action: "script_attack",
      selectAttackerId: L4_ENRAGE,
      highlights: [
        { type: "unit", seat: PLAYER, instanceId: L4_ENRAGE },
        { type: "minionStat", instanceId: L4_ENRAGE, stat: "attack" },
        { type: "unit", seat: OPPONENT, instanceId: L4_ENEMY }
      ],
      match: (command) => isAttack(command, L4_ENRAGE, { type: "MINION", side: OPPONENT, instanceId: L4_ENEMY }),
      resolve: (session) => {
        const attacker = findMinion(session, PLAYER, L4_ENRAGE)!;
        const enemy = findMinion(session, OPPONENT, L4_ENEMY)!;
        setPlayerBoard(session, PLAYER, session.players[PLAYER].board.map((m) =>
          m.instanceId === L4_ENRAGE ? { ...m, currentHealth: m.currentHealth - enemy.attack, canAttack: false } : m));
        setPlayerBoard(session, OPPONENT, session.players[OPPONENT].board.filter((m) => m.instanceId !== L4_ENEMY));
        session.players[OPPONENT] = {
          ...session.players[OPPONENT],
          graveyardCount: session.players[OPPONENT].graveyardCount + 1
        };
        return [
          ev(session, "ATTACK", PLAYER, { attackerInstanceId: L4_ENRAGE, target: { type: "MINION", side: OPPONENT, instanceId: L4_ENEMY } }),
          ev(session, "DAMAGE", OPPONENT, { target: L4_ENEMY, amount: attacker.attack }),
          ev(session, "DAMAGE", PLAYER, { target: L4_ENRAGE, amount: enemy.attack }),
          ev(session, "DESTROY", OPPONENT, { target: L4_ENEMY, cardId: "TW045" })
        ];
      }
    },
    {
      id: "l4_enrage_result",
      title: "激怒的力量",
      body: "看到了嗎？平常只有 1 攻擊的它，受傷後用綠色的 4 攻擊一擊解決了威脅，自己還活著。激怒是『條件型持續效果』——只要它還在受傷狀態，就一直 +3 攻擊。按下一步，我們幫它補滿血，看看會發生什麼事。",
      action: "next",
      highlights: [
        { type: "unit", seat: PLAYER, instanceId: L4_ENRAGE },
        { type: "minionStat", instanceId: L4_ENRAGE, stat: "attack" }
      ],
      apply: (session) => {
        // Heal it back to full: the enrage condition (wounded) no longer holds, so
        // attack reverts from the green 4 to its original baseAttack of 1.
        setPlayerBoard(session, PLAYER, session.players[PLAYER].board.map((m) =>
          m.instanceId === L4_ENRAGE ? { ...m, currentHealth: m.health, attack: m.baseAttack, isEnraged: false } : m));
        return [ev(session, "HEAL", PLAYER, { target: L4_ENRAGE, amount: 3 })];
      }
    },
    {
      id: "l4_enrage_calmed",
      title: "激怒解除",
      body: "補滿血後，受傷的條件不再成立，激怒立刻解除——攻擊力從綠色的 4 變回原本的 1，血量也回滿了。這就是『持續效果』：條件消失，加成跟著消失，和打出時一次性的觸發完全不同。按下一步，認識下一個關鍵字。",
      action: "next",
      highlights: [
        { type: "unit", seat: PLAYER, instanceId: L4_ENRAGE },
        { type: "minionStat", instanceId: L4_ENRAGE, stat: "attack" }
      ],
      apply: (session) => {
        const events = setBoard(session, PLAYER, [makeMinion(L4_DEATH, "TW036", PLAYER, 2, 2, { canAttack: true })]);
        events.push(...setBoard(session, OPPONENT, [makeMinion(L4_KILLER, "TW045", OPPONENT, 3, 2)]));
        return events;
      }
    },
    {
      id: "l4_death_explain",
      title: "遺志",
      body: "【遺志】：隨從『死亡時』觸發的效果。我方『連勝文』(2/2) 遺志：死亡後回到手牌。敵方是 3/2，用連勝文去換掉它——就算它陣亡，也會回到你的手牌，等於不虧。",
      action: "next",
      highlights: [{ type: "unit", seat: PLAYER, instanceId: L4_DEATH }, { type: "unit", seat: OPPONENT, instanceId: L4_KILLER }]
    },
    {
      id: "l4_death_do",
      title: "換你操作：用遺志換牌",
      body: "用發亮的連勝文攻擊敵方的 3/2 隨從。它雖然會在交換中陣亡，但遺志會把它送回你的手牌。",
      action: "script_attack",
      selectAttackerId: L4_DEATH,
      highlights: [
        { type: "unit", seat: PLAYER, instanceId: L4_DEATH },
        { type: "unit", seat: OPPONENT, instanceId: L4_KILLER }
      ],
      match: (command) => isAttack(command, L4_DEATH, { type: "MINION", side: OPPONENT, instanceId: L4_KILLER }),
      resolve: (session) => {
        const attacker = findMinion(session, PLAYER, L4_DEATH)!;
        const enemy = findMinion(session, OPPONENT, L4_KILLER)!;
        setPlayerBoard(session, PLAYER, session.players[PLAYER].board.filter((m) => m.instanceId !== L4_DEATH));
        setPlayerBoard(session, OPPONENT, session.players[OPPONENT].board.filter((m) => m.instanceId !== L4_KILLER));
        session.players[OPPONENT] = {
          ...session.players[OPPONENT],
          graveyardCount: session.players[OPPONENT].graveyardCount + 1
        };
        addHand(session, handCard(L4_DEATH_HAND, "TW036", 4, "MINION", 2, 2));
        return [
          ev(session, "ATTACK", PLAYER, { attackerInstanceId: L4_DEATH, target: { type: "MINION", side: OPPONENT, instanceId: L4_KILLER } }),
          ev(session, "DAMAGE", OPPONENT, { target: L4_KILLER, amount: attacker.attack }),
          ev(session, "DAMAGE", PLAYER, { target: L4_DEATH, amount: enemy.attack }),
          ev(session, "DESTROY", OPPONENT, { target: L4_KILLER, cardId: "TW045" }),
          ev(session, "DESTROY", PLAYER, { target: L4_DEATH, cardId: "TW036" }),
          ev(session, "DEATHRATTLE", PLAYER, { source: L4_DEATH, type: "BOUNCE_SELF" }),
          ev(session, "BOUNCE", PLAYER, { target: L4_DEATH, cardId: "TW036" })
        ];
      }
    },
    {
      id: "l4_death_result",
      title: "遺志觸發了",
      body: "連勝文陣亡了——但遺志觸發，它回到了你的手牌！你換掉了敵人，自己卻完好回來。遺志能在死亡時帶來各種效果（抽牌、召喚、回手等），是讓你不吃虧的關鍵。",
      action: "next",
      highlights: [{ type: "hand", instanceId: L4_DEATH_HAND }],
      apply: (session) => {
        removeHand(session, L4_DEATH_HAND);
        const events = setBoard(session, PLAYER, [
          makeMinion(L4_AURA_L, "TW058", PLAYER, 1, 1),
          makeMinion(L4_AURA_R, "TW058", PLAYER, 1, 1)
        ]);
        events.push(...setBoard(session, OPPONENT, []));
        addHand(session, handCard(L4_AURA_HAND, "TW028", 6, "MINION", 0, 6));
        events.push(ev(session, "CARD_DRAWN", PLAYER, { cardId: "TW028" }));
        return events;
      }
    },
    {
      id: "l4_aura_explain",
      title: "持續效果",
      body: "【持續效果】：只要隨從在場上就『持續』生效，不是一次性。你手上的『京華城』(0/6) 持續效果：賦予左右兩側的隨從 +1/+1。場上兩個蔡想想現在都是 1/1。",
      action: "next",
      highlights: [
        { type: "hand", instanceId: L4_AURA_HAND },
        { type: "cardCost", instanceId: L4_AURA_HAND },
        { type: "unit", seat: PLAYER, instanceId: L4_AURA_L },
        { type: "unit", seat: PLAYER, instanceId: L4_AURA_R }
      ]
    },
    {
      id: "l4_aura_do",
      title: "換你操作：打出持續效果",
      body: "把『京華城』打到場上，看它如何讓兩側的蔡想想立刻變強。",
      action: "script_play",
      selectHandId: L4_AURA_HAND,
      highlights: [{ type: "hand", instanceId: L4_AURA_HAND }],
      match: (command) => command.type === "playCard" && command.handInstanceId === L4_AURA_HAND,
      resolve: (session) => {
        removeHand(session, L4_AURA_HAND);
        // Raise attack/health only (leave baseAttack at the catalog base) so the
        // +1/+1 buff renders green (stat-higher), matching a real match.
        const buffed = session.players[PLAYER].board.map((m) =>
          (m.instanceId === L4_AURA_L || m.instanceId === L4_AURA_R)
            ? { ...m, attack: m.attack + 1, health: m.health + 1, currentHealth: m.currentHealth + 1 }
            : m);
        const aura = makeMinion(L4_AURA, "TW028", PLAYER, 0, 6, { sleeping: true });
        setPlayerBoard(session, PLAYER, [
          buffed.find((m) => m.instanceId === L4_AURA_L)!,
          aura,
          buffed.find((m) => m.instanceId === L4_AURA_R)!
        ]);
        return [
          ev(session, "CARD_PLAYED", PLAYER, { handInstanceId: L4_AURA_HAND, cardId: "TW028" }),
          ev(session, "MINION_SUMMONED", PLAYER, { target: L4_AURA, cardId: "TW028" }),
          ev(session, "AURA_UPDATED", PLAYER, { target: L4_AURA_L }),
          ev(session, "AURA_UPDATED", PLAYER, { target: L4_AURA_R }),
          ev(session, "BUFF", PLAYER, { target: L4_AURA_L, stat: "ATTACK", value: 1 }),
          ev(session, "BUFF", PLAYER, { target: L4_AURA_R, stat: "ATTACK", value: 1 })
        ];
      }
    },
    {
      id: "l4_aura_result",
      title: "持續 vs 一次性",
      body: "兩側的蔡想想都從 1/1 變成綠色的 2/2！這是『持續』效果——只要京華城在場就一直生效。但它有個弱點：只要京華城離場，加成就會立刻消失。按下一步，看教官用『政治清算』處決京華城。",
      action: "next",
      highlights: [
        { type: "unit", seat: PLAYER, instanceId: L4_AURA },
        { type: "unit", seat: PLAYER, instanceId: L4_AURA_L },
        { type: "unit", seat: PLAYER, instanceId: L4_AURA_R }
      ],
      apply: (session) => {
        // 政治清算 (S020) deals 7 to 京華城 → it dies, so its ongoing +1/+1 aura
        // vanishes and both 蔡想想 snap back from green 2/2 to plain 1/1.
        setPlayerBoard(session, PLAYER, session.players[PLAYER].board
          .filter((m) => m.instanceId !== L4_AURA)
          .map((m) => (m.instanceId === L4_AURA_L || m.instanceId === L4_AURA_R)
            ? { ...m, attack: m.baseAttack, health: m.health - 1, currentHealth: m.currentHealth - 1 }
            : m));
        return [
          ev(session, "CARD_PLAYED", OPPONENT, { cardId: "S020" }),
          ev(session, "DAMAGE", PLAYER, { target: L4_AURA, amount: 7 }),
          ev(session, "DESTROY", PLAYER, { target: L4_AURA, cardId: "TW028" }),
          ev(session, "AURA_UPDATED", PLAYER, { target: L4_AURA_L }),
          ev(session, "AURA_UPDATED", PLAYER, { target: L4_AURA_R })
        ];
      }
    },
    {
      id: "l4_aura_gone",
      title: "加成消失了",
      body: "京華城被『政治清算』殺死，兩側的蔡想想立刻從綠色的 2/2 變回 1/1——持續效果隨來源一起消失。持續效果很強，但對手能靠移除來源一次拆光，這就是它與一次性觸發最大的差別。按下一步，認識最後一個關鍵字。",
      action: "next",
      highlights: [
        { type: "unit", seat: PLAYER, instanceId: L4_AURA_L },
        { type: "unit", seat: PLAYER, instanceId: L4_AURA_R }
      ],
      apply: (session) => {
        return setBoard(session, PLAYER, [makeMinion(L4_BOUNCE, "TW032", PLAYER, 2, 2)]);
      }
    },
    {
      id: "l4_bounce_explain",
      title: "回手牌",
      body: "【回手牌】：把場上的隨從收回手牌。有些卡回到手牌會變強——傳說卡『韓國瑜』(2/2) 回到手牌會永久 +2/+2。按下一步，先看它被收回手牌。",
      action: "next",
      highlights: [{ type: "unit", seat: PLAYER, instanceId: L4_BOUNCE }],
      apply: (session) => {
        setPlayerBoard(session, PLAYER, session.players[PLAYER].board.filter((m) => m.instanceId !== L4_BOUNCE));
        addHand(session, handCard(L4_BOUNCE_HAND, "TW032", 3, "MINION", 4, 4));
        return [ev(session, "BOUNCE", PLAYER, { target: L4_BOUNCE, cardId: "TW032" })];
      }
    },
    {
      id: "l4_bounce_replay",
      title: "換你操作：把成長的隨從打回去",
      body: "韓國瑜回到手牌後永久變成了 4/4！換你操作：把更強的它重新打回戰場上。",
      action: "script_play",
      selectHandId: L4_BOUNCE_HAND,
      highlights: [{ type: "hand", instanceId: L4_BOUNCE_HAND }, { type: "cardCost", instanceId: L4_BOUNCE_HAND }],
      match: (command) => command.type === "playCard" && command.handInstanceId === L4_BOUNCE_HAND,
      resolve: (session) => {
        removeHand(session, L4_BOUNCE_HAND);
        // baseAttack stays at the catalog 2 so the buffed 4 attack renders green
        // (stat-higher); health 4 vs catalog 2 already shows green on the board.
        const newcomer = makeMinion(L4_BOUNCE, "TW032", PLAYER, 4, 4, { sleeping: true, baseAttack: 2 });
        setPlayerBoard(session, PLAYER, [...session.players[PLAYER].board, newcomer]);
        return [
          // attack/health on the play cue make the focus-zoom card show a green 4/4,
          // matching the buffed hand card and the board (same as a formal match).
          ev(session, "CARD_PLAYED", PLAYER, { handInstanceId: L4_BOUNCE_HAND, cardId: "TW032", attack: 4, health: 4 }),
          ev(session, "MINION_SUMMONED", PLAYER, { target: L4_BOUNCE, cardId: "TW032" })
        ];
      }
    },
    {
      id: "l4_bounce_result",
      title: "回手並成長",
      body: "韓國瑜重新上場，從 2/2 長成了 4/4！回手牌可以救援快死的隨從、重複利用觸發，或像這樣讓隨從越打越強——是高手翻盤的常用手段。",
      action: "next",
      highlights: [{ type: "unit", seat: PLAYER, instanceId: L4_BOUNCE }]
    },
    {
      id: "l4_done",
      title: "完成第四關",
      body: "完成！你已經親手操作過激怒、遺志、持續效果、回手牌。點下一步完成第四關。",
      action: "next"
    }
  ]
};

// ─── Lesson 5: 增幅與場地 (增幅 / 場地效果) ───────────────────────────────────

const L5_MINION_A = "l5-minion-a";
const L5_MINION_B = "l5-minion-b";

function lessonAmpOptions(): AmplificationOption[] {
  // Real ids / names / tiers from the live amplification DB, with tutorial-clear
  // descriptions of what this lesson will demonstrate for each tier.
  const desc: Record<string, string> = {
    加減賺: "（示範）我方全體隨從 +1/+1。",
    穩穩仔賺: "（示範）我方全體隨從 +2/+2。",
    卯死: "（示範）我方全體隨從 +3/+3。"
  };
  return AMPLIFICATION_DB.map((entry) => ({
    id: entry.id,
    tier: entry.tier,
    name: entry.name,
    description: desc[entry.tier] ?? entry.description
  }));
}

function lessonFieldEvents(): NonNullable<TrainingSpecialPhase["voteEvents"]> {
  return ["VE_BLACKOUT", "VE_UTILITY_HIKE", "VE_MORAKOT"].map((id) => {
    const e = VOTE_EVENT_DB.find((entry) => entry.id === id)!;
    return { id: e.id, name: e.name, option0: e.options[0], option1: e.options[1], option2: e.options[2] };
  });
}

const AMP_FIELD_SCRIPT: TrainingScript = {
  level: AMP_FIELD_TRAINING,
  setup: () => ({
    players: {
      player1: makePlayer(PLAYER, "玩家", 10, [
        makeMinion(L5_MINION_A, "TW045", PLAYER, 4, 5),
        makeMinion(L5_MINION_B, "TW058", PLAYER, 1, 1)
      ], 0),
      player2: makePlayer(OPPONENT, "訓練教官", 0, [], 0)
    },
    hand: []
  }),
  steps: [
    {
      id: "l5_intro",
      title: "第五關：增幅與場地",
      body: "這一關介紹兩個影響整場的特殊機制：增幅與場地效果。先介紹【增幅】。",
      action: "next",
      highlights: [{ type: "hero", seat: PLAYER }]
    },
    {
      id: "l5_amp_explain",
      title: "增幅",
      body: "【增幅】：在第 7 與第 14 回合，你會依牌組陣營獲得三選一強化，分為三個等級——加減賺、穩穩仔賺、卯死，越高越強。按下一步，馬上跳出增幅選擇。",
      action: "next",
      apply: (session) => {
        session.phase = "AMPLIFICATION_PHASE";
        session.amplificationOptions = lessonAmpOptions();
        session.specialPhase = { ampSelectedP1: false, ampSelectedP2: false };
        return [ev(session, "PHASE_STARTED", PLAYER, { phase: "AMPLIFICATION_PHASE" })];
      }
    },
    {
      id: "l5_amp_pick",
      title: "選擇增幅",
      body: "從畫面上的三個增幅中挑一個。",
      action: "script_amp",
      match: (command) => command.type === "selectAmplification",
      resolve: (session, command) => {
        const optionId = command.type === "selectAmplification" ? command.optionId : undefined;
        const option = (session.amplificationOptions ?? []).find((o) => o.id === optionId) ?? session.amplificationOptions?.[0];
        const amount = option?.tier === "卯死" ? 3 : option?.tier === "穩穩仔賺" ? 2 : 1;
        const board = session.players[PLAYER].board.map((m) => ({
          ...m,
          attack: m.attack + amount,
          baseAttack: m.baseAttack + amount,
          health: m.health + amount,
          currentHealth: m.currentHealth + amount
        }));
        session.players[PLAYER] = {
          ...session.players[PLAYER],
          board,
          amplification: option ? { id: option.id, tier: option.tier, name: option.name } : undefined
        };
        session.phase = "NORMAL_PLAY";
        session.amplificationOptions = undefined;
        session.specialPhase = { ...session.specialPhase, ampSelectedP1: true };
        const events = [ev(session, "AMPLIFICATION_SELECTED", PLAYER, { optionId: option?.id, tier: option?.tier })];
        for (const m of board) events.push(ev(session, "BUFF", PLAYER, { target: m.instanceId, stat: "ATTACK", value: amount }));
        events.push(ev(session, "PHASE_ENDED", PLAYER, { phase: "AMPLIFICATION_PHASE" }));
        return events;
      }
    },
    {
      id: "l5_amp_result",
      title: "增幅生效",
      body: "你選的增幅生效了！我方隨從獲得了強化（看攻擊與生命的變化）。增幅是逆轉戰局的關鍵，記得依等級挑最適合的。",
      action: "next",
      highlights: [{ type: "unit", seat: PLAYER }]
    },
    {
      id: "l5_field_explain",
      title: "場地效果",
      body: "【場地效果】：在第 20 回合會舉行『公投』。三個公投案的中選率由弱勢方（血量較低）較高決定，中選的公投案會變成影響全場的場地效果。按下一步開始投票。",
      action: "next",
      apply: (session) => {
        session.phase = "VOTING_PHASE";
        session.specialPhase = {
          voteEvents: lessonFieldEvents(),
          voteWeightP1: 60,
          voteWeightP2: 40,
          voteSubmittedP1: false,
          voteSubmittedP2: false
        };
        return [ev(session, "PHASE_STARTED", PLAYER, { phase: "VOTING_PHASE" })];
      }
    },
    {
      id: "l5_field_vote",
      title: "投票",
      body: "從畫面上的三個公投案選一個投票。",
      action: "script_vote",
      match: (command) => command.type === "submitVote",
      resolve: (session, command) => {
        const events = lessonFieldEvents();
        const index = command.type === "submitVote" ? command.optionIndex : 0;
        const chosen = events[index] ?? events[0];
        const other = events[(index + 1) % events.length] ?? events[0];
        const result: GameEvent[] = [
          ev(session, "VOTE_RESOLVED", PLAYER, {
            choices: {
              player1: { seat: PLAYER, eventId: chosen.id, eventName: chosen.name },
              player2: { seat: OPPONENT, eventId: other.id, eventName: other.name }
            },
            winningSeat: PLAYER,
            eventId: chosen.id,
            eventName: chosen.name,
            weights: { player1: 50, player2: 50 },
            weightsInt: { player1: 1, player2: 1 },
            rollMillionths: 250000,
            processText: `公投開票：${chosen.name} 中選`
          })
        ];
        // Apply a representative environment effect to the board.
        if (chosen.id === "VE_MORAKOT") {
          for (const m of session.players[PLAYER].board) {
            result.push(ev(session, "DESTROY", PLAYER, { target: m.instanceId, cardId: m.cardId }));
          }
          session.players[PLAYER] = {
            ...session.players[PLAYER],
            board: [],
            graveyardCount: session.players[PLAYER].graveyardCount + session.players[PLAYER].board.length
          };
        } else if (chosen.id === "VE_BLACKOUT") {
          const board = session.players[PLAYER].board.map((m) => ({ ...m, lockedTurns: 4 }));
          setPlayerBoard(session, PLAYER, board);
          for (const m of board) result.push(ev(session, "BUFF", PLAYER, { target: m.instanceId, lockedTurns: 4 }));
        }
        session.phase = "NORMAL_PLAY";
        session.specialPhase = { ...session.specialPhase, voteSubmittedP1: true, voteSubmittedP2: true };
        result.push(ev(session, "PHASE_ENDED", PLAYER, { phase: "VOTING_PHASE" }));
        return result;
      }
    },
    {
      id: "l5_field_result",
      title: "場地效果套用",
      body: "公投開票完成，中選的公投案成為場地效果並套用到全場！場地效果（例如大停電讓全場沉默、莫拉克讓全場隨從死亡）會大幅改變戰局，是翻盤的大事件。",
      action: "next"
    },
    {
      id: "l5_done",
      title: "完成所有訓練",
      body: "恭喜！你已經了解增幅與場地效果，完成了全部訓練關卡。點下一步完成第五關。",
      action: "next"
    }
  ]
};

// ─── Registry ────────────────────────────────────────────────────────────────

export const LESSON_LEVELS: readonly TrainingLevelInfo[] = [
  CARD_TYPES_TRAINING,
  ADVANCED_KEYWORDS_TRAINING,
  AMP_FIELD_TRAINING
];

const SCRIPTS: Record<string, TrainingScript> = {
  [CARD_TYPES_TRAINING.id]: CARD_TYPES_SCRIPT,
  [ADVANCED_KEYWORDS_TRAINING.id]: ADVANCED_KEYWORDS_SCRIPT,
  [AMP_FIELD_TRAINING.id]: AMP_FIELD_SCRIPT
};

export function lessonScriptFor(levelId: string): TrainingScript | undefined {
  return SCRIPTS[levelId];
}
