---
name: twcardgame-legacy-parity
description: Use when changing TWCARDGAME v2 behavior, cards, effects, battle flow, deck rules, audio, visual presentation, or UIUX that may need to match the preserved LEGACY v1 app. Trigger this skill for migration work from LEGACY, parity checks against old mechanics, preserving player-facing flows, comparing card rendering or assets, and deciding whether a v2 difference is intentional or a regression.
---

# TWCARDGAME Legacy Parity

## Overview

Preserve the parts of the v1 game that players can feel: mechanics, card behavior, interaction flow, visual language, audio cues, and UI rhythm. Use `LEGACY/` as a reference, not as architecture to copy back into v2.

## Core Rule

Prefer legacy parity for player-facing behavior unless the user, roadmap, or v2 architecture explicitly calls for a different design.

Do not copy legacy implementation style into v2:

- Keep deterministic gameplay in `packages/rules`.
- Keep cards and effect schemas in `packages/cards`.
- Keep rendering and input in `apps/web`.
- Keep Colyseus transport and room sync in `apps/server`.
- Treat `LEGACY/` as evidence for behavior, assets, timing, naming, and UIUX.

## First Move

Before editing, identify the legacy source of truth for the requested surface:

- Battle mechanics: `LEGACY/js/engine/game_engine.js`
- Card data and legacy effect names: `LEGACY/js/data/card_data.js`
- Default decks: `LEGACY/js/data/default_decks.js`
- Card rendering: `LEGACY/js/ui/card_renderer.js`
- Main view flow and screen structure: `LEGACY/index.html`, `LEGACY/js/ui/app.js`
- PvP flow and reconnect behavior: `LEGACY/js/pvp/pvp_manager.js`
- Audio cues: `LEGACY/js/audio/audio_manager.js`, `LEGACY/assets/audio/`
- Shop, packs, and collection: `LEGACY/js/shop/`, `LEGACY/css/shop.css`, `LEGACY/css/collection.css`
- Profile, auth, leaderboard, tutorial: matching files under `LEGACY/js/` and `LEGACY/css/`
- Visual assets: `LEGACY/assets/images/`
- Legacy verification scripts: `LEGACY/tests/verify_mechanics.js`, `LEGACY/tests/verify_mechanics_browser.js`

Use `rg` to find names, ids, effect strings, button labels, CSS classes, and asset filenames before assuming a behavior has no legacy equivalent.

## Parity Workflow

1. Find the closest legacy behavior.
   Search by card id, card name, effect type, UI label, asset name, view id, or function name. For UI work, inspect both HTML structure and CSS because much of the legacy feel comes from layout, frames, fonts, and hover states.

2. Extract the player-facing contract.
   Write down what a player observes: allowed action, cost, target rules, result order, animation or sound cue, visible copy, modal flow, disabled states, error feedback, and timing.

3. Map the contract to v2 boundaries.
   Put outcomes and legality in `packages/rules`, data shape in `packages/cards` or `packages/shared`, transport in `apps/server`, and presentation in `apps/web`.

4. Preserve assets and naming where practical.
   Reuse existing card art, backs, mana crystals, frames, backgrounds, audio cues, and Chinese display text unless the change intentionally replaces them.

5. Mark intentional differences.
   If v2 should differ from v1, make that explicit in code comments only when useful, tests, docs, or the final response. Do not let silent differences masquerade as parity.

6. Validate with tests or a manual UI check.
   For mechanics, add or update rules/card tests. For UIUX, run the web client and inspect the flow in a browser when feasible.

## Mechanics Checklist

When changing gameplay, compare these legacy details:

- Starting hero health, starting hand, mulligan, deck size, fatigue, turn start, mana growth, draw order, and win/loss conditions.
- Card play legality: mana, board space, target requirements, class/category restrictions, and hand/deck movement.
- Combat legality: summoning sickness, charge, taunt, hero targeting, minion targeting, death timing, and attack exhaustion.
- Effect resolution: battlecry order, random target selection, simultaneous damage, healing caps, destroy, bounce, draw, buff, category filters, and self-damage.
- Failure behavior: what happens when a target is missing, board is full, deck is empty, or a card cannot fully resolve.

In v2, reproduce the observable result deterministically. Use seeded RNG and events in `packages/rules`; never use legacy browser globals or random behavior directly.

## UIUX Checklist

When changing the web client, compare these legacy details:

- Screen order: auth, profile, menu, mode selection, deck selection, battle, shop, collection, tutorial, settings, modals.
- Battle layout: opponent area above, player area below, boards, hand, heroes, deck pile, mana display, end-turn/surrender/settings controls.
- Card presentation: art crop, frame, cost/attack/health placement, rarity or category treatment, keyword/description text, hover/selection states.
- Feedback: disabled controls, selection highlight, target prompt, damage/heal/buff feedback, modal confirmation, reconnect/disconnect state.
- Visual language: existing backgrounds, wood/frame motifs, card backs, mana crystals, Chinese typography, button styling, cursor, and transition media.
- Audio language: draw, hit, heavy hit, summon cost, death, retreat, click, and background music cues.

Do not add explanatory in-app text about how the UI works unless the legacy flow already used it or the user asks for a redesign. Preserve the game-like interface first.

## Useful Commands

Search legacy behavior:

```bash
rg -n "CARD_ID_OR_EFFECT_OR_LABEL" LEGACY
```

Compare likely implementation targets:

```bash
rg -n "effect|battlecry|target|mulligan|mana|attack|damage|draw" packages apps
```

Run validation after mechanics/card changes:

```bash
npm run validate:cards
npm test
npm run check
```

Run the build after web or server changes:

```bash
npm run build
```

## Completion Standard

Before calling the task done, state the parity decision in concise terms:

- `Matched legacy`: name the legacy files or behavior used as reference.
- `Intentional v2 difference`: explain why it differs and where the new rule lives.
- `Not checked`: only acceptable when legacy behavior is absent, broken, or impossible to run; say what was searched.
