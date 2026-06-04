---
name: twcardgame-v2-web-animation
description: Use when adding, debugging, or tuning battle animations in apps/web (attack lunges, effect strikes / flying knives, damage numbers, death shatter, deathrattle, bounce, summon, AOE sweeps) — covers the event→cue model, the publicSync hold/flush timing, the morph-render animation-delay reset gotcha, and how to anchor effects to units that are mid-summon or already dead.
---

# TWCARDGAME v2 Web Animation

Battle visuals in `apps/web/src/runtime.ts` are driven entirely by `GameEvent`s
the server emits alongside state. The web client is not authoritative: it renders
synced state and *animates the events that explain the transition*. Getting the
animation right is mostly about **timing** (when the board state is allowed to
become visible) and **anchoring** (finding the DOM node an effect should attach
to, even when that node is appearing or disappearing this same frame).

## The pipeline

```
server → publicSync (counts-only board) + events[] (DAMAGE, ATTACK, MINION_SUMMONED, DESTROY, …)
       → enqueueEventCues(events)  builds AnimationCue[]  (kind, targetKey, sourceKey, delayMs, readyAtMs, seq)
       → render() patches DOM via patchHtml; cue overlays render from view.animationCues
       → applyPostRenderEffects() runs the imperative animations + anchors declarative ones
```

A cue carries a **kind** (`attackerMoves`, `damage`, `effectStrike`, `heal`,
`buff`, `bounce`, `destroy`, `deathrattle`, `shieldPop`, `lock`, `aoeSweep`,
`summon`, `play`, `reject`), a `targetKey` (the victim's `data-target-key` =
instanceId), an optional `sourceKey` (the caster), a `delayMs`, and a derived
`readyAtMs`. `cueIsReady(cue)` gates when an effect may fire.

## Two ways to animate — and when to use each

There are **two** mechanisms in the file. Picking the wrong one is the most
common animation bug.

1. **Declarative cue overlay** — the cue renders an element (e.g.
   `.effect-strike`, `.float-number`) inside `.event-layer` via the render
   template, and CSS keyframes (`animation-delay: var(--cue-delay)`) play it.
   `applyPostRenderEffects` only *positions* it (`data-anchor-key` → look up the
   live target, set `left/top`, mark `data-anchored="true"`).

2. **Imperative one-shot** — `applyPostRenderEffects` calls a function that fires
   **once**, guarded by an `applied*` Set, builds a `position: fixed` element on
   `document.body`, animates it, and removes it on a timer. Examples:
   `startAttackLunge` (`appliedLunges`), `applyDeathShatter`
   (`appliedDeathShatters`), `applyDeathrattlePlume` (`appliedDeathrattles`),
   `applyKnifeStrike` (`appliedKnives`).

**Rule of thumb: if an animation must travel, persist across board re-renders, or
has a non-trivial `delayMs`, animate it imperatively.** Declarative overlays are
fine for short, in-place flashes/numbers that don't need to survive churn.

### Why: the morph-render animation-delay reset (load-bearing gotcha)

`render()` patches the DOM with `patchHtml` (a morph), not a full innerHTML
replace, and it re-runs on every state/cue change — which during a battlecry can
be ~once per ~700ms while `publicSync` is held. Morph touches the cue nodes each
pass (it strips the imperatively-added `data-anchored`, so the anchor loop
re-runs every frame). For a **declarative** animation this effectively **resets
the CSS `animation-delay` countdown each render**. When `--cue-delay` is large
(see below) and bigger than the gap between renders, the keyframes never finish —
the animation silently never plays. The symptom is "the effect works sometimes
and not others," correlated with how the player timed their input, not with game
logic.

A body-level imperative element is never in the render tree, so morph cannot
reset it. That is why the flying knife had to move from declarative to imperative
(see case study).

## publicSync hold / flush — board state is deferred behind motion

`publicSync` is **stashed**, not applied immediately, so an attack or effect can
play before the board "snaps" to the post-action counts:

- `applyPublicSync` stashes into `pendingPublicSync` and schedules a flush after
  `PUBLIC_SYNC_EVENT_GRACE_MS` (a short grace window so the paired `events`
  message — which can arrive *after* `publicSync` — gets to enqueue cues first).
- `holdPendingPublicSyncFor(ms)` pushes the flush deadline out (it takes the
  max). `enqueueEventCues` → `applyPostPlayEffectDelays` / `applyPostAttackEffectDelays`
  hold sync for the effect/lunge duration plus a per-kind sync lag
  (`POST_PLAY_STATE_SYNC_LAG_MS`, `DESTROY_EFFECT_SYNC_LAG_MS`,
  `BOUNCE_EFFECT_SYNC_LAG_MS`, `ATTACK_LUNGE_MS + POST_ATTACK_STATE_SYNC_LAG_MS`).
- `flushPendingPublicSync` refuses to apply while `attackAnimationBusy()` (a
  lunge is in flight) or `cardPlayPreviewBusy()`, or while the hold deadline is
  in the future (it reschedules itself).

Consequences you must design around:

