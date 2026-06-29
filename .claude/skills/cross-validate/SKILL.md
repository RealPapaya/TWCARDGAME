---
name: cross-validate
description: Claude + Codex cross-validation workflow for complex work. Auto-invoke whenever the user says 交叉驗證 / 交叉審查 / 互相驗證 / 對齊 / 雙重審查 / 找 codex 看 / cross-validate / cross-check / cross-review / "have codex review", or otherwise asks for a second independent opinion on a plan or a diff. Drives the loop: Claude plans → Codex aligns → implement → Claude reviews → an independent fresh Codex reviews → reconcile.
---

# Cross-Validation (Claude ↔ Codex)

Use this when work is complex/risky enough to deserve a second, *independent* set of eyes — or whenever the user says any of the trigger words above. The core idea (from the ClaudeCode+Codex workflow): **align on direction before coding, and let an agent that did NOT write the code do the final review** — fresh context kills the "I wrote this, so it's fine" bias.

Codex CLI is installed locally: `codex.cmd` (v0.142+). Claude Code is the driver; Codex is the independent reviewer/executor invoked non-interactively.

## When To Run Which Phase

You don't always need all four phases. Match the phase to what the user asked:

- "交叉驗證一下這個計畫 / cross-check this plan" → **Phase 1 (Align)** only.
- "交叉驗證 / 找 codex review 這些改動" (after code exists) → **Phase 3 (Dual review)** only.
- "用交叉驗證的方式做這個功能" (build something complex) → run all phases.

If it's ambiguous, default to: align on plan first, then dual-review the result.

## Phase 1 — Align on the plan (before coding)

1. Claude writes a short plan: goal, the files/approach, risks, and the success check.
2. Get Codex's independent take on the plan (read-only, no edits):

```bash
codex.cmd exec --sandbox read-only -C "D:\Google AI\TWCARDGAME" "Review this implementation plan for the repo. Point out flaws, missing edge cases, simpler alternatives, and anything that will cause rework. Be blunt and specific; do not write code. PLAN:\n<paste the plan here>"
```

3. Reconcile: adopt the valid points, push back (in your own answer) on the ones you disagree with and say why. Only start coding once the direction is settled. Surface unresolved disagreements to the user rather than silently picking one.

> **Plan-handoff lesson (learned the hard way).** A long inline prose plan — especially one with Chinese text — can confuse Codex into thinking "no plan was included" and replying with generic guardrails instead of reviewing your plan. For Phase 1, prefer one of: (a) write the plan to a short `.md` file and tell Codex to read that path, or (b) keep the inline prompt tight and in English. **Codex reviews a concrete diff (Phase 3) far more reliably than a prose plan (Phase 1)** — so if Phase 1 alignment is noisy, don't over-invest; get the diff in front of it and lean on Phase 3.

## Phase 2 — Implement

Implement the agreed plan (Claude does it directly here — `codex exec` execution mode is optional and only worth it for large mechanical generation). Keep changes surgical and follow the project's coding-style skill.

## Phase 3 — Dual review (before declaring done / deploying)

1. **Claude reviews first** — read your own diff critically for correctness, leaks of private state, determinism violations (see CLAUDE.md invariants), and missing tests.
2. **Independent Codex review of the diff** — fresh context, did not write the code. The `review` subcommand does NOT accept `-C` or a custom prompt alongside `--uncommitted`, so `cd` into the repo first and run it bare:

```bash
cd "D:\Google AI\TWCARDGAME"; codex.cmd exec review --uncommitted
```

   To review against a base branch instead: `cd "D:\Google AI\TWCARDGAME"; codex.cmd exec review --base master`. To steer the review with a custom prompt, drop `--uncommitted` and pass the prompt as the positional arg (they are mutually exclusive): `codex.cmd exec review "Focus on determinism and state leaks in the working-tree changes."`

3. **Reconcile both reviews.** Classify every finding as: fix-now, won't-fix (with reason), or needs-user-decision. Fix the real ones, then re-run the failing reviewer if a finding was significant.

## Phase 4 — Gate

Only declare done once both reviewers are satisfied AND project validation passes:

```bash
npm run validate:cards && npm test && npm run check
```
(Add `npm run build` after server/web changes — see CLAUDE.md.)

## Reporting Back

Give the user a tight summary: what each side flagged, what you fixed, what you deliberately skipped (with reasons), and any open disagreement that needs their call. Don't bury a real Codex finding just because you disagree — name it and explain.

## Phase 5 — Test (optional, when asked to "let Codex test it")

Hand the running validation to an independent Codex `exec` (needs write sandbox to run npm). It runs the gate AND traces the change for holes you might have rationalized away:

```bash
cd "D:\Google AI\TWCARDGAME"; codex.cmd exec -s workspace-write "Run npm run check, npm test, npm run build and report pass/fail. Then trace <the changed code path> for <specific failure modes>. List each check PASS/FAIL with a one-line reason. Do not change code."
```

This caught a real P1 (a timeout firing a reconnect-token-discarding path before `view.session` was set) and a pre-existing splash-hang edge in this repo. When Codex flags a *pre-existing* issue your change didn't introduce, say so and don't scope-creep into fixing it unless asked.

## Token discipline (without sacrificing correctness)

Calling Codex from here does NOT reduce Claude's token use — Codex's stdout returns into Claude's context as a tool result, so a verbose run is pure *added* cost on the Anthropic side. (Codex's own reasoning runs on its separate budget/plan, so it doesn't decrement Claude — and on a ChatGPT-subscription login it may not visibly meter the user's account at all.) The savings lever is one-sided: **keep what comes back small, without making Codex think less.**

The rule: let Codex analyze **thoroughly in its own context**, but instruct it to **report tersely**. Coverage in, brevity out. Concretely, append to every Codex prompt something like:

> "Analyze thoroughly, but reply in under ~15 lines: list every real finding as `file:line — one-line reason`, no narration, no code blocks, no restating the diff. If nothing is wrong, say so in one line."

And always pipe to `… | tail -N`. Do **not** trade correctness for brevity — a missed bug costs several extra round-trips (each re-ingesting more output) far exceeding what terse output saves. So never tell Codex to *look at less* or skip files; only tell it to *write back less*. When in doubt, err toward Codex reporting a finding.

## Notes / Gotchas

Codex CLI quirks confirmed in THIS repo (v0.142, Windows) — save yourself the retries:

- **`exec review` rejects `-C`** and **`--uncommitted` is mutually exclusive with a custom prompt.** `cd` into the repo and run `codex.cmd exec review --uncommitted` bare. For plain `codex.cmd exec` (plan review / testing), `-C "<repo>"` *is* valid.
- **`-s/--sandbox` matters:** `read-only` for plan/idea reviews (can't touch files); `workspace-write` when Codex must run `npm`. `review` is read-only by nature.
- **On Windows, Codex runs npm via `npm.cmd`** because PowerShell blocks `npm.ps1` — it handles this itself, just don't be alarmed in the logs.
- **Output is large** (one review here was 560KB and got persisted to a tool-results file). Always pipe to `… | tail -N` and read the tail; the verdict is at the end.
- **CJK in prompts gets mangled** in Codex's echo and can derail it — prefer concise English prompts to Codex even when talking to the user in Chinese.
- Codex calls take a while; run with the Bash tool and a generous timeout, and wait. If one hangs on approvals, it's the wrong mode — `review` and `--sandbox read-only` don't prompt.
- This skill is provider-specific by design (Codex). It complements, not replaces, `/code-review`.
