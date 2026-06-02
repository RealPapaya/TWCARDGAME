import type {
  GameCommand,
  GameEvent,
  GameStatus,
  HandCardView,
  PublicGameState,
  PublicMinion,
  PublicPlayer,
  RewardSummary,
  Seat,
  TargetRef
} from "@twcardgame/shared";

export const SOCIAL_ROOKIE_TRAINING = {
  id: "social_rookie",
  name: "社會新鮮人",
  rewardGold: 100,
  heroHealth: 10
} as const;

export const COLLISION_NEWS_TRAINING = {
  id: "collision_news",
  name: "拜碼頭",
  rewardGold: 100,
  heroHealth: 10
} as const;

export const TRAINING_LEVELS = [SOCIAL_ROOKIE_TRAINING, COLLISION_NEWS_TRAINING] as const;

export type TrainingLevel = (typeof TRAINING_LEVELS)[number];
export type TrainingLevelId = TrainingLevel["id"];

const PLAYER: Seat = "player1";
const OPPONENT: Seat = "player2";
const ROOKIE_CARD_ID = "TW001";
const ROOKIE_HAND_ID = "training-hand-rookie";
const ROOKIE_MINION_ID = "training-minion-rookie";
const FINAL_CARD_ID = "S002";
const FINAL_HAND_ID = "training-hand-final-damage";
const COLLISION_FRIENDLY_CARD_ID = "TW045";
const COLLISION_ENEMY_CARD_ID = "TW076";
const COLLISION_FRIENDLY_MINION_ID = "training-minion-collision-friendly";
const COLLISION_ENEMY_MINION_ID = "training-minion-collision-threat";
const VACCINE_CARD_ID = "S011";
const VACCINE_HAND_ID_1 = "training-hand-vaccine-1";
const VACCINE_HAND_ID_2 = "training-hand-vaccine-2";
const EGG_CARD_ID = "S006";
const EGG_HAND_ID = "training-hand-egg";

export type TrainingStepId =
  | "welcome"
  | "draw_first"
  | "crystal_intro"
  | "play_rookie_intro"
  | "play_rookie"
  | "minion_intro"
  | "hero_intro"
  | "unit_intro"
  | "stats_intro"
  | "end_turn_intro"
  | "end_turn"
  | "enemy_done"
  | "attack_hero_intro"
  | "attack_hero"
  | "victory_condition"
  | "final_strike_intro"
  | "final_strike"
  | "collision_intro"
  | "collision_attack"
  | "collision_result"
  | "vaccine_intro"
  | "vaccine_one"
  | "vaccine_cap_intro"
  | "vaccine_two"
  | "egg_intro"
  | "egg_finish"
  | "completed";

export type TrainingAllowedAction =
  | "next"
  | "play_rookie"
  | "end_turn"
  | "attack_hero"
  | "final_strike"
  | "attack_threat"
  | "vaccine_one"
  | "vaccine_two"
  | "egg_finish"
  | "none";

export type TrainingHighlight =
  | { type: "hand"; instanceId: string }
  | { type: "cardCost"; instanceId: string }
  | { type: "hero"; seat: Seat }
  | { type: "unit"; seat: Seat; instanceId?: string }
  | { type: "mana"; seat: Seat }
  | { type: "minionStat"; instanceId: string; stat: "attack" | "health" }
  | { type: "endTurn" };

export interface TrainingPrompt {
  title: string;
  body: string;
  allowedAction: TrainingAllowedAction;
  highlights: TrainingHighlight[];
}

export interface TrainingCommandResult {
  publicSync?: TrainingPublicSync;
  hand?: HandCardView[];
  events: GameEvent[];
  rejected?: string;
  completed?: boolean;
}

export type TrainingPublicSync = {
  status?: GameStatus;
  activeSeat?: Seat;
  turnNumber?: number;
  actionSeq?: number;
  result?: PublicGameState["result"];
  players?: PublicGameState["players"];
};

export interface TrainingSession {
  level: TrainingLevel;
  step: TrainingStepId;
  status: GameStatus;
  activeSeat: Seat;
  turnNumber: number;
  actionSeq: number;
  seq: number;
  players: PublicGameState["players"];
  hand: HandCardView[];
  result?: PublicGameState["result"];
}

export function createTrainingSession(levelId: TrainingLevelId, playerName = "玩家"): TrainingSession {
  if (levelId === COLLISION_NEWS_TRAINING.id) return createCollisionNewsTraining(playerName);
  return createSocialRookieTraining(playerName);
}

