---
name: twcardgame-training-mode
description: TWCARDGAME v2 training-mode UX and implementation guidance. Use when modifying the Social Rookie training level, tutorial step sequencing, highlighted targets, mana/card-cost crystal cues, hero/minion/unit onboarding, or training tests in apps/web/src/app/training.ts, runtime.ts, or battle-arena.css.
---

# TWCARDGAME Training Mode

Use this skill when changing the first training level or any reusable training UX pattern in TWCARDGAME v2.

## Core Rules

- Preserve highlighted element positions. A training highlight must draw attention to the existing UI element in place; it must not move, resize, or reflow the target.
- Do not add a generic positioning rule to `.training-highlight` if the target already depends on its own positioning. In particular, `.card-cost` must remain `position: absolute` so the cost crystal stays in the card's top-left corner.
- Prefer attention effects that live in outline, box-shadow, pseudo-elements, or drop-shadows. Use animated light points or rings to guide the eye.
- For mana teaching, highlight the mana container and active crystals without changing the crystal DOM order, flex layout, transform, or frame position.
- For small stat/cost badges, use tighter highlight insets so the glow does not cover card names or neighboring text.
- Avoid duplicate highlight layers on nested elements. For end turn, highlight the wrapper and leave the button itself structurally unchanged unless a direct button style is required.

## Social Rookie Flow

Keep the first training level understandable for new players. The expected early sequence is:

1. Welcome to training.
2. Draw first card.
3. Explain mana crystals and card cost.
4. Ask the player to play the rookie minion.
5. Introduce: "這是隨從" and highlight the summoned minion.
6. Introduce: "這是英雄" and highlight both heroes.
7. Explain units: heroes and minions are both units.
8. Explain attack and health stats.
9. Explain end turn.
10. Continue through attack, victory condition, and final strike.

When adding steps, update:

- `TrainingStepId`
- `trainingPrompt`
- `advanceTraining`
- command handlers if the new step changes allowed actions
- `apps/web/src/app/training.test.ts`

## Highlight Implementation Checklist

- Inspect the target's existing CSS before applying `.training-highlight`.
- If the target is absolutely positioned, preserve that positioning with a more specific rule such as `.card-cost.training-highlight { position: absolute; }`.
- If pseudo-elements are added to `.training-highlight`, confirm the target can safely host them. For clipped or unusually shaped elements, apply the effect to a wrapper.
- Keep pointer events disabled on decorative pseudo-elements.
- Confirm text remains readable and unobstructed on card names, hero HP, minion stats, and buttons.

## Validation

Run these after training-mode changes:

```powershell
npm test
npm run build
```

If visual behavior changed, start the web app and manually inspect the Social Rookie training flow, especially the mana/cost step and the "這是隨從" / "這是英雄" steps.
