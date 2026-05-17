# Phase 2 Rules Parity Audit

Date: 2026-05-17

## Result

Phase 2 rules parity is complete for the current 104-card catalog.

The v2 rules engine keeps gameplay mutations in `packages/rules`, preserves deterministic RNG, and covers every current behavioral card through either a named-card parity test or an explicit effect-family golden test.

## Legacy Cross-Reference

| Legacy source | v2 implementation | Test evidence | Status |
| --- | --- | --- | --- |
| `LEGACY/js/engine/game_engine.js:138-910` battlecry handlers | `packages/rules/src/effects.ts:15-69`, `317-730` | `packages/rules/src/effects.golden.test.ts` | Complete |
| `LEGACY/js/engine/game_engine.js:913-945` bounce card reconstruction | `packages/rules/src/effects.ts:787-803`, `750-771` | `parity-mechanics.test.ts` BOUNCE_SELF and bounce families | Complete |
| `LEGACY/js/engine/game_engine.js:949-958` news power total | `packages/rules/src/state.ts:183-185`, `effects.ts:302-315` | `parity-mechanics.test.ts` newsPower test | Complete |
| `LEGACY/js/engine/game_engine.js:961-1098` end-turn timers and quests | `packages/rules/src/effects.ts:106-129`, `734-748` | `parity-mechanics.test.ts` quests/timers tests | Complete |
| `LEGACY/js/engine/game_engine.js:993-1032` start-turn draw, mana, wakeup, auras | `packages/rules/src/effects.ts:88-104` | `rules.test.ts`, `parity-mechanics.test.ts` | Complete |
| `LEGACY/js/engine/game_engine.js:1133-1152` NEWS cost reduction | `packages/rules/src/state.ts:96-108` | `parity-mechanics.test.ts` REDUCE_NEWS_COST test | Complete |
| `LEGACY/js/engine/game_engine.js:1167-1247` card play flow | `packages/rules/src/engine.ts:210-266` | `rules.test.ts`, `effects.golden.test.ts`, `parity-mechanics.test.ts` | Complete |
| `LEGACY/js/engine/game_engine.js:1251-1357` ongoing auras | `packages/rules/src/effects.ts:202-254` | `parity-mechanics.test.ts` aura tests | Complete |
| `LEGACY/js/engine/game_engine.js:1361-1399` battlecry resolution and NEWS bonus | `packages/rules/src/effects.ts:71-79`, `302-315` | `effects.golden.test.ts`, `parity-mechanics.test.ts` | Complete |
| `LEGACY/js/engine/game_engine.js:1402-1422` discard triggers | `packages/rules/src/effects.ts:591-606`, `774-784` | `parity-mechanics.test.ts` discard trigger test | Complete |
| `LEGACY/js/engine/game_engine.js:1424-1445` on-play-NEWS triggers | `packages/rules/src/effects.ts:288-300` | `parity-mechanics.test.ts` NEWS-play trigger test | Complete |
| `LEGACY/js/engine/game_engine.js:1466-1490` minion creation | `packages/rules/src/state.ts:111-150` | `rules.test.ts`, `parity-mechanics.test.ts` | Complete |
| `LEGACY/js/engine/game_engine.js:1514-1576` damage and divine shield | `packages/rules/src/effects.ts:154-169` | `effects.golden.test.ts` | Complete |
| `LEGACY/js/engine/game_engine.js:1579-1604` enrage | `packages/rules/src/effects.ts:188-199` | `parity-mechanics.test.ts` enrage test | Complete |
| `LEGACY/js/engine/game_engine.js:1608-1651` attack validation and combat | `packages/rules/src/engine.ts:268-314` | `rules.test.ts` target/taunt tests | Complete |
| `LEGACY/js/engine/game_engine.js:1670-1725` death and deathrattle resolution | `packages/rules/src/effects.ts:257-275`, `750-771` | `parity-mechanics.test.ts` deathrattle tests | Complete |
| `LEGACY/js/engine/game_engine.js:1730-1775` player draw/hand limit | `packages/rules/src/effects.ts:132-151` | `effects.golden.test.ts`, `parity-mechanics.test.ts` | Complete |

## Effect Family Coverage

Covered effect families:

- Damage: `DAMAGE`, `DAMAGE_SELF`, `DAMAGE_ALL_ENEMY_MINIONS`, `DAMAGE_ALL_NON_CATEGORIES`, `DAMAGE_NON_CATEGORY`, random and multi-damage variants.
- Heal: `HEAL`, `FULL_HEAL`, `HEAL_ALL_FRIENDLY`, category-bonus heal, full-heal-and-draw.
- Buff: `BUFF_ALL`, `BUFF_CATEGORY`, targeted, temporary, adjacent, keyword, shield, and set-attack variants.
- Draw/discard: `DRAW`, typed draw, discard-draw, random discard, `ON_DISCARD`, discarded-card summon.
- Board movement/removal: destroy variants, bounce variants, deathrattle bounce/summon/draw.
- Persistent mechanics: ongoing auras, enrage, quests, lock timers, death timers, NEWS cost reduction, NEWS power, on-play-NEWS triggers.

## Determinism

The legacy engine used browser/runtime randomness in several handlers. v2 intentionally preserves gameplay semantics while replacing random selection with the seeded rules RNG in `packages/rules/src/rng.ts`.

Replay determinism is covered by `packages/rules/src/rules.test.ts`, and random effect behavior is covered by golden tests.

## Completion Checks

Required checks for Phase 2:

- `npm.cmd run validate:cards`
- `npm.cmd test`
- `npm.cmd run check`

All three must pass before marking Phase 2 complete.