export function createSocialRookieTraining(playerName = "玩家"): TrainingSession {
  return {
    level: SOCIAL_ROOKIE_TRAINING,
    step: "welcome",
    status: "in_progress",
    activeSeat: PLAYER,
    turnNumber: 1,
    actionSeq: 0,
    seq: 1,
    players: {
      player1: createPlayer(PLAYER, playerName, 0, 1, 1),
      player2: createPlayer(OPPONENT, "訓練教官", 0, 0, 0)
    },
    hand: []
  };
}

export function createCollisionNewsTraining(playerName = "玩家"): TrainingSession {
  const player = createPlayer(PLAYER, playerName, 3, 4, 4, COLLISION_NEWS_TRAINING.heroHealth);
  const opponent = createPlayer(OPPONENT, "訓練教官", 0, 0, 0, COLLISION_NEWS_TRAINING.heroHealth);
  player.hero = { hp: 3, maxHp: COLLISION_NEWS_TRAINING.heroHealth };
  opponent.hero = { hp: 3, maxHp: COLLISION_NEWS_TRAINING.heroHealth };
  player.board = [minion(COLLISION_FRIENDLY_MINION_ID, COLLISION_FRIENDLY_CARD_ID, PLAYER, 4, 5, { canAttack: true })];
  opponent.board = [minion(COLLISION_ENEMY_MINION_ID, COLLISION_ENEMY_CARD_ID, OPPONENT, 3, 4, { canAttack: true })];
  return {
    level: COLLISION_NEWS_TRAINING,
    step: "collision_intro",
    status: "in_progress",
    activeSeat: PLAYER,
    turnNumber: 1,
    actionSeq: 0,
    seq: 1,
    players: { player1: player, player2: opponent },
    hand: [
      handCard(VACCINE_HAND_ID_1, VACCINE_CARD_ID, 0, "NEWS"),
      handCard(VACCINE_HAND_ID_2, VACCINE_CARD_ID, 0, "NEWS"),
      handCard(EGG_HAND_ID, EGG_CARD_ID, 2, "NEWS")
    ]
  };
}

