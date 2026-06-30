import { describe, expect, it } from "vitest";
import {
  SHOP_PACK_SEED,
  computePackOdds,
  validatePackDrafts,
  generatePackSeedSql,
  type OddsCard,
  type ShopPackDraft
} from "./balance-editor-packs.js";

function pack(overrides: Partial<ShopPackDraft> = {}): ShopPackDraft {
  return {
    id: "pack-x",
    display_name: "測試包",
    description: "說明",
    price_gold: 100,
    cardCount: 5,
    faction: "勞工",
    factionWeight: 3,
    dropRates: [
      { label: "普通", rarity: "COMMON", rate: 60 },
      { label: "精良", rarity: "RARE", rate: 30 },
      { label: "史詩", rarity: "EPIC", rate: 7 },
      { label: "傳說", rarity: "LEGENDARY", rate: 3 }
    ],
    ...overrides
  };
}

describe("SHOP_PACK_SEED", () => {
  it("mirrors the 0024 line-up: 4 faction packs + 1 general", () => {
    expect(SHOP_PACK_SEED).toHaveLength(5);
    expect(SHOP_PACK_SEED.filter((p) => p.faction)).toHaveLength(4);
    expect(SHOP_PACK_SEED.find((p) => p.id === "pack-general")?.faction).toBeUndefined();
  });

  it("every pack's drop rates sum to 100", () => {
    for (const p of SHOP_PACK_SEED) {
      const total = p.dropRates.reduce((s, r) => s + r.rate, 0);
      expect(total).toBe(100);
    }
  });
});

describe("computePackOdds", () => {
  // 2 faction commons, 8 other commons; 1 faction rare, 1 other rare; nothing else.
  const cards: OddsCard[] = [
    ...Array.from({ length: 2 }, () => ({ rarity: "COMMON", category: "勞工" })),
    ...Array.from({ length: 8 }, () => ({ rarity: "COMMON", category: "新聞" })),
    { rarity: "RARE", category: "勞工" },
    { rarity: "RARE", category: "新聞" }
  ];

  it("weights faction cards by factionWeight within each rarity", () => {
    const odds = computePackOdds(pack({ factionWeight: 3 }), cards);
    const common = odds.perRarity.find((r) => r.rarity === "COMMON")!;
    // 3*2 / (3*2 + 8) = 6/14
    expect(common.pFactionGivenRarity).toBeCloseTo(6 / 14, 6);
    const rare = odds.perRarity.find((r) => r.rarity === "RARE")!;
    // 3*1 / (3*1 + 1) = 3/4
    expect(rare.pFactionGivenRarity).toBeCloseTo(3 / 4, 6);
  });

  it("rarities with no cards contribute zero hit chance", () => {
    const odds = computePackOdds(pack(), cards);
    const epic = odds.perRarity.find((r) => r.rarity === "EPIC")!;
    expect(epic.factionCount).toBe(0);
    expect(epic.pFactionGivenRarity).toBe(0);
  });

  it("per-card chance weights each rarity by its drop rate; expected scales by cardCount", () => {
    const odds = computePackOdds(pack({ cardCount: 5 }), cards);
    const expectedPerCard = 0.6 * (6 / 14) + 0.3 * (3 / 4) + 0.07 * 0 + 0.03 * 0;
    expect(odds.perCardFactionChance).toBeCloseTo(expectedPerCard, 6);
    expect(odds.expectedFactionCards).toBeCloseTo(expectedPerCard * 5, 6);
  });

  it("a higher weight raises the hit rate", () => {
    const low = computePackOdds(pack({ factionWeight: 3 }), cards).perCardFactionChance;
    const high = computePackOdds(pack({ factionWeight: 20 }), cards).perCardFactionChance;
    expect(high).toBeGreaterThan(low);
  });

  it("treats a pack with no faction as uniform (no hit metric)", () => {
    const odds = computePackOdds(pack({ faction: undefined }), cards);
    expect(odds.hasFaction).toBe(false);
    expect(odds.perCardFactionChance).toBe(0);
  });

  it("excludes non-collectible cards from the pool", () => {
    const withToken: OddsCard[] = [
      { rarity: "COMMON", category: "勞工" },
      { rarity: "COMMON", category: "勞工", collectible: false }
    ];
    const odds = computePackOdds(pack(), withToken);
    const common = odds.perRarity.find((r) => r.rarity === "COMMON")!;
    expect(common.factionCount).toBe(1);
  });
});

describe("validatePackDrafts", () => {
  it("flags empty ids, duplicate ids, and rate sums != 100", () => {
    const issues = validatePackDrafts([
      pack({ id: "" }),
      pack({ id: "dup" }),
      pack({ id: "dup" }),
      pack({ id: "bad", dropRates: [{ label: "普通", rarity: "COMMON", rate: 90 }] })
    ]);
    expect(issues).toContainEqual({ type: "empty_id", index: 0 });
    expect(issues).toContainEqual({ type: "duplicate_id", id: "dup" });
    expect(issues.some((i) => i.type === "rate_sum")).toBe(true);
  });

  it("passes the seed packs", () => {
    expect(validatePackDrafts(SHOP_PACK_SEED)).toEqual([]);
  });
});

describe("generatePackSeedSql", () => {
  it("emits an idempotent upsert into shop_items with CARD_PACK contents", () => {
    const sql = generatePackSeedSql([pack({ id: "pack-test" })]);
    expect(sql).toContain("insert into public.shop_items");
    expect(sql).toContain("'pack-test'");
    expect(sql).toContain("'CARD_PACK'");
    expect(sql).toContain("on conflict (id) do update");
    expect(sql).toContain('"faction":"勞工"');
    expect(sql).toContain('"factionWeight":3');
    expect(sql).toContain("::jsonb");
  });

  it("omits faction/weight for a general (unfactioned) pack", () => {
    const sql = generatePackSeedSql([pack({ id: "pack-gen", faction: undefined })]);
    expect(sql).not.toContain('"faction"');
    expect(sql).not.toContain('"factionWeight"');
  });

  it("escapes single quotes in display fields", () => {
    const sql = generatePackSeedSql([pack({ display_name: "O'Brien" })]);
    expect(sql).toContain("'O''Brien'");
  });
});
