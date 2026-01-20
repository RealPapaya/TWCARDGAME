/**
 * PvP 對戰管理器
 * 用途: 管理玩家對戰配對、遊戲房間、狀態同步
 */

import {
    database, ref, set, get, push, onValue, update, remove, onDisconnect, serverTimestamp, isFirebaseConfigured
} from './firebase_config.js';

class PvPManager {
    constructor() {
        this.currentRoom = null;
        this.currentRoomId = null;
        this.myPlayerId = null;  // 'player1' or 'player2'
        this.opponentId = null;
        this.roomListener = null;
        this.matchmakingListener = null;
        this.heartbeatInterval = null;
        this.processedActionIds = new Set(); // 追蹤已處理的動作

        // 回調函數
        this.onMatchFound = null;
        this.onGameStateUpdate = null;
        this.onOpponentAction = null;
        this.onGameEnd = null;
        this.onOpponentDisconnect = null;
        this.onOpponentReconnect = null;
        this.onBothPlayersReady = null; // 雙方都準備好時觸發
        this.onGameStart = null; // 遊戲正式開始時觸發
    }


    /**
     * 檢查 Firebase 是否已設定
     */
    isReady() {
        return isFirebaseConfigured();
    }

    /**
     * 加入配對佇列
     * @param {Object} playerData - 玩家資料
     */
    async joinMatchmaking(playerData) {
        if (!this.isReady()) {
            console.error('[PvP] Firebase 尚未設定');
            return { success: false, message: 'Firebase 尚未設定' };
        }

        const userId = playerData.username;
        const queueRef = ref(database, `matchmaking_queue/${userId}`);

        try {
            // 先檢查是否已在佇列中
            const existing = await get(queueRef);
            if (existing.exists()) {
                console.log('[PvP] 已在配對佇列中');
                return { success: true, message: '已在配對佇列中' };
            }

            await set(queueRef, {
                userId: userId,
                username: playerData.username,
                level: playerData.level || 1,
                deckId: playerData.deckId || 'default',
                deckCards: playerData.deckCards || [],
                timestamp: Date.now(),
                status: 'waiting'
            });

            // 設定斷線時自動移除
            onDisconnect(queueRef).remove();

            console.log('[PvP] 已加入配對佇列');

            // 開始監聯配對結果
            this._startMatchmakingListener(userId);

            // 嘗試與其他等待中的玩家配對
            const matchResult = await this.tryMatchWithPlayer(userId);
            if (matchResult) {
                console.log('[PvP] 自動配對成功！');
            }

            return { success: true, message: '已加入配對佇列' };
        } catch (error) {
            console.error('[PvP] 加入佇列失敗:', error);
            return { success: false, message: '加入佇列失敗' };
        }
    }

    /**
     * 離開配對佇列
     */
    async leaveMatchmaking(userId) {
        try {
            const queueRef = ref(database, `matchmaking_queue/${userId}`);
            await remove(queueRef);

            if (this.matchmakingListener) {
                this.matchmakingListener();
                this.matchmakingListener = null;
            }

            console.log('[PvP] 已離開配對佇列');
            return { success: true };
        } catch (error) {
            console.error('[PvP] 離開佇列失敗:', error);
            return { success: false };
        }
    }

    /**
     * 監聽配對結果
     */
    _startMatchmakingListener(userId) {
        const queueRef = ref(database, `matchmaking_queue/${userId}`);

        this.matchmakingListener = onValue(queueRef, (snapshot) => {
            if (!snapshot.exists()) return;

            const data = snapshot.val();
            if (data.status === 'matched' && data.roomId) {
                console.log('[PvP] 配對成功！房間:', data.roomId);

                // 清除監聽器
                if (this.matchmakingListener) {
                    this.matchmakingListener();
                    this.matchmakingListener = null;
                }

                // 加入遊戲房間
                this._joinGameRoom(data.roomId, data.playerId);

                // 觸發回調
                if (this.onMatchFound) {
                    this.onMatchFound(data.roomId, data.playerId);
                }
            }
        });
    }