export function trainingPrompt(session: TrainingSession): TrainingPrompt | undefined {
  switch (session.step) {
    case "welcome":
      return {
        title: session.level.name,
        body: "歡迎來到訓練場，這一關會教你最基本的戰鬥流程。",
        allowedAction: "next",
        highlights: [{ type: "hero", seat: PLAYER }, { type: "hero", seat: OPPONENT }]
      };
    case "draw_first":
      return {
        title: "抽牌",
        body: "每回合開始時，你會抽一張牌。抽到的牌會進入下方手牌。",
        allowedAction: "next",
        highlights: [{ type: "hand", instanceId: ROOKIE_HAND_ID }]
      };
    case "crystal_intro":
      return {
        title: "水晶與消耗",
        body: "每一回合會獲得一個新的水晶，並補滿本回合可用水晶。每張牌左上角的數字是消耗，打出牌會花費水晶。",
        allowedAction: "next",
        highlights: [{ type: "mana", seat: PLAYER }, { type: "cardCost", instanceId: ROOKIE_HAND_ID }]
      };
    case "play_rookie_intro":
      return {
        title: "隨從是什麼",
        body: "隨從是可以被召喚到戰場上的角色。把這張隨從打出去吧。",
        allowedAction: "next",
        highlights: [{ type: "hand", instanceId: ROOKIE_HAND_ID }]
      };
    case "play_rookie":
      return {
        title: "隨從是什麼",
        body: "把這張隨從打出去吧。",
        allowedAction: "play_rookie",
        highlights: [{ type: "hand", instanceId: ROOKIE_HAND_ID }]
      };
    case "minion_intro":
      return {
        title: "這是隨從",
        body: "剛剛打出的角色現在在戰場上。這種會站在場上、之後可以攻擊的角色就是隨從。",
        allowedAction: "next",
        highlights: [{ type: "unit", seat: PLAYER, instanceId: ROOKIE_MINION_ID }]
      };
    case "hero_intro":
      return {
        title: "這是英雄",
        body: "英雄代表玩家本身。你的英雄生命歸零就會輸，敵方英雄生命歸零就會贏。",
        allowedAction: "next",
        highlights: [{ type: "hero", seat: PLAYER }, { type: "hero", seat: OPPONENT }]
      };
    case "unit_intro":
      return {
        title: "單位是什麼",
        body: "英雄和隨從都叫做單位。很多效果會寫「一個單位」，代表可以選英雄或隨從。",
        allowedAction: "next",
        highlights: [
          { type: "unit", seat: PLAYER },
          { type: "unit", seat: OPPONENT },
          { type: "unit", seat: PLAYER, instanceId: ROOKIE_MINION_ID }
        ]
      };
    case "stats_intro":
      return {
        title: "攻擊與生命",
        body: "攻擊代表造成多少傷害，生命代表能承受多少傷害。生命變成 0 的隨從會離場。",
        allowedAction: "next",
        highlights: [
          { type: "minionStat", instanceId: ROOKIE_MINION_ID, stat: "attack" },
          { type: "minionStat", instanceId: ROOKIE_MINION_ID, stat: "health" }
        ]
      };
    case "end_turn_intro":
      return {
        title: "結束回合",
        body: "剛召喚的隨從通常不能立刻攻擊。按結束回合，讓它準備好。",
        allowedAction: "next",
        highlights: [{ type: "endTurn" }]
      };
    case "end_turn":
      return {
        title: "結束回合",
        body: "按結束回合，讓隨從準備好。",
        allowedAction: "end_turn",
        highlights: [{ type: "endTurn" }]
      };
    case "enemy_done":
      return {
        title: "敵方回合",
        body: "敵人行動結束，輪到你了。",
        allowedAction: "next",
        highlights: [{ type: "hero", seat: OPPONENT }]
      };
    case "attack_hero_intro":
      return {
        title: "攻擊敵方英雄",
        body: "發亮的隨從可以攻擊。選它，然後選敵方英雄。",
        allowedAction: "next",
        highlights: [{ type: "unit", seat: PLAYER, instanceId: ROOKIE_MINION_ID }, { type: "hero", seat: OPPONENT }]
      };
    case "attack_hero":
      return {
        title: "攻擊敵方英雄",
        body: "選發亮的隨從，然後選敵方英雄。",
        allowedAction: "attack_hero",
        highlights: [{ type: "unit", seat: PLAYER, instanceId: ROOKIE_MINION_ID }, { type: "hero", seat: OPPONENT }]
      };
    case "victory_condition":
      return {
        title: "勝利條件",
        body: "你的目標是把敵方英雄生命降到 0。接下來完成最後一擊。",
        allowedAction: "next",
        highlights: [{ type: "hero", seat: OPPONENT }]
      };
    case "final_strike_intro":
      return {
        title: "最後一擊",
        body: "你抽到一張足夠強的傷害牌。把它打出去，讓敵方英雄生命降到 0。",
        allowedAction: "next",
        highlights: [{ type: "hand", instanceId: FINAL_HAND_ID }, { type: "cardCost", instanceId: FINAL_HAND_ID }, { type: "hero", seat: OPPONENT }]
      };
    case "final_strike":
      return {
        title: "最後一擊",
        body: "把傷害牌打出去，讓敵方英雄生命降到 0。",
        allowedAction: "final_strike",
        highlights: [{ type: "hand", instanceId: FINAL_HAND_ID }, { type: "hero", seat: OPPONENT }]
      };
    case "collision_intro":
      return {
        title: session.level.name,
        body: "你的英雄只剩 3 點生命，敵方隨從有 3 點攻擊。若不先處理它，下回合英雄就會被擊倒。",
        allowedAction: "next",
        highlights: [{ type: "hero", seat: PLAYER }, { type: "unit", seat: OPPONENT, instanceId: COLLISION_ENEMY_MINION_ID }]
      };
    case "collision_attack":
      return {
        title: "先解除危機",
        body: "選我方發亮的隨從，攻擊敵方隨從。這一步不能打英雄，必須先移除會致命的威脅。",
        allowedAction: "attack_threat",
        highlights: [
          { type: "unit", seat: PLAYER, instanceId: COLLISION_FRIENDLY_MINION_ID },
          { type: "unit", seat: OPPONENT, instanceId: COLLISION_ENEMY_MINION_ID }
        ]
      };
    case "collision_result":
      return {
        title: "卡牌碰撞",
        body: "隨從互相攻擊時，雙方都會扣血：我方用 4 攻擊打敵方，敵方也用 3 攻擊反擊我方。敵方生命歸零離場，我方受傷留下來。",
        allowedAction: "next",
        highlights: [
          { type: "unit", seat: PLAYER, instanceId: COLLISION_FRIENDLY_MINION_ID },
          { type: "minionStat", instanceId: COLLISION_FRIENDLY_MINION_ID, stat: "health" }
        ]
      };
    case "vaccine_intro":
      return {
        title: "新聞牌：回復",
        body: "新聞牌會打出一次效果，不會像隨從一樣留在場上。高端疫苗可以回復隨從生命；這張目標是民進黨政治人物，所以會回復 2 點。",
        allowedAction: "next",
        highlights: [{ type: "hand", instanceId: VACCINE_HAND_ID_1 }, { type: "unit", seat: PLAYER, instanceId: COLLISION_FRIENDLY_MINION_ID }]
      };
    case "vaccine_one":
      return {
        title: "使用高端疫苗",
        body: "把第一張高端疫苗用在受傷的我方隨從上。",
        allowedAction: "vaccine_one",
        highlights: [{ type: "hand", instanceId: VACCINE_HAND_ID_1 }, { type: "unit", seat: PLAYER, instanceId: COLLISION_FRIENDLY_MINION_ID }]
      };
    case "vaccine_cap_intro":
      return {
        title: "生命上限",
        body: "回復生命不能超過生命上限。這名隨從最多是 5 點生命；再補 2 點也只會到 5，不會變成 6。",
        allowedAction: "next",
        highlights: [
          { type: "hand", instanceId: VACCINE_HAND_ID_2 },
          { type: "minionStat", instanceId: COLLISION_FRIENDLY_MINION_ID, stat: "health" }
        ]
      };
    case "vaccine_two":
      return {
        title: "再次回復",
        body: "再用第二張高端疫苗，觀察生命只會補到上限。",
        allowedAction: "vaccine_two",
        highlights: [{ type: "hand", instanceId: VACCINE_HAND_ID_2 }, { type: "unit", seat: PLAYER, instanceId: COLLISION_FRIENDLY_MINION_ID }]
      };
    case "egg_intro":
      return {
        title: "新聞牌：傷害",
        body: "砸雞蛋是傷害型新聞牌，可以對敵方單位造成 3 點傷害。敵方英雄剩 3 點生命，正好可以完成最後一擊。",
        allowedAction: "next",
        highlights: [{ type: "hand", instanceId: EGG_HAND_ID }, { type: "hero", seat: OPPONENT }]
      };
    case "egg_finish":
      return {
        title: "使用砸雞蛋",
        body: "把砸雞蛋打到敵方英雄，完成第二關。",
        allowedAction: "egg_finish",
        highlights: [{ type: "hand", instanceId: EGG_HAND_ID }, { type: "hero", seat: OPPONENT }]
      };
    case "completed":
      return undefined;
  }
}

