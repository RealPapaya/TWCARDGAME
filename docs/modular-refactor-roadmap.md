# Modular Refactor Roadmap

This roadmap follows the Phase 1 web-first extraction. The long-term goal is to keep card additions, new game features, and UI growth maintainable without moving gameplay rules into the web or server layers.

## Phase 2: Web State And Service Cleanup

- [x] Introduce a small app context or store only after the Phase 1 extraction is stable.
- [x] Reduce direct cross-module imports by grouping state reads, state writes, and render scheduling behind narrow helpers.
- [x] Document ownership for screens, services, battle helpers, shared UI helpers, and app bootstrap code.
- [x] Keep all gameplay mutations flowing through server commands and the rules engine.

Done in `apps/web/src/app/context.ts`, `apps/web/src/app/types.ts`, and [Web Module Ownership](./web-module-ownership.md).

## Phase 3: Rules Effect Modularization

- [x] Split `packages/rules/src/effects.ts` into mechanic-focused effect modules.
- [x] Keep a single effect registry entrypoint so card definitions remain data-driven.
- [x] Group handlers by mechanic family such as damage, healing, draw, summon, destroy, bounce, buffs, keywords, and turn lifecycle.
- [x] Preserve deterministic rules constraints: no DOM, Colyseus, Supabase, timers, `Date.now()`, or `Math.random()`.

## Phase 4: Card Authoring Workflow

- [x] Document the path for adding data-only cards through the card catalog.
- [x] Document the path for adding a new effect mechanic through cards validation, rules handlers, and tests.
- [x] Expand validation when new effect fields or effect types are introduced.
- [x] Add focused rules tests for each new mechanic before relying on it in future cards.

Done in [Card Authoring Workflow](./card-authoring-workflow.md), `packages/cards/src/validation.ts`, and focused rules tests.

## Phase 5: Larger Feature Readiness

- [x] Prepare stable extension points for new modes, cosmetics, shop items, collection flows, and battle UX.
- [x] Add web smoke coverage for common flows after the web modules settle.
- [x] Improve rules coverage around effect combinations and regression-prone interactions.
- [x] Keep web and server layers as adapters: no gameplay rules outside `packages/rules`.

Done in [Feature Extension Points](./feature-extension-points.md), `e2e/checklist.spec.mjs`, `e2e/phase5-ui.spec.mjs`, and `packages/rules/src/parity-mechanics.test.ts`.
