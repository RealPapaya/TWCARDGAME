// Pure data + odds-computation + SQL-export helpers for the balance-editor
// "卡包" (shop card packs) tab. Kept free of DOM so the maths and SQL generation
// are unit-testable.
//
// Card packs have no TypeScript catalog the way cards/amps/votes do — their only
// source of truth is the SQL seed in
// packages/db/migrations/0024_faction_card_packs.sql (last touched by 0034). The
// purchase flow (`purchase_shop_item`) draws each card in two steps:
//   1. roll a rarity from the pack's `dropRates` (cumulative),
//   2. pick a card of that rarity, giving cards whose catalog `category` equals
//      the pack's `faction` a `factionWeight`x selection weight (Gumbel keys),
//      which reduces to a uniform pick when no faction is set.
// This module embeds an editable copy of that seed, reproduces the resulting
// odds against the live catalog, and re-emits an upsert in the same shape so the
// output can be pasted into a fresh migration.

export type PackRarity = "COMMON" | "RARE" | "EPIC" | "LEGENDARY";

export interface PackDropRate {
  label: string;
  rarity: PackRarity;
  rate: number;
}

/** The editor's working shape for a `shop_items` row of kind `CARD_PACK`. */
export interface ShopPackDraft {
  id: string;
  display_name: string;
  description: string;
  price_gold: number;
  cardCount: number;
  /** Catalog `category` whose cards get the weighted pull; undefined = no weighting. */
  faction?: string;
  /** Selection-weight multiplier for faction cards (DB default 3). */
  factionWeight: number;
  dropRates: PackDropRate[];
  image?: string;
  note?: string;
}

export const PACK_RARITIES: ReadonlyArray<{ value: PackRarity; label: string }> = [
  { value: "COMMON", label: "普通" },
  { value: "RARE", label: "精良" },
  { value: "EPIC", label: "史詩" },
  { value: "LEGENDARY", label: "傳說" }
];

const FACTION_RATES: PackDropRate[] = [
  { label: "普通", rarity: "COMMON", rate: 60 },
  { label: "精良", rarity: "RARE", rate: 30 },
  { label: "史詩", rarity: "EPIC", rate: 7 },
  { label: "傳說", rarity: "LEGENDARY", rate: 3 }
];

/**
 * Initial seed, mirroring packages/db/migrations/0024_faction_card_packs.sql
 * (as carried forward by 0034). The four faction packs roll 60/30/7/3 and weight
 * their own faction 3x; the general pack rolls 50/35/10/5 with no weighting.
 */
export const SHOP_PACK_SEED: readonly ShopPackDraft[] = [
  {
    id: "pack-kmt",
    display_name: "國民黨牌組",
    description: "包含 5 張隨機卡牌，有較高機率抽到國民黨政治人物。",
    price_gold: 100,
    cardCount: 5,
    faction: "國民黨政治人物",
    factionWeight: 3,
    dropRates: FACTION_RATES.map((r) => ({ ...r })),
    image: "/images/ui/SHOP_KMT.webp"
  },
  {
    id: "pack-dpp",
    display_name: "民進黨牌組",
    description: "包含 5 張隨機卡牌，有較高機率抽到民進黨政治人物。",
    price_gold: 100,
    cardCount: 5,
    faction: "民進黨政治人物",
    factionWeight: 3,
    dropRates: FACTION_RATES.map((r) => ({ ...r })),
    image: "/images/ui/SHOP_DPP.webp"
  },
  {
    id: "pack-tpp",
    display_name: "民眾黨牌組",
    description: "包含 5 張隨機卡牌，有較高機率抽到民眾黨政治人物。",
    price_gold: 100,
    cardCount: 5,
    faction: "民眾黨政治人物",
    factionWeight: 3,
    dropRates: FACTION_RATES.map((r) => ({ ...r })),
    image: "/images/ui/Carddeck.webp"
  },
  {
    id: "pack-worker",
    display_name: "勞工牌組",
    description: "包含 5 張隨機卡牌，有較高機率抽到勞工。",
    price_gold: 100,
    cardCount: 5,
    faction: "勞工",
    factionWeight: 3,
    dropRates: FACTION_RATES.map((r) => ({ ...r })),
    image: "/images/ui/SHOP_WORKER.webp"
  },
  {
    id: "pack-general",
    display_name: "通用牌組",
    description: "包含 5 張隨機卡牌，所有卡牌機率均等。",
    price_gold: 100,
    cardCount: 5,
    factionWeight: 3,
    dropRates: [
      { label: "普通", rarity: "COMMON", rate: 50 },
      { label: "精良", rarity: "RARE", rate: 35 },
      { label: "史詩", rarity: "EPIC", rate: 10 },
      { label: "傳說", rarity: "LEGENDARY", rate: 5 }
    ],
    image: "/images/ui/SHOP_CARD.webp"
  }
];