export function trainingBlocksBattle(session: TrainingSession | undefined): boolean {
  const action = session ? trainingPrompt(session)?.allowedAction : undefined;
  return action === "next" || action === "none";
}

export function trainingHasHighlight(session: TrainingSession | undefined, highlight: TrainingHighlight): boolean {
  return Boolean(session && trainingPrompt(session)?.highlights.some((candidate) => sameHighlight(candidate, highlight)));
}

export function trainingCanSelectHand(session: TrainingSession | undefined, handInstanceId: string | undefined): boolean {
  if (!session || !handInstanceId) return true;
  const action = trainingPrompt(session)?.allowedAction;
  if (action === "play_rookie") return handInstanceId === ROOKIE_HAND_ID;
  if (action === "final_strike") return handInstanceId === FINAL_HAND_ID;
  if (action === "vaccine_one") return handInstanceId === VACCINE_HAND_ID_1;
  if (action === "vaccine_two") return handInstanceId === VACCINE_HAND_ID_2;
  if (action === "egg_finish") return handInstanceId === EGG_HAND_ID;
  return false;
}

export function trainingCanSelectAttacker(session: TrainingSession | undefined, attackerInstanceId: string | undefined): boolean {
  if (!session || !attackerInstanceId) return true;
  const action = trainingPrompt(session)?.allowedAction;
  if (action === "attack_hero") return attackerInstanceId === ROOKIE_MINION_ID;
  if (action === "attack_threat") return attackerInstanceId === COLLISION_FRIENDLY_MINION_ID;
  return false;
}

