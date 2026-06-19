import { describe, expect, it } from "vitest";
import type { GameCommand } from "@twcardgame/shared";
import {
  COLLISION_NEWS_TRAINING,
  SOCIAL_ROOKIE_TRAINING,
  advanceTraining,
  createCollisionNewsTraining,
  createSocialRookieTraining,
  createTrainingSession,
  TRAINING_LEVELS,
  handleTrainingCommand,
  trainingPrompt,
  type TrainingSession
} from "./training.js";

describe("training rewards", () => {
  it("lists first-clear gold by tutorial level", () => {
    expect(TRAINING_LEVELS.map((level) => [level.id, level.rewardGold])).toEqual([
      ["social_rookie", 100],
      ["collision_news", 150],
      ["card_types", 150],
      ["advanced_keywords", 200],
      ["amp_field", 200]
    ]);
  });
});

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
  it("starts with a lethal enemy threat and no scripted news cards yet", () => {
    const session = createCollisionNewsTraining("Tester");

    expect(session.level).toBe(COLLISION_NEWS_TRAINING);
    expect(session.players.player1.hero.hp).toBe(3);
    expect(session.players.player2.board[0]?.attack).toBe(3);
    expect(session.players.player1.board[0]?.currentHealth).toBe(5);
    expect(session.hand).toEqual([]);
    expect(session.players.player1.handCount).toBe(0);
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
    expect(session.hand.map((card) => card.cardId)).toEqual(["S011", "S011"]);
    expect(session.players.player1.handCount).toBe(2);

    advanceTraining(session);
    advanceTraining(session);
    expect(trainingPrompt(session)?.allowedAction).toBe("vaccine_one");
    handleTrainingCommand(session, {
      type: "playCard",
      handInstanceId: "training-hand-vaccine-1",
      target: { type: "MINION", side: "player1", instanceId: "training-minion-collision-friendly" }
    });
    expect(session.players.player1.board[0]?.currentHealth).toBe(4);
    expect(session.hand.map((card) => card.cardId)).toEqual(["S011"]);

    expect(trainingPrompt(session)?.body).toContain("不會變成 6");
    advanceTraining(session);
    handleTrainingCommand(session, {
      type: "playCard",
      handInstanceId: "training-hand-vaccine-2",
      target: { type: "MINION", side: "player1", instanceId: "training-minion-collision-friendly" }
    });
    expect(session.players.player1.board[0]?.currentHealth).toBe(5);
    expect(session.hand.map((card) => card.cardId)).toEqual(["S006"]);

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
      { type: "attack", attackerInstanceId: "l3-friend-a", target: { type: "MINION", side: "player2", instanceId: "l3-bc-enemy" } },
      { type: "attack", attackerInstanceId: "l3-friend-b", target: { type: "MINION", side: "player2", instanceId: "l3-bc-enemy" } }
    ]);

    expect(session.status).toBe("finished");
    expect(session.result?.winnerSeat).toBe("player1");
    // 吳敦義's +1 raised the two attackers to 3 (王定宇, l3-friend-a) and 2 (條碼師, l3-friend-b);
    // their combined 5 damage killed the 2/5 enemy and both survived (王定宇 7→5, 條碼師 4→2).
    expect(session.players.player2.board).toHaveLength(0);
    const friendA = session.players.player1.board.find((m) => m.instanceId === "l3-friend-a");
    const friendB = session.players.player1.board.find((m) => m.instanceId === "l3-friend-b");
    expect(friendA?.attack).toBe(3);
    expect(friendA?.baseAttack).toBe(2); // attack > baseAttack ⇒ rendered green (buffed)
    expect(friendA?.currentHealth).toBe(5);
    expect(friendB?.attack).toBe(2);
    expect(friendB?.baseAttack).toBe(1);
    expect(friendB?.currentHealth).toBe(2);
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

  it("reverts conditional buffs: enrage clears on heal, aura dies with 京華城", () => {
    const session = createTrainingSession("advanced_keywords");
    const board = () => session.players.player1.board;
    const find = (id: string) => board().find((m) => m.instanceId === id);
    const advanceToGated = () => {
      for (let guard = 0; guard < 100; guard++) {
        if (trainingPrompt(session)?.allowedAction !== "next") return;
        advanceTraining(session);
      }
    };

    // Enrage segment → gated attack leaves 台積電工程師 wounded at green 4 attack.
    advanceToGated();
    handleTrainingCommand(session, {
      type: "attack",
      attackerInstanceId: "l4-enrage",
      target: { type: "MINION", side: "player2", instanceId: "l4-enrage-enemy" }
    });
    expect(find("l4-enrage")?.attack).toBe(4);
    expect(find("l4-enrage")?.isEnraged).toBe(true);

    // Healing it back to full clears enrage: attack reverts to the original 1.
    advanceTraining(session); // l4_enrage_result.apply heals it
    expect(find("l4-enrage")?.attack).toBe(1);
    expect(find("l4-enrage")?.baseAttack).toBe(1);
    expect(find("l4-enrage")?.isEnraged).toBe(false);
    expect(find("l4-enrage")?.currentHealth).toBe(4);

    // 遺志 gated attack, then play 京華城 — its aura buffs both 蔡想想 to green 2/2.
    advanceToGated();
    handleTrainingCommand(session, {
      type: "attack",
      attackerInstanceId: "l4-death",
      target: { type: "MINION", side: "player2", instanceId: "l4-killer" }
    });
    advanceToGated();
    handleTrainingCommand(session, { type: "playCard", handInstanceId: "l4-aura-hand" });
    for (const id of ["l4-aura-left", "l4-aura-right"]) {
      expect(find(id)?.attack).toBe(2);
      expect(find(id)?.baseAttack).toBe(1); // attack > baseAttack ⇒ green
      expect(find(id)?.currentHealth).toBe(2); // currentHealth > catalog 1 ⇒ green
    }

    // 政治清算 kills 京華城 → aura vanishes, both 蔡想想 snap back to plain 1/1.
    advanceTraining(session); // l4_aura_result.apply runs the removal
    expect(find("l4-aura")).toBeUndefined();
    for (const id of ["l4-aura-left", "l4-aura-right"]) {
      expect(find(id)?.attack).toBe(1);
      expect(find(id)?.attack).toBe(find(id)?.baseAttack); // back to neutral
      expect(find(id)?.currentHealth).toBe(1);
    }

    // Replayed 韓國瑜 lands as a green 4/4 (attack 4 over baseAttack 2).
    advanceToGated();
    handleTrainingCommand(session, { type: "playCard", handInstanceId: "l4-bounce-hand" });
    expect(find("l4-bounce")?.attack).toBe(4);
    expect(find("l4-bounce")?.baseAttack).toBe(2);
    expect(find("l4-bounce")?.currentHealth).toBe(4);
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

describe("amplification and field lesson", () => {
  it("teaches turn counter, low/high amplifications, and the Morakot comeback event", () => {
    const session = createTrainingSession("amp_field");

    expect(trainingPrompt(session)?.highlights).toContainEqual({ type: "turnCounter" });
    expect(session.hand.map((card) => [card.instanceId, card.cost])).toEqual([["l5-four-cost-hand", 4]]);
    expect(session.players.player1.mana).toEqual({ current: 3, max: 3 });

    advanceTraining(session);
    expect(session.turnNumber).toBe(7);
    advanceTraining(session);
    expect(session.phase).toBe("AMPLIFICATION_PHASE");
    expect(session.amplificationOptions?.map((option) => option.id)).toContain("AMP_INVOICE_200");

    const wrongAmp = handleTrainingCommand(session, { type: "selectAmplification", optionId: "AMP_SHAREHOLDER_GIFT" });
    expect(wrongAmp.rejected).toBeTruthy();
    expect(session.players.player1.mana).toEqual({ current: 3, max: 3 });

    handleTrainingCommand(session, { type: "selectAmplification", optionId: "AMP_INVOICE_200" });
    expect(session.phase).toBe("NORMAL_PLAY");
    expect(session.players.player1.mana).toEqual({ current: 4, max: 4 });
    expect(session.players.player1.augments?.map((augment) => augment.id)).toEqual(["AMP_INVOICE_200"]);

    advanceTraining(session);
    handleTrainingCommand(session, { type: "playCard", handInstanceId: "l5-four-cost-hand" });
    expect(session.players.player1.mana).toEqual({ current: 0, max: 4 });
    expect(session.players.player1.board[0]?.instanceId).toBe("l5-four-cost-minion");

    driveLesson(session, [
      { type: "selectAmplification", optionId: "AMP_ONE_PARTY_DOMINANCE" },
      { type: "submitVote", optionIndex: 0 }
    ]);

    expect(session.status).toBe("finished");
    expect(session.turnNumber).toBe(20);
    expect(session.players.player1.augments?.map((augment) => augment.id)).toEqual([
      "AMP_INVOICE_200",
      "AMP_ONE_PARTY_DOMINANCE"
    ]);
    expect(session.players.player2.board).toHaveLength(0);
    expect(session.players.player2.graveyardCount).toBe(7);
  });
});
