---
name: buff-stats-render-green
description: Buffed minion stats must render green; raise attack only, keep baseAttack
metadata:
  type: feedback
---

When a card effect buffs a minion, the increase must show as green text (綠字) so players feel the boost. The web client colors a stat green via `stat-higher` (see `valueDeltaClass` in apps/web/src/runtime.ts, CSS `.stat-higher` #55ff6a in styles/layout.css). Important: the comparison base differs by surface — board minions (`renderMinion`) color attack by `attack > baseAttack` but HEALTH by `currentHealth > catalogCard.health` (NOT a baseHealth field); hand cards (`renderCardFace`/`resolveHandCard`) use catalog `baseAttack`/`baseHealth`.

**Why:** Training-scene buff code originally raised BOTH `attack` and `baseAttack` equally, so `attack === baseAttack` and the buff rendered neutral (no green) — players couldn't see the boost.

**How to apply:** For an attack buff, raise `attack` only and leave `baseAttack` at the original base; for health, raise `currentHealth` above the catalog health. Applied to Lesson 3 (吳敦義 battlecry) and Lesson 4 (京華城 aura on 蔡想想 → green 2/2, bounced 韓國瑜 board → pass `baseAttack: 2` to makeMinion so the 4 attack is green). Lesson 5 (amplification, ~line 849) STILL raises baseAttack — fix the same way if green buffs are wanted there.

**Focus-zoom overlay:** the card-play overlay (`playNextCardPlayCue`) renders catalog base by default, so a buffed bounced card showed a neutral 2/2 in the play zoom. Fix: a CARD_PLAYED event can now carry `attack`/`health` in its payload → `eventToCue` copies them to `AnimationCue.playAttack/playHealth` → the overlay overrides the resolved stats (base stays catalog ⇒ green). Lesson 4's 韓國瑜 replay uses this. Non-training plays omit the fields and fall back to catalog unchanged.
