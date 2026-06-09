import { describe, expect, it } from "vitest";
import { AMPLIFICATION_DB, filterAmplification, validateAmplificationDb } from "./amplificationDb.js";
import { VOTE_EVENT_DB, validateVoteEventDb } from "./voteEventDb.js";

describe("special-phase databases", () => {
  it("validates the amplification DB (unique ids, valid tiers)", () => {
    const result = validateAmplificationDb(AMPLIFICATION_DB);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("validates the vote-event DB (unique ids, positive weights, 3 options)", () => {
    const result = validateVoteEventDb(VOTE_EVENT_DB);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("offers at least one amplification per tier so the sampler can fill three picks", () => {
    for (const tier of ["加減賺", "穩穩仔賺", "卯死"] as const) {
      expect(filterAmplification(AMPLIFICATION_DB, undefined, tier).length).toBeGreaterThanOrEqual(1);
    }
  });

  it("filters amplifications by faction tag, treating empty tags as universal", () => {
    const universal = AMPLIFICATION_DB.filter((e) => e.factionTags.length === 0);
    // DPP sees all universal entries plus DPP-tagged ones, but never the 勞工 entry.
    const dpp = filterAmplification(AMPLIFICATION_DB, "民進黨政治人物");
    expect(dpp.some((e) => e.id === "AMP_ISLAND_DAWN")).toBe(true);
    expect(dpp.some((e) => e.id === "AMP_TYPHOON_DAY")).toBe(false);
    expect(dpp.every((e) => e.factionTags.length === 0 || e.factionTags.includes("民進黨政治人物"))).toBe(true);
    // Labor sees its own entry; a no-faction query sees only the universal entries.
    expect(filterAmplification(AMPLIFICATION_DB, "勞工").some((e) => e.id === "AMP_TYPHOON_DAY")).toBe(true);
    expect(filterAmplification(AMPLIFICATION_DB, undefined).length).toBe(universal.length);
  });

  it("flags an unsupported augment effect type", () => {
    const bad = [
      ...AMPLIFICATION_DB,
      { id: "AMP_BAD", name: "x", description: "x", tier: "加減賺" as const, factionTags: [], effect: { type: "NOPE" } }
    ];
    const result = validateAmplificationDb(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("AMP_BAD"))).toBe(true);
  });

  it("validates required mana-ramp effect fields", () => {
    const bad = [
      ...AMPLIFICATION_DB,
      {
        id: "AMP_BAD_RAMP",
        name: "x",
        description: "x",
        tier: "穩穩仔賺" as const,
        factionTags: [],
        effect: { type: "AUG_MANA_RAMP_AFTER_TURN", manaCap: 15 }
      }
    ];
    const result = validateAmplificationDb(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.filter((e) => e.includes("AMP_BAD_RAMP"))).toHaveLength(2);
  });

  it("validates required fields for the new augment effects", () => {
    const bad = [
      ...AMPLIFICATION_DB,
      {
        id: "AMP_BAD_HP_LOSS",
        name: "x",
        description: "x",
        tier: "加減賺" as const,
        factionTags: [],
        effect: { type: "AUG_SELF_HP_LOSS_GRANT_CRYSTALS_NEXT_TURN" }
      },
      {
        id: "AMP_BAD_BOUNCE_BUFF",
        name: "x",
        description: "x",
        tier: "穩穩仔賺" as const,
        factionTags: [],
        effect: { type: "AUG_BOUNCE_OWN_BOARD_TO_HAND_BUFF" }
      }
    ];
    const result = validateAmplificationDb(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.filter((e) => e.includes("AMP_BAD_HP_LOSS"))).toHaveLength(2);
    expect(result.errors.filter((e) => e.includes("AMP_BAD_BOUNCE_BUFF"))).toHaveLength(1);
  });

  it("restricts firstPhaseOnly to the designed augments", () => {
    expect(AMPLIFICATION_DB.filter((e) => e.firstPhaseOnly).map((e) => e.id).sort()).toEqual([
      "AMP_0050",
      "AMP_DEFAULT_SETTLEMENT",
      "AMP_GO_FOR_BROKE"
    ]);
  });

  it("defines the three TPP amplifications with the intended tiers and category", () => {
    expect(
      ["AMP_THREE_WAY_RACE", "AMP_RETURN_COUNTRY_TO_YOU", "AMP_GARBAGE_NO_BLUE_GREEN"].map((id) => {
        const augment = AMPLIFICATION_DB.find((entry) => entry.id === id);
        return {
          name: augment?.name,
          tier: augment?.tier,
          factionTags: augment?.factionTags,
          targetCategory: augment?.effect.target_category
        };
      })
    ).toEqual([
      { name: "政壇三腳督", tier: "加減賺", factionTags: ["民眾黨政治人物"], targetCategory: "民眾黨政治人物" },
      { name: "把國家還給你們", tier: "穩穩仔賺", factionTags: ["民眾黨政治人物"], targetCategory: "民眾黨政治人物" },
      { name: "垃圾不分藍綠", tier: "卯死", factionTags: ["民眾黨政治人物"], targetCategory: "民眾黨政治人物" }
    ]);
  });

  it("validates category and value fields for TPP augment effect types", () => {
    const bad = [
      ...AMPLIFICATION_DB,
      {
        id: "AMP_BAD_CATEGORY_DRAW",
        name: "x",
        description: "x",
        tier: "加減賺" as const,
        factionTags: [],
        effect: { type: "AUG_DRAW_CATEGORY", value: 0 }
      },
      {
        id: "AMP_BAD_CATEGORY_HEAL",
        name: "x",
        description: "x",
        tier: "穩穩仔賺" as const,
        factionTags: [],
        effect: { type: "AUG_CATEGORY_DEATHRATTLE_ADJACENT_HEAL", target_category: "x" }
      }
    ];
    const result = validateAmplificationDb(bad);
    expect(result.errors.filter((error) => error.includes("AMP_BAD_CATEGORY_DRAW"))).toHaveLength(2);
    expect(result.errors.filter((error) => error.includes("AMP_BAD_CATEGORY_HEAL"))).toHaveLength(1);
  });
});
