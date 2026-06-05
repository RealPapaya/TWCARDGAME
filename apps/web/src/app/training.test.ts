import { describe, expect, it } from "vitest";
import type { GameCommand } from "@twcardgame/shared";
import {
  COLLISION_NEWS_TRAINING,
  SOCIAL_ROOKIE_TRAINING,
  advanceTraining,
  createCollisionNewsTraining,
  createSocialRookieTraining,
  createTrainingSession,
  handleTrainingCommand,
  trainingPrompt,
  type TrainingSession
} from "./training.js";

describe("social rookie training", () => {
  it("starts without deck state or randomness", () => {
    const session = createSocialRookieTraining("Tester");

    expect(session.level).toBe(SOCIAL_ROOKIE_TRAINING);
    expect(session.players.player1.hero.hp).toBe(10);
    expect(session.players.player2.hero.hp).toBe(10);
    expect(session.players.player1.mana).toEqual({ current: 1, max: 1 });
    expect(session.hand).toEqual([]);
    expect(trainingPrompt(session)?.body).toContain("歡迎來到訓練場");
  });

  it("locks the player into the scripted win path", () => {
    const session = createSocialRookieTraining("Tester");

    advanceTraining(session);
    advanceTraining(session);
    expect(session.step).toBe("crystal_intro");
    expect(trainingPrompt(session)?.body).toContain("水晶");
    advanceTraining(session);
    expect(session.step).toBe("play_rookie_intro");
    expect(trainingPrompt(session)?.allowedAction).toBe("next");
    advanceTraining(session);
    expect(trainingPrompt(session)?.allowedAction).toBe("play_rookie");

    const invalid = handleTrainingCommand(session, { type: "endTurn" });
    expect(invalid.rejected).toBeTruthy();
    expect(session.step).toBe("play_rookie");

    handleTrainingCommand(session, { type: "playCard", handInstanceId: "training-hand-rookie" });
    expect(session.step).toBe("minion_intro");
    expect(trainingPrompt(session)?.title).toBe("這是隨從");
    advanceTraining(session);
    expect(session.step).toBe("hero_intro");
    expect(trainingPrompt(session)?.title).toBe("這是英雄");
    advanceTraining(session);
    advanceTraining(session);
    advanceTraining(session);
    expect(session.step).toBe("end_turn_intro");
    advanceTraining(session);
    expect(trainingPrompt(session)?.allowedAction).toBe("end_turn");

    handleTrainingCommand(session, { type: "endTurn" });
    expect(session.players.player1.mana).toEqual({ current: 2, max: 2 });
    advanceTraining(session);
    expect(session.step).toBe("attack_hero_intro");
    advanceTraining(session);
    expect(trainingPrompt(session)?.allowedAction).toBe("attack_hero");

    handleTrainingCommand(session, {
      type: "attack",
      attackerInstanceId: "training-minion-rookie",
      target: { type: "HERO", side: "player2" }
    });
    expect(session.players.player2.hero.hp).toBe(9);

    advanceTraining(session);
    expect(session.step).toBe("final_strike_intro");
    advanceTraining(session);
    const result = handleTrainingCommand(session, { type: "playCard", handInstanceId: "training-hand-final-damage" });
    expect(result.completed).toBe(true);
    expect(session.status).toBe("finished");
    expect(session.players.player2.hero.hp).toBe(0);
  });
});

describe("collision and news training", () => {
  it("starts with a lethal enemy threat and scripted news cards", () => {
    const session = createCollisionNewsTraining("Tester");

    expect(session.level).toBe(COLLISION_NEWS_TRAINING);
    expect(session.players.player1.hero.hp).toBe(3);
    expect(session.players.player2.board[0]?.attack).toBe(3);
    expect(session.players.player1.board[0]?.currentHealth).toBe(5);
    expect(session.hand.map((card) => card.cardId)).toEqual(["S011", "S011", "S006"]);
    expect(trainingPrompt(session)?.body).toContain("下回合英雄就會被擊倒");
  });

  it("forces collision before teaching healing cap and egg damage", () => {
    const session = createCollisionNewsTraining("Tester");

    advanceTraining(session);
    expect(session.step).toBe("collision_attack");
    expect(trainingPrompt(session)?.allowedAction).toBe("attack_threat");

    const invalid = handleTrainingCommand(session, {
      type: "playCard",
      handInstanceId: "training-hand-egg",
      target: { type: "HERO", side: "player2" }
    });
    expect(invalid.rejected).toBeTruthy();
    expect(session.step).toBe("collision_attack");

    handleTrainingCommand(session, {
      type: "attack",
      attackerInstanceId: "training-minion-collision-friendly",
      target: { type: "MINION", side: "player2", instanceId: "training-minion-collision-threat" }
    });
    expect(session.step).toBe("collision_result");
    expect(session.players.player2.board).toHaveLength(0);
    expect(session.players.player1.board[0]?.currentHealth).toBe(2);

    advanceTraining(session);
    advanceTraining(session);
    expect(trainingPrompt(session)?.allowedAction).toBe("vaccine_one");
    handleTrainingCommand(session, {
      type: "playCard",
      handInstanceId: "training-hand-vaccine-1",
      target: { type: "MINION", side: "player1", instanceId: "training-minion-collision-friendly" }
    });
    expect(session.players.player1.board[0]?.currentHealth).toBe(4);

    expect(trainingPrompt(session)?.body).toContain("不會變成 6");
    advanceTraining(session);
    handleTrainingCommand(session, {
      type: "playCard",
      handInstanceId: "training-hand-vaccine-2",
      target: { type: "MINION", side: "player1", instanceId: "training-minion-collision-friendly" }
    });
    expect(session.players.player1.board[0]?.currentHealth).toBe(5);

    advanceTraining(session);
    const result = handleTrainingCommand(session, {
      type: "playCard",
      handInstanceId: "training-hand-egg",
      target: { type: "HERO", side: "player2" }
    });
    expect(result.completed).toBe(true);
    expect(session.status).toBe("finished");
    expect(session.players.player2.hero.hp).toBe(0);
  });
});