export function trainingCanEndTurn(session: TrainingSession | undefined): boolean {
  if (!session) return true;
  return trainingPrompt(session)?.allowedAction === "end_turn";
}

export function advanceTraining(session: TrainingSession): TrainingCommandResult {
  switch (session.step) {
    case "welcome":
      session.hand = [handCard(ROOKIE_HAND_ID, ROOKIE_CARD_ID, 1, "MINION", 1, 2)];
      session.players[PLAYER] = { ...session.players[PLAYER], handCount: session.hand.length };
      session.step = "draw_first";
      return update(session, [event(session, "CARD_DRAWN", PLAYER, { cardId: ROOKIE_CARD_ID })]);
    case "draw_first":
      session.step = "crystal_intro";
      return update(session);
    case "crystal_intro":
      session.step = "play_rookie_intro";
      return update(session);
    case "play_rookie_intro":
      session.step = "play_rookie";
      return update(session);
    case "minion_intro":
      session.step = "hero_intro";
      return update(session);
    case "hero_intro":
      session.step = "unit_intro";
      return update(session);
    case "unit_intro":
      session.step = "stats_intro";
      return update(session);
    case "stats_intro":
      session.step = "end_turn_intro";
      return update(session);
    case "end_turn_intro":
      session.step = "end_turn";
      return update(session);
    case "enemy_done":
      session.step = "attack_hero_intro";
      return update(session);
    case "attack_hero_intro":
      session.step = "attack_hero";
      return update(session);
    case "victory_condition":
      session.step = "final_strike_intro";
      return update(session);
    case "final_strike_intro":
      session.step = "final_strike";
      return update(session);
    case "collision_intro":
      session.step = "collision_attack";
      return update(session);
    case "collision_result":
      session.step = "vaccine_intro";
      return update(session);
    case "vaccine_intro":
      session.step = "vaccine_one";
      return update(session);
    case "vaccine_cap_intro":
      session.step = "vaccine_two";
      return update(session);
    case "egg_intro":
      session.step = "egg_finish";
      return update(session);
    default:
      return reject(session, "請照教學指示操作。");
  }
}

export function handleTrainingCommand(session: TrainingSession, command: GameCommand): TrainingCommandResult {
  const action = trainingPrompt(session)?.allowedAction;
  if (command.type === "playCard" && action === "play_rookie" && command.handInstanceId === ROOKIE_HAND_ID) {
    return playRookie(session);
  }
  if (command.type === "endTurn" && action === "end_turn") {
    return runEnemyTurn(session);
  }
  if (
    command.type === "attack" &&
    action === "attack_hero" &&
    command.attackerInstanceId === ROOKIE_MINION_ID &&
    isOpponentHero(command.target)
  ) {
    return attackOpponentHero(session);
  }
  if (command.type === "playCard" && action === "final_strike" && command.handInstanceId === FINAL_HAND_ID) {
    return finalStrike(session);
  }
  if (
    command.type === "attack" &&
    action === "attack_threat" &&
    command.attackerInstanceId === COLLISION_FRIENDLY_MINION_ID &&
    isCollisionThreat(command.target)
  ) {
    return attackCollisionThreat(session);
  }
  if (
    command.type === "playCard" &&
    action === "vaccine_one" &&
    command.handInstanceId === VACCINE_HAND_ID_1 &&
    isCollisionFriendly(command.target)
  ) {
    return playVaccine(session, VACCINE_HAND_ID_1, "vaccine_cap_intro");
  }
  if (
    command.type === "playCard" &&
    action === "vaccine_two" &&
    command.handInstanceId === VACCINE_HAND_ID_2 &&
    isCollisionFriendly(command.target)
  ) {
    return playVaccine(session, VACCINE_HAND_ID_2, "egg_intro");
  }
  if (
    command.type === "playCard" &&
    action === "egg_finish" &&
    command.handInstanceId === EGG_HAND_ID &&
    isOpponentHero(command.target)
  ) {
    return eggFinish(session);
  }
  return reject(session, "這一步只能照教學指定的操作進行。");
}

export function trainingPublicState(session: TrainingSession): PublicGameState {
  return {
    matchId: session.level.id,
    schemaVersion: 1,
    cardCatalogVersion: "training",
    status: session.status,
    phase: "NORMAL_PLAY",
    turn: {
      activeSeat: session.activeSeat,
      number: session.turnNumber,
      startedAtMs: 0,
      deadlineAtMs: 0,
      actionSeq: session.actionSeq
    },
    players: clonePlayers(session.players),
    result: session.result
  };
}