    /**
     * 嘗試配對（客戶端輔助配對）
     * 注意：生產環境應使用 Cloud Functions
     */
    async tryMatchWithPlayer(myUserId) {
        const queueRef = ref(database, 'matchmaking_queue');
        const snapshot = await get(queueRef);

        if (!snapshot.exists()) return null;

        const queue = snapshot.val();
        const waitingPlayers = Object.entries(queue)
            .filter(([id, data]) => id !== myUserId && data.status === 'waiting')
            .sort((a, b) => a[1].timestamp - b[1].timestamp);

        if (waitingPlayers.length === 0) return null;

        // 找到第一個等待中的玩家
        const [opponentId, opponentData] = waitingPlayers[0];

        // 建立遊戲房間
        const roomId = await this._createGameRoom(myUserId, opponentId);

        return roomId;
    }

    /**
     * 建立遊戲房間
     */
    async _createGameRoom(player1Id, player2Id) {
        const roomsRef = ref(database, 'game_rooms');
        const newRoomRef = push(roomsRef);
        const roomId = newRoomRef.key;

        // 取得雙方配對資料（包含牌組）
        const p1Ref = ref(database, `matchmaking_queue/${player1Id}`);
        const p2Ref = ref(database, `matchmaking_queue/${player2Id}`);
        const [p1Snap, p2Snap] = await Promise.all([get(p1Ref), get(p2Ref)]);

        const p1Data = p1Snap.val() || {};
        const p2Data = p2Snap.val() || {};

        const roomData = {
            roomId: roomId,
            createdAt: Date.now(),
            status: 'initializing',
            seed: Math.floor(Math.random() * 2147483647),

            players: {
                player1: {
                    oderId: player1Id,
                    username: p1Data.username || player1Id,
                    connected: true,
                    lastPing: Date.now(),
                    ready: false
                },
                player2: {
                    oderId: player2Id,
                    username: p2Data.username || player2Id,
                    connected: true,
                    lastPing: Date.now(),
                    ready: false
                }
            },

            // 存儲雙方牌組
            deckData: {
                player1: p1Data.deckCards || [],
                player2: p2Data.deckCards || []
            },

            gameState: {
                currentTurn: 'player1',
                turnNumber: 1,
                turnStartTime: null,
                turnTimeLimit: 60000,

                player1State: {
                    hp: 30,
                    mana: 1,
                    maxMana: 1,
                    handCount: 0,
                    deckCount: 30,
                    board: []
                },
                player2State: {
                    hp: 30,
                    mana: 1,
                    maxMana: 1,
                    handCount: 0,
                    deckCount: 30,
                    board: []
                }
            },

            actionLog: {},
            lastActionId: null,
            result: null
        };

        await set(newRoomRef, roomData);

        // 更新雙方配對狀態
        await update(ref(database, `matchmaking_queue/${player1Id}`), {
            status: 'matched',
            roomId: roomId,
            playerId: 'player1'
        });

        await update(ref(database, `matchmaking_queue/${player2Id}`), {
            status: 'matched',
            roomId: roomId,
            playerId: 'player2'
        });

        console.log('[PvP] 房間已建立:', roomId);
        return roomId;
    }


