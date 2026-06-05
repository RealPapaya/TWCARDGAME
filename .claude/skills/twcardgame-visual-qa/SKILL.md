---
name: twcardgame-visual-qa
description: Run focused Playwright visual QA for TWCARDGAME UI and battle effects. Use when the user asks to verify that an interaction, animation, visual effect, cue timing, screenshot state, or "must be visible on screen" behavior actually appears in the browser, especially when DOM existence alone is not enough.
---

# TWCARDGAME Visual QA

Use this skill when a TWCARDGAME UI/FX change must be verified visually, not just by build output or DOM existence.

## Core Workflow

1. Start the server on `http://localhost:2567` if not already listening.
2. Start the web app from `apps/web`, not from repo root:
   `npm run dev -- --port 5174 --strictPort`
3. Open Dev Test at:
   `http://localhost:5174/?auth=dev&devTest=1`
4. Use Playwright to create a deterministic PvE match, perform the actual user interaction, then wait for the visual cue to become visible before taking the screenshot.
5. Report success only when both are true:
   - DOM state confirms the expected cue exists.
   - Screenshot or computed visibility confirms it is actually visible.

## Visibility Rules

- Treat "node exists" as insufficient for transient effects. Check opacity, bounding box, CSS animation state, or screenshot pixels.
- Wait for cue readiness, not only selector attachment. Many cues are inserted before `delayMs` has elapsed.
- Screenshot immediately after visibility is confirmed; short-lived cues disappear quickly.
- Prefer deterministic Dev Test setup over manual play, but perform the same interaction the user cares about.

## Local Test Pitfalls

- Root `npm run dev:web -- --port 5174 --strictPort` can be parsed incorrectly and serve a blank/404 page. Prefer running `npm run dev -- --port 5174 --strictPort` in `apps/web`.
- Dev Test PvE may show mulligan first. Click `#mulligan` before waiting for `[data-testid="hand-card"]`.
- Minion cards are played by dragging to `[data-testid="player-board"]`; double-click may not trigger play.
- Do not run Vite build and Playwright visual QA in parallel; HMR/build churn can interrupt hand sync.
- Do not run two visual QA scripts in parallel against the same local server; Dev Test rooms and active-match state can interfere.
- Clear `localStorage` and `sessionStorage` before opening Dev Test so active-match resume does not leave the test with `Hand 0` / "Waiting for private hand sync."

## Bundled Resources

- `scripts/ko-heal-visual.mjs`: executable example of a focused Playwright visual QA flow.
- `references/ko-heal.md`: load only when testing or revisiting the `TW011` Ko healing visual case.