export function trainingPublicSync(session: TrainingSession): TrainingPublicSync {
  return {
    status: session.status,
    activeSeat: session.activeSeat,
    turnNumber: session.turnNumber,
    actionSeq: session.actionSeq,
    result: session.result,
    players: clonePlayers(session.players)
  };
}

export function createTrainingRewardSummary(input: {
  goldBefore: number;
  goldAfter: number;
  rewardGold: number;
}): RewardSummary {
  return {
    result: "win",
    mode: "pve",
    source: input.rewardGold > 0 ? "pve_first" : "pve_repeat",
    aiTheme: null,
    aiDifficulty: "easy",
    xp: { before: 0, after: 0, gained: 0 },
    level: { before: 1, after: 1 },
    levelUps: [],
    gold: {
      before: input.goldBefore,
      after: input.goldAfter,
      gained: input.rewardGold,
      breakdown: input.rewardGold > 0 ? { firstVictory: input.rewardGold } : {}
    }
  };
}

function playRookie(session: TrainingSession): TrainingCommandResult {
  const player = session.players[PLAYER];
  const rookie = minion(ROOKIE_MINION_ID, ROOKIE_CARD_ID, PLAYER, 1, 2, { sleeping: true, canAttack: false });
  session.hand = session.hand.filter((card) => card.instanceId !== ROOKIE_HAND_ID);
  session.players[PLAYER] = {
    ...player,
    mana: { ...player.mana, current: Math.max(0, player.mana.current - 1) },
    handCount: session.hand.length,
    board: [...player.board, rookie]
  };
  session.step = "minion_intro";
  session.actionSeq += 1;
  return update(session, [
    event(session, "CARD_PLAYED", PLAYER, { handInstanceId: ROOKIE_HAND_ID, cardId: ROOKIE_CARD_ID }),
    event(session, "MINION_SUMMONED", PLAYER, { target: ROOKIE_MINION_ID, cardId: ROOKIE_CARD_ID })
  ]);
}

function runEnemyTurn(session: TrainingSession): TrainingCommandResult {
  const player = session.players[PLAYER];
  session.activeSeat = PLAYER;
  session.turnNumber = 2;
  session.hand = [handCard(FINAL_HAND_ID, FINAL_CARD_ID, 2, "NEWS")];
  session.players[PLAYER] = {
    ...player,
    mana: { current: 2, max: 2 },
    handCount: session.hand.length,
    board: player.board.map((item) => item.instanceId === ROOKIE_MINION_ID ? { ...item, sleeping: false, canAttack: true } : item)
  };
  session.step = "enemy_done";
  session.actionSeq += 1;
  return update(session, [
    event(session, "TURN_ENDED", PLAYER, { activeSeat: PLAYER }),
    event(session, "TURN_STARTED", OPPONENT, { activeSeat: OPPONENT, turn: 1 }),
    event(session, "TURN_ENDED", OPPONENT, { activeSeat: OPPONENT }),
    event(session, "TURN_STARTED", PLAYER, { activeSeat: PLAYER, turn: 2 }),
    event(session, "CARD_DRAWN", PLAYER, { cardId: FINAL_CARD_ID })
  ]);
}

function attackOpponentHero(session: TrainingSession): TrainingCommandResult {
  const attacker = session.players[PLAYER].board.find((item) => item.instanceId === ROOKIE_MINION_ID);
  if (!attacker) return reject(session, "找不到教學指定的隨從。");
  const opponent = session.players[OPPONENT];
  const damage = attacker.attack;
  session.players[PLAYER] = {
    ...session.players[PLAYER],
    board: session.players[PLAYER].board.map((item) => item.instanceId === ROOKIE_MINION_ID ? { ...item, canAttack: false } : item)
  };
  session.players[OPPONENT] = {
    ...opponent,
    hero: { ...opponent.hero, hp: Math.max(0, opponent.hero.hp - damage) }
  };
  session.step = "victory_condition";
  session.actionSeq += 1;
  return update(session, [
    event(session, "ATTACK", PLAYER, { attackerInstanceId: ROOKIE_MINION_ID, target: { type: "HERO", side: OPPONENT } }),
    event(session, "DAMAGE", PLAYER, { target: `${OPPONENT}:hero`, amount: damage })
  ]);
}