    /**
     * 加入遊戲房間
     */
    async _joinGameRoom(roomId, playerId) {
        this.currentRoomId = roomId;
        this.myPlayerId = playerId;
        this.opponentId = playerId === 'player1' ? 'player2' : 'player1';
        this.processedActionIds.clear(); // 清空已處理動作

        const roomRef = ref(database, `game_rooms/${roomId}`);
        let previousStatus = null;
        let previousBothReady = false;

        // 開始監聽房間狀態
        this.roomListener = onValue(roomRef, (snapshot) => {
            if (!snapshot.exists()) {
                console.log('[PvP] 房間已不存在');
                return;
            }

            const room = snapshot.val();
            this.currentRoom = room;

            // 檢查對手連線狀態
            const opponentConnected = room.players[this.opponentId]?.connected;
            if (!opponentConnected && this.onOpponentDisconnect) {
                this.onOpponentDisconnect();
            }

            // 檢查雙方準備狀態
            const p1Ready = room.players?.player1?.ready;
            const p2Ready = room.players?.player2?.ready;
            const bothReady = p1Ready && p2Ready;

            if (bothReady && !previousBothReady && this.onBothPlayersReady) {
                console.log('[PvP] 雙方都準備好了');
                this.onBothPlayersReady();
            }
            previousBothReady = bothReady;

            // 檢查遊戲開始
            if (room.status === 'playing' && previousStatus === 'initializing' && this.onGameStart) {
                console.log('[PvP] 遊戲正式開始');
                this.onGameStart();
            }
            previousStatus = room.status;

            // 處理對手動作
            if (room.actionLog && typeof room.actionLog === 'object') {
                const actions = Object.entries(room.actionLog);
                for (const [actionId, action] of actions) {
                    // 只處理對手的動作，且尚未處理過的
                    if (action.player === this.opponentId && !this.processedActionIds.has(actionId)) {
                        this.processedActionIds.add(actionId);
                        console.log('[PvP] 收到對手動作:', action);
                        if (this.onOpponentAction) {
                            this.onOpponentAction(action);
                        }
                    }
                }
            }

            // 遊戲狀態更新
            if (this.onGameStateUpdate) {
                this.onGameStateUpdate(room.gameState, room);
            }

            // 遊戲結束
            if (room.status === 'finished' && room.result && this.onGameEnd) {
                this.onGameEnd(room.result);
            }
        });

        // 設定斷線處理
        const myPlayerRef = ref(database, `game_rooms/${roomId}/players/${playerId}`);
        onDisconnect(myPlayerRef).update({ connected: false });

        // 開始心跳
        this._startHeartbeat(roomId, playerId);

        console.log('[PvP] 已加入房間:', roomId, '身份:', playerId);
    }


    /**
     * 心跳檢測
     */
    _startHeartbeat(roomId, playerId) {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }

