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

        // 回調函數
        this.onMatchFound = null;
        this.onGameStateUpdate = null;
        this.onOpponentAction = null;
        this.onGameEnd = null;
        this.onOpponentDisconnect = null;
        this.onOpponentReconnect = null;
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

        const roomData = {
            roomId: roomId,
            createdAt: Date.now(),
            status: 'initializing',

            players: {
                player1: {
                    userId: player1Id,
                    connected: true,
                    lastPing: Date.now(),
                    ready: false
                },
                player2: {
                    userId: player2Id,
                    connected: true,
                    lastPing: Date.now(),
                    ready: false
                }
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

            actionLog: [],
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

        const roomRef = ref(database, `game_rooms/${roomId}`);

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

            // 遊戲狀態更新
            if (this.onGameStateUpdate) {
                this.onGameStateUpdate(room.gameState);
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
}

// 建立全域實例
window.pvpManager = new PvPManager();

export default PvPManager;
