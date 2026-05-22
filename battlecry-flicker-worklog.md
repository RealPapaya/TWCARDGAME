# Battlecry Flicker Worklog

## Problem

指定戰吼目標後，戰吼卡牌在效果結算瞬間會短暫消失，下一瞬間才重新出現在場上。

使用者提供截圖顯示流程：

1. 戰吼預覽牌在場上。
2. 點下戰吼目標後，場上該位置短暫空白。
3. 真實結算後的卡牌再出現。

## Attempts

- 調整戰吼 preview 與真實 minion 的 DOM key 接手邏輯。
- 記錄戰吼下場前的 board instance ids，嘗試辨識伺服器同步後的新 minion。
- 避免合法目標 click 時提前 `endBattlecryTargeting()`。
- 將 `commitBattlecry()` 改為先切 `committed`、先 render，再送 `playCard` command。
- 增加 `acceptedBattlecry` 狀態，避免 pending 被清掉後 preview 立刻消失。
- 增加 commit 瞬間的固定位置 clone 作為視覺保險。

## Verification

已執行並通過：

- `npm run check`
- `npm test`
- `node e2e/render-stability.spec.mjs`

## Current Status

問題仍未解決。使用者確認修正後仍會在戰吼使用瞬間消失。

後續建議：需要用可穩定重現的指定戰吼場景，逐幀記錄 `player-board` DOM、`pendingBattlecry`、`acceptedBattlecry`、`publicSync` 和 hand sync 的實際順序，再重新定位空白幀來源。