        this.heartbeatInterval = setInterval(async () => {
            try {
                const pingRef = ref(database, `game_rooms/${roomId}/players/${playerId}/lastPing`);
                await set(pingRef, Date.now());
            } catch (error) {
                console.error('[PvP] 心跳失敗:', error);
            }
        }, 10000);
    }

    /**
     * 提交遊戲動作
     */
    async submitAction(action) {
        if (!this.currentRoomId || !this.myPlayerId) {
            return { success: false, message: '未在遊戲中' };
        }

        // 檢查是否輪到自己
        if (this.currentRoom?.gameState?.currentTurn !== this.myPlayerId) {
            return { success: false, message: '還沒輪到你' };
        }

        const actionData = {
            turn: this.currentRoom.gameState.turnNumber,
            player: this.myPlayerId,
            action: action.type,
            data: action.data,
            timestamp: Date.now()
        };

        try {
            // 新增動作到日誌
            const logRef = ref(database, `game_rooms/${this.currentRoomId}/actionLog`);
            await push(logRef, actionData);

            console.log('[PvP] 動作已提交:', action.type);
            return { success: true };
        } catch (error) {
            console.error('[PvP] 提交動作失敗:', error);
            return { success: false, message: '提交失敗' };
        }
    }

    /**
     * 結束回合
     */
    async endTurn() {
        if (!this.currentRoomId || !this.myPlayerId) return;

        const nextTurn = this.myPlayerId === 'player1' ? 'player2' : 'player1';
        const newTurnNumber = (this.currentRoom.gameState.turnNumber || 1) + 1;

        try {
            await update(ref(database, `game_rooms/${this.currentRoomId}/gameState`), {
                currentTurn: nextTurn,
                turnNumber: newTurnNumber,
                turnStartTime: Date.now()
            });

            console.log('[PvP] 回合結束，換', nextTurn);
            return { success: true };
        } catch (error) {
            console.error('[PvP] 結束回合失敗:', error);
            return { success: false };
        }
    }

    /**
     * 投降
     */
    async surrender() {
        if (!this.currentRoomId) return;

        const winnerId = this.opponentId;

        try {
            await update(ref(database, `game_rooms/${this.currentRoomId}`), {
                status: 'finished',
                result: {
                    winner: winnerId,
                    reason: 'surrender',
                    endTime: Date.now()
                }
            });

            console.log('[PvP] 已投降');
            return { success: true };
        } catch (error) {
            console.error('[PvP] 投降失敗:', error);
            return { success: false };
        }
    }

    /**
     * 離開遊戲房間
     */
    async leaveRoom() {
        if (this.roomListener) {
            this.roomListener();
            this.roomListener = null;
        }

        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }

        this.currentRoom = null;
        this.currentRoomId = null;
        this.myPlayerId = null;
        this.opponentId = null;

        console.log('[PvP] 已離開房間');
    }

    /**
     * 清理資源
     */
    destroy() {
        this.leaveRoom();
        if (this.matchmakingListener) {
            this.matchmakingListener();
            this.matchmakingListener = null;
        }
    }

    // ===== Stage 3: 戰鬥同步方法 =====

    /**
     * 取得對手牌組
     * @returns {Array} 對手的牌組卡牌 ID 陣列
     */
    getOpponentDeckCards() {
        if (!this.currentRoom || !this.currentRoom.deckData) {
            return [];
        }
        return this.currentRoom.deckData[this.opponentId] || [];
    }

    /**
     * 標記玩家準備完成（Mulligan 結束）
     */
    async setPlayerReady(mulliganIndices = []) {
        if (!this.currentRoomId || !this.myPlayerId) return;

        try {
            await update(ref(database, `game_rooms/${this.currentRoomId}/players/${this.myPlayerId}`), {
                ready: true,
                mulliganIndices: mulliganIndices
            });
            console.log('[PvP] 已標記準備完成', mulliganIndices);
            return { success: true };
        } catch (error) {
            console.error('[PvP] 標記準備失敗:', error);
            return { success: false };
        }
    }

    /**
     * 檢查雙方是否都準備好
     */
    areBothPlayersReady() {
        if (!this.currentRoom || !this.currentRoom.players) return false;
        const p1Ready = this.currentRoom.players.player1?.ready;
        const p2Ready = this.currentRoom.players.player2?.ready;
        return p1Ready && p2Ready;
    }

    /**
     * 開始遊戲（雙方都準備好後呼叫）
     */
    async startGame() {
        if (!this.currentRoomId) return;

        try {
            await update(ref(database, `game_rooms/${this.currentRoomId}`), {
                status: 'playing',
                'gameState/turnStartTime': Date.now()
            });
            console.log('[PvP] 遊戲開始');
            return { success: true };
        } catch (error) {
            console.error('[PvP] 開始遊戲失敗:', error);
            return { success: false };
        }
    }

    /**
     * 提交出牌動作
     */
    async submitPlayCard(cardIndex, target = null, insertionIndex = -1) {
        return this.submitAction({
            type: 'PLAY_CARD',
            data: { cardIndex, target, insertionIndex }
        });
    }

    /**
     * 提交攻擊動作
     */
    async submitAttack(attackerIndex, target) {
        return this.submitAction({
            type: 'ATTACK',
            data: { attackerIndex, target }
        });
    }

    /**
     * 同步場面狀態到 Firebase
     * @param {Object} localState - 本地遊戲狀態摘要
     */
    async syncBoardState(localState) {
        if (!this.currentRoomId || !this.myPlayerId) return;

        const myStateKey = this.myPlayerId === 'player1' ? 'player1State' : 'player2State';

        try {
            await update(ref(database, `game_rooms/${this.currentRoomId}/gameState/${myStateKey}`), {
                hp: localState.hp,
                mana: localState.mana,
                maxMana: localState.maxMana,
                handCount: localState.handCount,
                deckCount: localState.deckCount,
                board: localState.board || []
            });
        } catch (error) {
            console.error('[PvP] 同步狀態失敗:', error);
        }
    }

    /**
     * 通知遊戲結束
     * @param {string} winnerId - 'player1' 或 'player2'
     * @param {string} reason - 結束原因
     */
    async notifyGameEnd(winnerId, reason = 'defeat') {
        if (!this.currentRoomId) return;

        try {
            await update(ref(database, `game_rooms/${this.currentRoomId}`), {
                status: 'finished',
                result: {
                    winner: winnerId,
                    reason: reason,
                    endTime: Date.now()
                }
            });
            console.log('[PvP] 遊戲結束，勝者:', winnerId);
            return { success: true };
        } catch (error) {
            console.error('[PvP] 通知遊戲結束失敗:', error);
            return { success: false };
        }
    }

    /**
     * 投降
     */
    async surrender() {
        if (!this.currentRoomId || !this.myPlayerId) return;
        const opponentId = this.myPlayerId === 'player1' ? 'player2' : 'player1';
        return this.notifyGameEnd(opponentId, 'surrender');
    }
}


// 建立全域實例
window.pvpManager = new PvPManager();

export default PvPManager;
