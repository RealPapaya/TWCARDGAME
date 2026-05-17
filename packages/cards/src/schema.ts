import { z } from "zod";

export const EffectSchema: z.ZodType<Record<string, unknown>> = z.lazy(() =>
  z
    .object({
      type: z.string().min(1).optional(),
      value: z.number().int().optional(),
      bonus_value: z.number().int().optional(),
      stat: z.enum(["ATTACK", "HEALTH", "ALL"]).optional(),
      target: z
        .object({
          side: z.enum(["FRIENDLY", "ENEMY", "ALL"]).optional(),
          type: z.enum(["MINION", "HERO", "ALL"]).optional()
        })
        .passthrough()
        .optional(),
      target_category: z.string().optional(),
      target_category_includes: z.string().optional(),
      excluded_categories: z.array(z.string()).optional(),
      cardId: z.string().optional(),
      count: z.number().int().positive().optional(),
      isTemporary: z.boolean().optional(),
      summon: z.array(z.string()).optional(),
      discardCount: z.number().int().positive().optional(),
      drawCount: z.number().int().positive().optional(),
      effect: EffectSchema.optional()
    })
    .passthrough()
);

export const KeywordsSchema = z
  .object({
    taunt: z.boolean().optional(),
    charge: z.boolean().optional(),
    divineShield: z.boolean().optional(),
    battlecry: EffectSchema.optional(),
    deathrattle: EffectSchema.optional(),
    ongoing: EffectSchema.optional(),
    enrage: EffectSchema.optional(),
    triggered: EffectSchema.optional(),
    quest: EffectSchema.optional(),
    onDiscard: z.string().optional(),
    newsPower: z.number().int().optional()
  })
  .passthrough();

export const CardSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    category: z.string().min(1),
    cost: z.number().int().min(0),
    type: z.enum(["MINION", "NEWS"]),
    rarity: z.enum(["COMMON", "RARE", "EPIC", "LEGENDARY", "REPIC"]),
    description: z.string(),
    image: z.string().min(1),
    attack: z.number().int().optional(),
    health: z.number().int().optional(),
    keywords: KeywordsSchema.optional(),
    collectible: z.boolean().optional(),
    bounce_bonus: z.number().int().optional()
  })
  .superRefine((card, ctx) => {
    if (card.type === "MINION") {
      if (typeof card.attack !== "number") {
        ctx.addIssue({ code: "custom", message: "MINION cards require attack", path: ["attack"] });
      }
      if (typeof card.health !== "number") {
        ctx.addIssue({ code: "custom", message: "MINION cards require health", path: ["health"] });
      }
    }
  });
