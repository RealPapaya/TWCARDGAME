import { describe, expect, it } from "vitest";
import {
  SOCIAL_ROOKIE_TRAINING,
  advanceTraining,
  createSocialRookieTraining,
  handleTrainingCommand,
  trainingPrompt
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
