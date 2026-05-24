# Battlecry Flicker Worklog

## Problem

After selecting a battlecry target, the battlecry card 
briefly disappears from the board at the moment the 
effect resolves, then reappears in the next frame.

User-provided screenshots show the sequence:

1. Battlecry preview card is visible on the board.
2. Immediately after clicking the battlecry target, 
   the board slot goes blank.
3. The real settled card appears after server resolution.

## Attempts

- Adjusted DOM key handoff logic between battlecry 
  preview and real minion.
- Recorded pre-battlecry board instance IDs to 
  identify the new minion after server sync.
- Prevented premature `endBattlecryTargeting()` on 
  valid target click.
- Changed `commitBattlecry()` to set `committed` and 
  render first, then send the `playCard` command.
- Added `acceptedBattlecry` state to prevent preview 
  from disappearing when pending state is cleared.
- Added a fixed-position DOM clone at commit moment 
  as a visual fallback.

## Verification

Passed:

- `npm run check`
- `npm test`
- `node e2e/render-stability.spec.mjs`

## Current Status

Problem is not yet resolved. User confirmed the card 
still disappears at the moment of battlecry execution 
after all attempted fixes.


Goal is to pinpoint the exact frame where the blank 
appears before attempting another fix.