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
    for (const tier of ["加減賺", "吃紅", "卯死"] as const) {
      expect(filterAmplification(AMPLIFICATION_DB, undefined, tier).length).toBeGreaterThanOrEqual(1);
    }
  });

  it("filters amplifications by faction tag, treating empty tags as universal", () => {
    // All seeded rows are universal (factionTags: []), so any faction sees them all.
    expect(filterAmplification(AMPLIFICATION_DB, "民進黨政治人物").length).toBe(AMPLIFICATION_DB.length);
  });
});
