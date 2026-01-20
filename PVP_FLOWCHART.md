# PVP 對戰流程圖 - 完整詳細版

## 配對階段

```mermaid
flowchart TB
    subgraph MATCH["配對階段"]
        M1[M1: 玩家A點擊玩家對戰] --> M2[M2: 顯示配對Modal]
        M2 --> M3[M3: 設定 onMatchFound 回調]
        M3 --> M4[M4: 呼叫 joinMatchmaking]
        M4 --> M5[M5: 檢查是否已在佇列]
        M5 -->|已在佇列| M6[M6: 返回已在佇列]
        M5 -->|未在佇列| M7[M7: 寫入 matchmaking_queue/userId]
        M7 --> M8[M8: 設定 onDisconnect 自動移除]
        M8 --> M9[M9: 呼叫 _startMatchmakingListener]
        M9 --> M10[M10: 呼叫 tryMatchWithPlayer]
        M10 --> M11{M11: 有其他等待玩家?}
        M11 -->|否| M12[M12: 等待被配對]
        M11 -->|是| M13[M13: 呼叫 _createGameRoom]
        M13 --> M14[M14: 建立 game_rooms/roomId]
        M14 --> M15[M15: 更新雙方 status=matched]
        M15 --> M16[M16: _startMatchmakingListener 觸發]
        M16 --> M17[M17: await _joinGameRoom]
        M17 --> M17a[M17a: 等待 onValue 回傳房間資料]
        M17a --> M18[M18: 設定 currentRoom]
        M18 --> M19[M19: 觸發 onMatchFound 回調]
        M19 --> M20[M20: 呼叫 startPvPGame]
    end
```

## 遊戲初始化階段

```mermaid
flowchart TB
    subgraph INIT["遊戲初始化 startPvPGame"]
        I1[I1: 設定 isPvPMode=true] --> I2[I2: 取得 roomData]
        I2 --> I3{I3: roomData 存在?}
        I3 -->|否| I4[I4: 顯示找不到房間]
        I3 -->|是| I5[I5: 建立隨機對手牌組暫用]
        I5 --> I6[I6: 根據 playerId 決定先後手]
        I6 --> I7[I7: gameEngine.createGame]
        I7 --> I8["I8: 玩家A初始 mana=1, 手牌=3張"]
        I8 --> I9["I9: 玩家B初始 mana=1, 手牌=3張"]
        I9 --> I10[I10: showView battle-view]
        I10 --> I11[I11: 設定 pvpManager 回調]
        I11 --> I12[I12: pvpManager.listenActionLog]
        I12 --> I13[I13: showMulliganPhase]
    end
```

## Mulligan 換牌階段

```mermaid
flowchart TB
    subgraph MULL["Mulligan 換牌"]
        MU1[MU1: 顯示 Mulligan Modal] --> MU2[MU2: 玩家選擇要換的牌]
        MU2 --> MU3[MU3: 點擊確認按鈕]
        MU3 --> MU4[MU4: gameState.performMulligan]
        MU4 --> MU4a[MU4a: 隱藏 Modal]
        MU4a --> MU4b[MU4b: 本地發牌動畫]
        MU4b --> MU4c[MU4c: 顯示等待對手]
        MU4c --> MU5[MU5: syncMulliganStatus true]
        MU5 --> MU6[MU6: syncGameAction MULLIGAN_DONE]
        MU6 --> MU8[MU8: listenMulliganStatus]
        MU8 --> MU9{MU9: 雙方都完成?}
        MU9 -->|否| MU10[MU10: 等待對手]
        MU9 -->|是| MU11[MU11: 開始回合判斷]
        MU11 --> MU12{MU12: isMyTurn?}
        MU12 -->|是-先手| MU13[MU13: gameState.startTurn]
        MU13 --> MU14["MU14: 先手 mana 1->2, 抽1牌 = 4張"]
        MU12 -->|否-後手| MU15[MU15: 等待對手行動]
        MU15 --> MU16["MU16: 後手 mana=1, 手牌=3張"]
    end
```

## 遊戲回合循環

```mermaid
flowchart TB
    subgraph TURN["回合循環"]
        T1{T1: 輪到誰?} -->|我的回合| T2[T2: 可以操作]
        T1 -->|對手回合| T3[T3: 等待對手動作]
        
        T2 --> T4[T4: 出牌/攻擊/結束回合]
        T4 --> T5{T5: 動作類型?}
        
        T5 -->|出牌| P1[P1: 檢查 mana 足夠]
        P1 --> P2[P2: gameState.playCard]
        P2 --> P3["P3: 扣除 mana"]
        P3 --> P4[P4: syncGameAction PLAY_CARD]
        P4 --> P5[P5: syncLocalStateToFirebase]
        P5 --> P6[P6: render 更新畫面]
        
        T5 -->|攻擊| A1[A1: 選擇攻擊目標]
        A1 --> A2[A2: animateAttack 動畫]
        A2 --> A3[A3: gameState.attack]
        A3 --> A4[A4: syncGameAction ATTACK]
        A4 --> A5[A5: syncLocalStateToFirebase]
        A5 --> A6[A6: resolveDeaths]
        
        T5 -->|結束回合| E1[E1: syncGameAction END_TURN]
        E1 --> E2[E2: pvpManager.endTurn]
        E2 --> E3[E3: gameState.endTurn true]
        E3 --> E4[E4: syncLocalStateToFirebase]
        E4 --> E5["E5: 清除隨從 canAttack"]
        E5 --> E6[E6: Firebase 更新 currentTurn]
        
        T3 --> R1[R1: listenActionLog 收到動作]
        R1 --> R2[R2: handleOpponentPvPAction]
        R2 --> R3[R3: executeOpponentAction]
        R3 --> R4{R4: 動作類型?}
        R4 -->|PLAY_CARD| R5[R5: 播放對手出牌動畫]
        R4 -->|ATTACK| R6[R6: 播放對手攻擊動畫]
        R4 -->|END_TURN| R7[R7: 輪到我的回合]
        R7 --> R8["R8: 我方 +1 maxMana, 補滿 mana"]
        R8 --> R9[R9: 我方抽1牌]
    end
```

## Firebase 資料結構

```
matchmaking_queue/
  └── {userId}/
      ├── userId: string
      ├── username: string
      ├── level: number
      ├── deckCards: string[]
      ├── status: "waiting" | "matched"
      ├── roomId: string (配對成功後)
      └── playerId: "player1" | "player2"

game_rooms/
  └── {roomId}/
      ├── status: "initializing" | "playing" | "finished"
      ├── players/
      │   ├── player1/
      │   │   ├── userId: string
      │   │   ├── connected: boolean
      │   │   └── lastPing: number
      │   └── player2/
      │       └── ...
      ├── gameState/
      │   ├── currentTurn: "player1" | "player2"
      │   ├── turnNumber: number
      │   ├── mulliganStatus/
      │   │   ├── player1: boolean
      │   │   └── player2: boolean
      │   ├── player1State/
      │   │   ├── hp: 30
      │   │   ├── mana: 1
      │   │   └── maxMana: 1
      │   └── player2State/
      │       └── ...
      └── actionLog/
          └── {actionId}/
              ├── action: "PLAY_CARD" | "ATTACK" | "END_TURN"
              ├── player: "player1" | "player2"
              ├── data: object
              └── timestamp: number
```