- The **summoned caster's real minion does not exist on the board until the
  flush.** Until then the locally-played minion is a `.battlecry-preview`
  (which carries **no `data-target-key`**), and a killed target is still on the
  board until the kill flush removes it.
- A **lethal** effect holds sync ~1s+ (destroy visual), so the caster's real
  minion appears *long after* its effect cue fired. A **non-lethal** effect
  flushes fast, so the caster syncs in almost immediately. This asymmetry is why
  "kills look broken but non-kills look fine" — the difference is flush timing,
  not the effect.

## Anchoring effects to units that are appearing or gone

When resolving the **target** or **source** DOM rect for an effect, the live
`[data-target-key="…"]` lookup can legitimately miss. Use these fallbacks:

- **Source = the caster.** Try the real minion `[data-target-key=sourceKey]`
  first, then fall back to `.battlecry-preview` (the in-flight local caster that
  has no target-key while sync is held). `findEffectSourceKey` derives a battlecry
  cue's `sourceKey` by walking back to the `CARD_PLAYED` and its `MINION_SUMMONED`;
  an `ATTACK` boundary or a spell yields no source (no knife).
- **Target that just died.** `applyDeathShatter` records the dying unit's rect in
  `recentUnitRects` (instanceId → {rect, atMs}). If the live lookup misses and a
  fresh (`< 2000ms`) entry exists, anchor to that captured rect so the effect
  still lands on the spot instead of being orphaned. `applyDeathrattlePlume` and
  `applyKnifeStrike` both do this.
- If neither resolves yet, **return without consuming the cue** (don't add it to
  the `applied*` Set) so a later render retries once the unit appears. This is
  naturally bounded: the cue leaves `view.animationCues` at its lifetime, so the
  retry loop stops.

Do **not** leave a stuck element showing a wrong/default state (e.g. a static
sprite at the impact point because its fly vector defaulted to 0). Either resolve
it or hide/skip it.

## Timing constants are coupled to CSS keyframes

Keep JS timing and CSS keyframes in sync (this predates and motivates the rules
in CLAUDE.md → "Web animation lessons"):

- Attack contact is at ~70% of `ATTACK_LUNGE_MS`; schedule damage numbers and
  attack SFX at that derived impact delay, and delay `destroy` cues + board
  removal until the lunge returns to origin.
- For a travelling sprite, the fly duration in CSS (e.g. `attack-sprite-fly`) and
  the imperative removal timeout must agree (sprite removed *after* the fly ends).
- `--cue-delay` is written into the element's inline style by `cueStyleAttr` from
  `cue.delayMs` (a fixed value), so for declarative overlays it is stable per
  render — but see the morph reset gotcha above for why a large one still breaks.

## Case study: the battlecry flying knife (謝長廷 / `effectStrike`)

Symptom: the knife flew for some targets/timings and not others — first blamed on
the target's party, then on the target dying, finally pinned to **how fast the
player clicked the target**.

Root cause chain (each fix exposed the next layer — instrument first, per the
debugging note below):

1. Source not found → fly vector defaulted to `(0,0)` → a static horizontal blade
   sat at the impact point. The caster was a `.battlecry-preview` with no
   target-key. Fix: source fallback to `.battlecry-preview`.
2. Killed target removed at flush → effect orphaned and vanished. Fix: target
   fallback to `recentUnitRects`.
3. The real bug: a **large `delayMs`** (fast play → effect waits for the landing
   animation to settle) meant the declarative sprite's `animation-delay` was
   reset by morph re-renders before it could fire. Fix: animate the knife
   **imperatively** (`applyKnifeStrike` + `appliedKnives`, body-level sprite),
   firing once at `cueIsReady`. The declarative sprite was removed from
   `renderEffectStrike`; the impact burst (`.effect-strike-core`) stays.

Design outcome: the knife only exists during flight, fades out as it reaches the
target (no static blade at impact — the hit reads as the magenta burst), and is
immune to render churn regardless of click speed or whether the target dies.

## Debugging animation bugs

Per CLAUDE.md, for lethal / mutual-destruction / "sometimes works" animation
bugs, **instrument before changing logic**:

- `blog(...)` (gated by `BATTLECRY_LOG`) prints to the browser console. Log around
  cue enqueue, DOM target/source lookup (and *what is present* when it misses —
  dump candidate `data-target-key` / `data-dom-key`), lunge start/abort/success,
  and publicSync hold/flush/apply.
- Reproduce with the player's exact timing — input speed changes which
  transitional window the effect anchors in. "Slow click vs fast click" and
  "lethal vs non-lethal" are the two axes that flip these bugs.
- Read the timeline: compare the cue's `delayMs`/`readyAtMs`, the render
  timestamps, and when the flush brings the real minion onto the board.
- Remove the instrumentation once the root cause is confirmed and fixed.

## Validation

Animation lives only in `apps/web`, so the rules/cards suites won't cover it:

```bash
npx tsc -b apps/web        # typecheck
npm run build -w @twcardgame/web   # bundle (after web changes)
```

Then verify visually in `npm run dev:web` across the timing axes above (fast/slow
input, lethal/non-lethal target, caster on either board side).