function finalStrike(session: TrainingSession): TrainingCommandResult {
  const opponent = session.players[OPPONENT];
  const damage = opponent.hero.hp;
  session.hand = session.hand.filter((card) => card.instanceId !== FINAL_HAND_ID);
  session.players[PLAYER] = {
    ...session.players[PLAYER],
    handCount: session.hand.length,
    mana: { ...session.players[PLAYER].mana, current: 0 }
  };
  session.players[OPPONENT] = {
    ...opponent,
    hero: { ...opponent.hero, hp: 0 }
  };
  session.status = "finished";
  session.result = { winnerSeat: PLAYER, reason: "hero_destroyed" };
  session.step = "completed";
  session.actionSeq += 1;
  return {
    ...update(session, [
      event(session, "CARD_PLAYED", PLAYER, { handInstanceId: FINAL_HAND_ID, cardId: FINAL_CARD_ID }),
      event(session, "DAMAGE", PLAYER, { target: `${OPPONENT}:hero`, amount: damage }),
      event(session, "GAME_FINISHED", PLAYER, { winnerSeat: PLAYER, reason: "hero_destroyed" })
    ]),
    completed: true
  };
}

function attackCollisionThreat(session: TrainingSession): TrainingCommandResult {
  const player = session.players[PLAYER];
  const opponent = session.players[OPPONENT];
  const attacker = player.board.find((item) => item.instanceId === COLLISION_FRIENDLY_MINION_ID);
  const defender = opponent.board.find((item) => item.instanceId === COLLISION_ENEMY_MINION_ID);
  if (!attacker || !defender) return reject(session, "找不到教學指定的碰撞目標。");
  const attackerDamage = attacker.attack;
  const defenderDamage = defender.attack;
  const nextAttacker = { ...attacker, currentHealth: attacker.currentHealth - defenderDamage, canAttack: false };
  const nextDefender = { ...defender, currentHealth: defender.currentHealth - attackerDamage };
  session.players[PLAYER] = {
    ...player,
    board: player.board.map((item) => item.instanceId === COLLISION_FRIENDLY_MINION_ID ? nextAttacker : item)
  };
  session.players[OPPONENT] = {
    ...opponent,
    graveyardCount: opponent.graveyardCount + (nextDefender.currentHealth <= 0 ? 1 : 0),
    board: opponent.board
      .map((item) => item.instanceId === COLLISION_ENEMY_MINION_ID ? nextDefender : item)
      .filter((item) => item.currentHealth > 0)
  };
  session.step = "collision_result";
  session.actionSeq += 1;
  return update(session, [
    event(session, "ATTACK", PLAYER, { attackerInstanceId: COLLISION_FRIENDLY_MINION_ID, target: { type: "MINION", side: OPPONENT, instanceId: COLLISION_ENEMY_MINION_ID } }),
    event(session, "DAMAGE", OPPONENT, { target: COLLISION_ENEMY_MINION_ID, amount: attackerDamage }),
    event(session, "DAMAGE", PLAYER, { target: COLLISION_FRIENDLY_MINION_ID, amount: defenderDamage }),
    event(session, "DESTROY", OPPONENT, { target: COLLISION_ENEMY_MINION_ID, cardId: COLLISION_ENEMY_CARD_ID })
  ]);
}

function playVaccine(session: TrainingSession, handInstanceId: string, nextStep: TrainingStepId): TrainingCommandResult {
  const player = session.players[PLAYER];
  const healedBoard = player.board.map((item) => {
    if (item.instanceId !== COLLISION_FRIENDLY_MINION_ID) return item;
    return { ...item, currentHealth: Math.min(item.health, item.currentHealth + 2) };
  });
  const before = player.board.find((item) => item.instanceId === COLLISION_FRIENDLY_MINION_ID)?.currentHealth ?? 0;
  const after = healedBoard.find((item) => item.instanceId === COLLISION_FRIENDLY_MINION_ID)?.currentHealth ?? before;
  session.hand = session.hand.filter((card) => card.instanceId !== handInstanceId);
  session.players[PLAYER] = {
    ...player,
    board: healedBoard,
    handCount: session.hand.length
  };
  session.step = nextStep;
  session.actionSeq += 1;
  return update(session, [
    event(session, "CARD_PLAYED", PLAYER, { handInstanceId, cardId: VACCINE_CARD_ID }),
    event(session, "HEAL", PLAYER, { target: COLLISION_FRIENDLY_MINION_ID, amount: after - before })
  ]);
}