// ── odds computation ────────────────────────────────────────────────

/** Minimal card shape the odds maths needs from the catalog. */
export interface OddsCard {
  rarity?: string;
  category?: string;
  collectible?: boolean;
}

export interface PackRarityOdds {
  rarity: PackRarity;
  /** Drop rate for this rarity (percent, as authored). */
  rate: number;
  /** Collectible faction cards of this rarity in the catalog. */
  factionCount: number;
  /** Collectible non-faction cards of this rarity. */
  otherCount: number;
  /** P(card is the target faction | this rarity rolled), 0..1. */
  pFactionGivenRarity: number;
}

export interface PackOdds {
  perRarity: PackRarityOdds[];
  /** Sum of the authored drop rates; should be 100. */
  totalRate: number;
  /** Whether the pack targets a faction (has weighting). */
  hasFaction: boolean;
  /** P(a single drawn card is the target faction), 0..1. */
  perCardFactionChance: number;
  /** Expected number of target-faction cards in one pack open. */
  expectedFactionCards: number;
}

function isCollectible(card: OddsCard): boolean {
  return card.collectible !== false;
}

/**
 * Reproduces the per-card faction hit-rate that `purchase_shop_item` produces:
 * for each rarity, P(faction|rarity) = w·nFaction / (w·nFaction + nOther) under
 * the Gumbel-weighted pick, then weights by the rarity drop rate.
 */
export function computePackOdds(pack: ShopPackDraft, cards: readonly OddsCard[]): PackOdds {
  const faction = pack.faction?.trim() || undefined;
  const weight = Number.isFinite(pack.factionWeight) && pack.factionWeight > 0 ? pack.factionWeight : 1;
  const totalRate = pack.dropRates.reduce((sum, r) => sum + (Number.isFinite(r.rate) ? r.rate : 0), 0);

  const perRarity: PackRarityOdds[] = pack.dropRates.map((dr) => {
    const pool = cards.filter((c) => isCollectible(c) && c.rarity === dr.rarity);
    const factionCount = faction ? pool.filter((c) => c.category === faction).length : 0;
    const otherCount = pool.length - factionCount;
    const denom = weight * factionCount + otherCount;
    const pFactionGivenRarity = faction && denom > 0 ? (weight * factionCount) / denom : 0;
    return {
      rarity: dr.rarity,
      rate: Number.isFinite(dr.rate) ? dr.rate : 0,
      factionCount,
      otherCount,
      pFactionGivenRarity
    };
  });

  const perCardFactionChance =
    totalRate > 0
      ? perRarity.reduce((sum, r) => sum + (r.rate / totalRate) * r.pFactionGivenRarity, 0)
      : 0;

  return {
    perRarity,
    totalRate,
    hasFaction: !!faction,
    perCardFactionChance,
    expectedFactionCards: perCardFactionChance * (pack.cardCount || 0)
  };
}

// ── validation ──────────────────────────────────────────────────────

