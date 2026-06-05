# Ko Heal Visual Reference

Use this reference only when testing or revisiting the `TW011` Ko healing visual behavior.

## Goal

When Ko (`TW011`) enters play, the healing effect must show green `+` particles. If Ko has other friendly minions, use the existing full-board heal effect. If Ko is the only friendly minion, it should still use the same full-board heal visual path, not a separate bespoke solo effect.

## Script

Run from the TWCARDGAME repo root after the server and web app are running:

```powershell
node C:\Users\Morris\.codex\skills\twcardgame-visual-qa\scripts\ko-heal-visual.mjs --board TW010,TW014 --screenshot .tmp-ko-heal-multi.png
node C:\Users\Morris\.codex\skills\twcardgame-visual-qa\scripts\ko-heal-visual.mjs --board solo --screenshot .tmp-ko-heal-solo.png
```

`--board TW010,TW014` verifies the multi-target board heal. `--board solo` verifies the one-Ko case.

## Selectors

- Full-board heal sweep: `.aoe-sweep-heal`
- Full-board green pluses: `.aoe-heal-plus`
- Per-target heal burst: `[data-testid="heal-burst"]`
- Heal number: `[data-testid="float-number"]`

For this case, prefer checking `.aoe-sweep-heal` and `.aoe-heal-plus`, because the intended solo behavior is to reuse the full-board heal visual.

## Lessons From Failed Runs

- A green frame or glow is not enough; the pass condition is a visible green `+`.
- A selector can exist while `opacity` is still `0`; wait for visible computed style or screenshot pixels.
- Starting Vite from the repo root with `npm run dev:web -- --port 5174 --strictPort` can produce a blank/404 page. Start from `apps/web` with `npm run dev -- --port 5174 --strictPort`.
- Dev Test active-match resume can leave the page at `Hand 0`; clear local/session storage before opening the test URL.
- Do not run visual QA scripts in parallel against the same local server. Rooms and active match state can interfere.
