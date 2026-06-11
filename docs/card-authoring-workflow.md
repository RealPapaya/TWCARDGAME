# Card Authoring Workflow

This guide covers the safe path for adding cards to the v2 catalog. The catalog is data, but card behavior is not free-form: every gameplay mechanic must be accepted by `packages/cards` validation and implemented by deterministic handlers in `packages/rules`.

## Data-Only Cards

Use this path when the card uses only existing fields and existing effect types.

1. Edit `packages/cards/src/catalog.generated.ts`.
2. Use a stable, unique `id`. Keep current casing conventions: `TW###` for minions and `S###` for NEWS-style spell cards.
3. Fill every base field: `id`, `name`, `category`, `cost`, `type`, `rarity`, `description`, and `image`.
4. For `MINION` cards, include integer `attack` and `health`. Do not add those fields to `NEWS` cards unless a future schema requires it.
5. Point `image` at an existing client asset path under `apps/web/public/`. Prefer the same filename stem as the card id or an existing asset name.
6. Add only supported keyword hooks and effect types. The validator rejects unsupported hooks, missing referenced cards, and effect payloads missing required fields.
7. Run:

```bash
npm run validate:cards
npm test
npm run check
```

Publish the catalog only after validation and tests pass:

```bash
npm run publish:catalog
```

## New Mechanics

Use this path when a card needs a new effect type, new effect field, or a new keyword hook behavior.

1. Extend the card contract in `packages/cards/src/types.ts`. Add the new supported effect type to the narrow hook list that owns it, such as battlecry, deathrattle, ongoing, triggered, enrage, or quest.
2. Extend `packages/cards/src/schema.ts` if the mechanic introduces a new structured field.
3. Extend `packages/cards/src/validation.ts` with required-field rules and reference checks before adding catalog cards that use the mechanic.
4. Implement the deterministic rules behavior under `packages/rules/src/effects/` and expose it through `packages/rules/src/effects/registry.ts`.
5. Add focused rules tests for the mechanic before relying on it in future cards. Use `packages/rules/src/effects.golden.test.ts` for basic handler coverage and `packages/rules/src/parity-mechanics.test.ts` for combination or regression-prone behavior.
6. Keep web and server as adapters. They may render state, send commands, or animate events, but gameplay outcomes must stay in `packages/rules`.

Rules code must not use DOM APIs, Colyseus, Supabase, timers, `Date.now()`, or `Math.random()`. If randomness is needed, use the seeded rules RNG so command logs replay deterministically.

## Review Checklist

- `npm run validate:cards` accepts the whole catalog.
- New or changed effect types have rules handlers.
- New effect fields have schema and validation coverage.
- New card references resolve to existing catalog ids.
- New mechanics have tests before cards depend on them.
- No gameplay mutation was added to `apps/web` or `apps/server`.