function eggFinish(session: TrainingSession): TrainingCommandResult {
  const opponent = session.players[OPPONENT];
  session.hand = session.hand.filter((card) => card.instanceId !== EGG_HAND_ID);
  session.players[PLAYER] = {
    ...session.players[PLAYER],
    handCount: session.hand.length,
    mana: { ...session.players[PLAYER].mana, current: Math.max(0, session.players[PLAYER].mana.current - 2) }
  };
  session.players[OPPONENT] = {
    ...opponent,
    hero: { ...opponent.hero, hp: 0 }
  };
  session.status = "finished";
  session.result = { winnerSeat: PLAYER, reason: "hero_destroyed" };
  session.step = "completed";
  session.actionSeq += 1;
  return {
    ...update(session, [
      event(session, "CARD_PLAYED", PLAYER, { handInstanceId: EGG_HAND_ID, cardId: EGG_CARD_ID }),
      event(session, "DAMAGE", PLAYER, { target: `${OPPONENT}:hero`, amount: 3 }),
      event(session, "GAME_FINISHED", PLAYER, { winnerSeat: PLAYER, reason: "hero_destroyed" })
    ]),
    completed: true
  };
}

function update(session: TrainingSession, events: GameEvent[] = []): TrainingCommandResult {
  return {
    publicSync: trainingPublicSync(session),
    hand: [...session.hand],
    events
  };
}

function reject(session: TrainingSession, reason: string): TrainingCommandResult {
  return {
    events: [event(session, "COMMAND_REJECTED", PLAYER, { reason })],
    rejected: reason
  };
}

function event(session: TrainingSession, type: GameEvent["type"], seat: Seat, payload: Record<string, unknown> = {}): GameEvent {
  return { seq: session.seq++, type, seat, payload };
}

function createPlayer(seat: Seat, displayName: string, handCount: number, manaCurrent: number, manaMax: number, heroHealth = SOCIAL_ROOKIE_TRAINING.heroHealth): PublicPlayer {
  return {
    userId: `training-${seat}`,
    displayName,
    connected: true,
    hero: { hp: heroHealth, maxHp: heroHealth },
    mana: { current: manaCurrent, max: manaMax },
    handCount,
    deckCount: 0,
    graveyardCount: 0,
    mulliganReady: true,
    board: []
  };
}

function handCard(
  instanceId: string,
  cardId: string,
  cost: number,
  type: HandCardView["type"],
  attack?: number,
  health?: number
): HandCardView {
  return { instanceId, cardId, cost, type, attack, health };
}

function minion(
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

function isOpponentHero(target: TargetRef | undefined): boolean {
  return target?.type === "HERO" && target.side === OPPONENT;
}

function isCollisionThreat(target: TargetRef): boolean {
  return target.type === "MINION" && target.side === OPPONENT && target.instanceId === COLLISION_ENEMY_MINION_ID;
}

function isCollisionFriendly(target: TargetRef | undefined): boolean {
  return target?.type === "MINION" && target.side === PLAYER && target.instanceId === COLLISION_FRIENDLY_MINION_ID;
}

function clonePlayers(players: PublicGameState["players"]): PublicGameState["players"] {
  return {
    player1: clonePlayer(players.player1),
    player2: clonePlayer(players.player2)
  };
}

function clonePlayer(player: PublicPlayer): PublicPlayer {
  return {
    ...player,
    hero: { ...player.hero },
    mana: { ...player.mana },
    board: player.board.map((item) => ({ ...item }))
  };
}

function sameHighlight(a: TrainingHighlight, b: TrainingHighlight): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "hand" && b.type === "hand") return a.instanceId === b.instanceId;
  if (a.type === "cardCost" && b.type === "cardCost") return a.instanceId === b.instanceId;
  if (a.type === "hero" && b.type === "hero") return a.seat === b.seat;
  if (a.type === "unit" && b.type === "unit") return a.seat === b.seat && a.instanceId === b.instanceId;
  if (a.type === "mana" && b.type === "mana") return a.seat === b.seat;
  if (a.type === "minionStat" && b.type === "minionStat") return a.instanceId === b.instanceId && a.stat === b.stat;
  return a.type === "endTurn" && b.type === "endTurn";
}