/**
 * Drives a scripted lesson to completion: auto-advances every INFO ("next")
 * step and, whenever a gated step appears, applies the next queued command.
 * Throws if a queued command is rejected or the queue runs dry mid-lesson.
 */
function driveLesson(session: TrainingSession, gatedCommands: GameCommand[]): void {
  const queue = [...gatedCommands];
  for (let guard = 0; guard < 200; guard++) {
    const prompt = trainingPrompt(session);
    if (!prompt) return;
    if (prompt.allowedAction === "next") {
      const result = advanceTraining(session);
      if (result.completed) return;
      continue;
    }
    const command = queue.shift();
    if (!command) throw new Error(`no queued command for gated step "${prompt.allowedAction}"`);
    const result = handleTrainingCommand(session, command);
    if (result.rejected) throw new Error(`unexpected rejection: ${result.rejected}`);
    if (result.completed) return;
  }
  throw new Error("lesson did not complete within guard limit");
}

const strayAttack = (instanceId: string): GameCommand =>
  ({ type: "attack", attackerInstanceId: "wrong", target: { type: "MINION", side: "player2", instanceId } }) as GameCommand;

describe("card types lesson (第三關)", () => {
  it("lets the player play a taunt, pop a shield, and trade with a battlecry buff", () => {
    const session = createTrainingSession("card_types");
    expect(session.level.id).toBe("card_types");

    // The very first gated step is playing the taunt; a stray command is rejected.
    while (trainingPrompt(session)?.allowedAction === "next") advanceTraining(session);
    const stray = handleTrainingCommand(session, { type: "endTurn" });
    expect(stray.rejected).toBeTruthy();

    driveLesson(session, [
      { type: "playCard", handInstanceId: "l3-taunt-hand" },
      { type: "attack", attackerInstanceId: "l3-attacker", target: { type: "MINION", side: "player2", instanceId: "l3-shield" } },
      { type: "playCard", handInstanceId: "l3-battlecry-hand" },
      { type: "attack", attackerInstanceId: "l3-friend-a", target: { type: "MINION", side: "player2", instanceId: "l3-bc-enemy" } }
    ]);

    expect(session.status).toBe("finished");
    expect(session.result?.winnerSeat).toBe("player1");
    // The buffed attacker (蘇巧慧, 5 attack) killed the 2/5 enemy and survived.
    expect(session.players.player2.board).toHaveLength(0);
    expect(session.players.player1.board.find((m) => m.instanceId === "l3-friend-a")?.currentHealth).toBe(3);
  });
});

describe("advanced keywords lesson (第四關)", () => {
  it("makes every keyword hands-on and reaches the win state", () => {
    const session = createTrainingSession("advanced_keywords");

    // Enrage segment: advance to the gated attack, then verify the wounded
    // minion now hits for 4 and clears the threat while surviving.
    while (trainingPrompt(session)?.allowedAction === "next") advanceTraining(session);
    expect(trainingPrompt(session)?.allowedAction).toBe("script_attack");
    const enrage = session.players.player1.board.find((m) => m.instanceId === "l4-enrage");
    expect(enrage?.attack).toBe(4);
    expect(enrage?.isEnraged).toBe(true);

    driveLesson(session, [
      { type: "attack", attackerInstanceId: "l4-enrage", target: { type: "MINION", side: "player2", instanceId: "l4-enrage-enemy" } },
      { type: "attack", attackerInstanceId: "l4-death", target: { type: "MINION", side: "player2", instanceId: "l4-killer" } },
      { type: "playCard", handInstanceId: "l4-aura-hand" },
      { type: "playCard", handInstanceId: "l4-bounce-hand" }
    ]);

    expect(session.status).toBe("finished");
    expect(session.result?.winnerSeat).toBe("player1");
    // 韓國瑜 returned to hand as a 4/4 and was replayed onto the board.
    const hanguoyu = session.players.player1.board.find((m) => m.instanceId === "l4-bounce");
    expect(hanguoyu?.attack).toBe(4);
    expect(hanguoyu?.health).toBe(4);
  });

  it("rejects commands that stray from the scripted attack", () => {
    const session = createTrainingSession("advanced_keywords");
    while (trainingPrompt(session)?.allowedAction === "next") advanceTraining(session);

    // Wrong attacker / wrong target are both refused.
    expect(handleTrainingCommand(session, strayAttack("l4-enrage-enemy")).rejected).toBeTruthy();
    expect(
      handleTrainingCommand(session, {
        type: "attack",
        attackerInstanceId: "l4-enrage",
        target: { type: "HERO", side: "player2" }
      }).rejected
    ).toBeTruthy();
  });
});
