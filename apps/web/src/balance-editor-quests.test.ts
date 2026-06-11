import { describe, expect, it } from "vitest";
import {
  QUEST_DEFINITIONS_SEED,
  escapeSqlString,
  generateQuestSeedSql,
  validateQuestDrafts,
  type QuestDefinitionDraft
} from "./balance-editor-quests.js";

function draft(overrides: Partial<QuestDefinitionDraft> = {}): QuestDefinitionDraft {
  return {
    id: "q1",
    display_name: "名稱",
    description: "說明",
    event_type: "match_won",
    target_count: 3,
    recurrence: "daily",
    rewardGold: 40,
    active: true,
    ...overrides
  };
}

describe("QUEST_DEFINITIONS_SEED", () => {
  it("matches the 0023 task list: 13 quests, 6 achievements + 7 daily", () => {
    expect(QUEST_DEFINITIONS_SEED).toHaveLength(13);
    expect(QUEST_DEFINITIONS_SEED.filter((q) => q.recurrence === "once")).toHaveLength(6);
    expect(QUEST_DEFINITIONS_SEED.filter((q) => q.recurrence === "daily")).toHaveLength(7);
  });

  it("has unique non-empty ids", () => {
    expect(validateQuestDrafts(QUEST_DEFINITIONS_SEED)).toEqual([]);
    const ids = new Set(QUEST_DEFINITIONS_SEED.map((q) => q.id));
    expect(ids.size).toBe(QUEST_DEFINITIONS_SEED.length);
  });
});

describe("escapeSqlString", () => {
  it("doubles single quotes", () => {
    expect(escapeSqlString("O'Brien")).toBe("O''Brien");
    expect(escapeSqlString("plain")).toBe("plain");
  });
});

describe("generateQuestSeedSql", () => {
  it("emits the insert header, column list and on-conflict clause", () => {
    const sql = generateQuestSeedSql([draft()]);
    expect(sql).toContain("insert into public.quest_definitions");
    expect(sql).toContain("(id, display_name, description, event_type, target_count, recurrence, reward, active)");
    expect(sql).toContain("on conflict (id) do update");
    expect(sql).toContain("updated_at   = now();");
  });

  it("renders one value tuple per quest with a jsonb reward and boolean active", () => {
    const sql = generateQuestSeedSql([draft({ id: "daily_win_1", rewardGold: 50, active: false })]);
    expect(sql).toContain("('daily_win_1', '名稱', '說明', 'match_won', 3, 'daily', '{\"gold\":50}'::jsonb, false)");
  });

  it("escapes single quotes inside string columns", () => {
    const sql = generateQuestSeedSql([draft({ display_name: "It's a trap", description: "don't" })]);
    expect(sql).toContain("'It''s a trap'");
    expect(sql).toContain("'don''t'");
  });

  it("comma-separates rows but leaves no trailing comma before on conflict", () => {
    const sql = generateQuestSeedSql([draft({ id: "a" }), draft({ id: "b" })]);
    expect(sql).toContain("'a', '名稱'");
    expect(sql).toContain("'b', '名稱'");
    // First tuple carries a comma; the final tuple connects straight to the
    // conflict clause with no dangling comma.
    expect(sql).toMatch(/\),\n {2}\(/); // separator between the two rows
    expect(sql).toMatch(/\)\non conflict \(id\) do update/);
    expect(sql).not.toMatch(/\),\non conflict/);
  });

  it("truncates fractional target/reward to integers", () => {
    const sql = generateQuestSeedSql([draft({ target_count: 2.9, rewardGold: 15.9 })]);
    expect(sql).toContain(", 2, ");
    expect(sql).toContain('{"gold":15}');
  });

  it("round-trips the full seed into a single statement", () => {
    const sql = generateQuestSeedSql(QUEST_DEFINITIONS_SEED);
    expect((sql.match(/insert into public\.quest_definitions/g) ?? [])).toHaveLength(1);
    for (const quest of QUEST_DEFINITIONS_SEED) {
      expect(sql).toContain(`'${quest.id}'`);
    }
  });

  it("returns a comment-only stub when there is nothing to export", () => {
    const sql = generateQuestSeedSql([]);
    expect(sql).toContain("no quests to export");
    expect(sql).not.toContain("insert into");
  });
});

describe("validateQuestDrafts", () => {
  it("flags empty ids by index", () => {
    const issues = validateQuestDrafts([draft({ id: "ok" }), draft({ id: "  " })]);
    expect(issues).toEqual([{ type: "empty_id", index: 1 }]);
  });

  it("flags a duplicate id once", () => {
    const issues = validateQuestDrafts([draft({ id: "dup" }), draft({ id: "dup" }), draft({ id: "dup" })]);
    expect(issues).toEqual([{ type: "duplicate_id", id: "dup" }]);
  });
});