export type PackValidationIssue =
  | { type: "empty_id"; index: number }
  | { type: "duplicate_id"; id: string }
  | { type: "rate_sum"; id: string; total: number };

/** Surfaces problems that would make the exported SQL behave unexpectedly. */
export function validatePackDrafts(packs: readonly ShopPackDraft[]): PackValidationIssue[] {
  const issues: PackValidationIssue[] = [];
  const seen = new Set<string>();
  const reportedDup = new Set<string>();
  packs.forEach((pack, index) => {
    const id = pack.id.trim();
    if (!id) {
      issues.push({ type: "empty_id", index });
      return;
    }
    if (seen.has(id)) {
      if (!reportedDup.has(id)) {
        issues.push({ type: "duplicate_id", id });
        reportedDup.add(id);
      }
    } else {
      seen.add(id);
    }
    const total = pack.dropRates.reduce((sum, r) => sum + (Number.isFinite(r.rate) ? r.rate : 0), 0);
    if (Math.abs(total - 100) > 0.01) {
      issues.push({ type: "rate_sum", id: id || `#${index + 1}`, total });
    }
  });
  return issues;
}

// ── SQL export ──────────────────────────────────────────────────────

/** Doubles single quotes for safe inlining into a single-quoted SQL literal. */
export function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

function sqlString(value: string): string {
  return `'${escapeSqlString(value)}'`;
}

function buildContents(pack: ShopPackDraft): Record<string, unknown> {
  const contents: Record<string, unknown> = { cardCount: Math.trunc(pack.cardCount) };
  if (pack.image) contents.image = pack.image;
  if (pack.faction?.trim()) {
    contents.faction = pack.faction.trim();
    contents.factionWeight = pack.factionWeight;
    if (pack.note?.trim()) contents.note = pack.note.trim();
  }
  contents.dropRates = pack.dropRates.map((r) => ({
    label: r.label,
    rarity: r.rarity,
    rate: r.rate
  }));
  return contents;
}

const PACK_COLUMNS = "(id, kind, display_name, description, price_gold, contents)";

const ON_CONFLICT_CLAUSE = `on conflict (id) do update
  set kind         = excluded.kind,
      display_name = excluded.display_name,
      description  = excluded.description,
      price_gold   = excluded.price_gold,
      contents     = excluded.contents,
      active       = true;`;

/**
 * Emits an idempotent `insert ... on conflict do update` for the given packs,
 * mirroring the upsert shape of 0024_faction_card_packs.sql so the result can be
 * dropped into a new migration verbatim. Note this only re-seeds shop_items;
 * the `purchase_shop_item` function itself is unchanged.
 */
export function generatePackSeedSql(packs: readonly ShopPackDraft[]): string {
  const header = [
    "-- Auto-generated by balance-editor — 商店卡包 (shop_items / CARD_PACK) seed.",
    "-- Save as a new migration, e.g. packages/db/migrations/00NN_card_packs_seed.sql",
    "-- Mirrors the upsert shape from 0024_faction_card_packs.sql (idempotent).",
    "-- Re-seeds shop_items only; purchase_shop_item() draw logic is unchanged."
  ].join("\n");

  if (packs.length === 0) {
    return `${header}\n-- (no packs to export)\n`;
  }

  const rows = packs.map((pack) => {
    const contentsJson = JSON.stringify(buildContents(pack));
    const values = [
      sqlString(pack.id.trim()),
      sqlString("CARD_PACK"),
      sqlString(pack.display_name),
      sqlString(pack.description),
      String(Math.trunc(pack.price_gold)),
      `'${escapeSqlString(contentsJson)}'::jsonb`
    ];
    return `  (${values.join(", ")})`;
  });

  return [
    header,
    "",
    "insert into public.shop_items",
    `  ${PACK_COLUMNS}`,
    "values",
    `${rows.join(",\n")}`,
    ON_CONFLICT_CLAUSE,
    ""
  ].join("\n");
}
