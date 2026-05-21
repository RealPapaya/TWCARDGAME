# Modular Refactor Roadmap

This roadmap follows the Phase 1 web-first extraction. The long-term goal is to keep card additions, new game features, and UI growth maintainable without moving gameplay rules into the web or server layers.

## Phase 2: Web State And Service Cleanup

- Introduce a small app context or store only after the Phase 1 extraction is stable.
- Reduce direct cross-module imports by grouping state reads, state writes, and render scheduling behind narrow helpers.
- Document ownership for screens, services, battle helpers, shared UI helpers, and app bootstrap code.
- Keep all gameplay mutations flowing through server commands and the rules engine.

## Phase 3: Rules Effect Modularization

- Split `packages/rules/src/effects.ts` into mechanic-focused effect modules.
- Keep a single effect registry entrypoint so card definitions remain data-driven.
- Group handlers by mechanic family such as damage, healing, draw, summon, destroy, bounce, buffs, keywords, and turn lifecycle.
- Preserve deterministic rules constraints: no DOM, Colyseus, Supabase, timers, `Date.now()`, or `Math.random()`.

## Phase 4: Card Authoring Workflow

- Document the path for adding data-only cards through the card catalog.
- Document the path for adding a new effect mechanic through cards validation, rules handlers, and tests.
- Expand validation when new effect fields or effect types are introduced.
- Add focused rules tests for each new mechanic before relying on it in future cards.

## Phase 5: Larger Feature Readiness

- Prepare stable extension points for new modes, cosmetics, shop items, collection flows, and battle UX.
- Add web smoke coverage for common flows after the web modules settle.
- Improve rules coverage around effect combinations and regression-prone interactions.
- Keep web and server layers as adapters: no gameplay rules outside `packages/rules`.
