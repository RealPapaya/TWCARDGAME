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

        // 防止重複觸發遊戲結束
        this._gameEndTriggered = false;
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
                nickname: playerData.nickname || playerData.username,
                avatar: playerData.avatar || '👤',
                title: playerData.title || '',
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
     * 監聯配對結果
     */
    _startMatchmakingListener(userId) {
        const queueRef = ref(database, `matchmaking_queue/${userId}`);

        this.matchmakingListener = onValue(queueRef, async (snapshot) => {
            if (!snapshot.exists()) return;

            const data = snapshot.val();
            if (data.status === 'matched' && data.roomId) {
                console.log('[PvP] 配對成功！房間:', data.roomId);

                // 清除監聽器
                if (this.matchmakingListener) {
                    this.matchmakingListener();
                    this.matchmakingListener = null;
                }

                // 加入遊戲房間（等待房間資料載入）
                await this._joinGameRoom(data.roomId, data.playerId);

                // 確保 currentRoom 已設定後再觸發回調
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

        // 從配對佇列中取得雙方玩家資料
        const player1QueueRef = ref(database, `matchmaking_queue/${player1Id}`);
        const player2QueueRef = ref(database, `matchmaking_queue/${player2Id}`);

        const [player1Snapshot, player2Snapshot] = await Promise.all([
            get(player1QueueRef),
            get(player2QueueRef)
        ]);

        const player1Data = player1Snapshot.val() || {};
        const player2Data = player2Snapshot.val() || {};

        const roomData = {
            roomId: roomId,
            createdAt: Date.now(),
            status: 'initializing',

            // 儲存雙方玩家資訊
            playerInfo: {
                player1: {
                    username: player1Data.username || player1Id,
                    nickname: player1Data.nickname || player1Data.username || player1Id,
                    avatar: player1Data.avatar || '👤',
                    title: player1Data.title || ''
                },
                player2: {
                    username: player2Data.username || player2Id,
                    nickname: player2Data.nickname || player2Data.username || player2Id,
                    avatar: player2Data.avatar || '👤',
                    title: player2Data.title || ''
                }
            },

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

                // Mulligan 狀態追蹤
                mulliganStatus: {
                    player1: false,
                    player2: false
                },

                // 保存初始手牌（用於重連恢復）
                initialHands: {
                    player1: [],
                    player2: []
                },

                // 斷線狀態追蹤
                disconnectionStatus: {
                    player1: {
                        isDisconnected: false,
                        disconnectedAt: null,
                        waitingForReconnect: false
                    },
                    player2: {
                        isDisconnected: false,
                        disconnectedAt: null,
                        waitingForReconnect: false
                    }
                },

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
     * @returns {Promise} 等待房間資料載入完成
     */
    async _joinGameRoom(roomId, playerId) {
        this.currentRoomId = roomId;
        this.myPlayerId = playerId;
        this.opponentId = playerId === 'player1' ? 'player2' : 'player1';

        // 保存到 localStorage 以便重連
        localStorage.setItem('pvp_current_room', roomId);
        localStorage.setItem('pvp_player_id', playerId);

        const roomRef = ref(database, `game_rooms/${roomId}`);

        // 使用 Promise 等待第一次房間資料載入
        return new Promise((resolve) => {
            let isFirstLoad = true;

            // 開始監聽房間狀態
            this.roomListener = onValue(roomRef, (snapshot) => {
                if (!snapshot.exists()) {
                    console.log('[PvP] 房間已不存在');
                    if (isFirstLoad) {
                        isFirstLoad = false;
                        resolve(false);
                    }
                    return;
                }

                const room = snapshot.val();
                this.currentRoom = room;

                // 調試日誌：記錄每次房間更新
                console.log('[PvP] 房間狀態更新 - status:', room.status, 'result:', room.result, '_gameEndTriggered:', this._gameEndTriggered);

                // 第一次載入完成，resolve Promise
                if (isFirstLoad) {
                    isFirstLoad = false;
                    console.log('[PvP] 房間資料載入完成');

                    // 設定斷線處理
                    const myPlayerRef = ref(database, `game_rooms/${roomId}/players/${playerId}`);
                    onDisconnect(myPlayerRef).update({ connected: false });

                    // 開始心跳
                    this._startHeartbeat(roomId, playerId);

                    console.log('[PvP] 已加入房間:', roomId, '身份:', playerId);
                    resolve(true);
                }

                // 檢查對手連線狀態
                const opponentConnected = room.players?.[this.opponentId]?.connected;
                if (opponentConnected && this.onOpponentReconnect) {
                    // 對手重新連接
                    this.onOpponentReconnect();
                } else if (!opponentConnected && this.onOpponentDisconnect) {
                    this.onOpponentDisconnect();
                }

                // 優先檢查遊戲是否結束
                if (room.status === 'finished' && room.result) {
                    console.log('[PvP] 檢測到遊戲結束:', room.result);

                    // 清除 localStorage
                    localStorage.removeItem('pvp_current_room');
                    localStorage.removeItem('pvp_player_id');

                    // 防止重複觸發
                    if (!this._gameEndTriggered) {
                        this._gameEndTriggered = true;
                        console.log('[PvP] 觸發 onGameEnd 回調');
                        if (this.onGameEnd) {
                            this.onGameEnd(room.result);
                        }
                    }
                    // 遊戲結束後可能仍需要一次狀態更新來顯示最終場面，但通常不需要
                }

                // 遊戲狀態更新
                if (this.onGameStateUpdate) {
                    this.onGameStateUpdate(room.gameState);
                }
            });
        });
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
     * 同步遊戲動作到 Firebase
     * @param {string} actionType - 動作類型: PLAY_CARD, ATTACK, END_TURN, MULLIGAN_DONE
     * @param {Object} actionData - 動作資料
     */
    async syncGameAction(actionType, actionData = {}) {
        if (!this.currentRoomId || !this.myPlayerId) {
            console.warn('[PvP] syncGameAction: 未在遊戲中');
            return { success: false, message: '未在遊戲中' };
        }

        const action = {
            turn: this.currentRoom?.gameState?.turnNumber || 1,
            player: this.myPlayerId,
            action: actionType,
            data: actionData,
            timestamp: Date.now(),
            processed: false
        };

        try {
            const logRef = ref(database, `game_rooms/${this.currentRoomId}/actionLog`);
            await push(logRef, action);
            console.log('[PvP] 動作已同步:', actionType, actionData);
            return { success: true };
        } catch (error) {
            console.error('[PvP] 同步動作失敗:', error);
            return { success: false, message: '同步失敗' };
        }
    }

    /**
     * 開始監聽動作日誌 (用於接收對手動作)
     * @param {boolean} skipOldActions - 是否跳過舊動作（重連時使用）
     */
    async listenActionLog(skipOldActions = false) {
        if (!this.currentRoomId) return;

        const logRef = ref(database, `game_rooms/${this.currentRoomId}/actionLog`);

        // 如果需要跳過舊動作，先一次性查詢所有現有動作並記錄最後一個 key
        if (skipOldActions) {
            try {
                const snapshot = await get(logRef);
                if (snapshot.exists()) {
                    const actions = snapshot.val();
                    const actionKeys = Object.keys(actions).sort();
                    if (actionKeys.length > 0) {
                        this.lastProcessedActionKey = actionKeys[actionKeys.length - 1];
                        console.log('[PvP] 重連模式：已跳過', actionKeys.length, '個舊動作，最後 key:', this.lastProcessedActionKey);
                    }
                }
            } catch (error) {
                console.error('[PvP] 讀取舊動作失敗:', error);
            }
        } else {
            this.lastProcessedActionKey = null;
        }

        // 監聽動作日誌變化
        this.actionLogListener = onValue(logRef, (snapshot) => {
            if (!snapshot.exists()) return;

            const actions = snapshot.val();
            const actionEntries = Object.entries(actions).sort((a, b) => a[0].localeCompare(b[0]));

            // 找到尚未處理的對手動作
            for (const [key, action] of actionEntries) {
                // 跳過自己的動作
                if (action.player === this.myPlayerId) continue;

                // 跳過已處理的動作 (使用 key 比較，確保順序)
                if (this.lastProcessedActionKey && key <= this.lastProcessedActionKey) continue;

                // 記錄此動作已處理
                this.lastProcessedActionKey = key;

                console.log('[PvP] 收到對手動作:', action.action, action.data);

                // 觸發回調
                if (this.onOpponentAction) {
                    this.onOpponentAction(action);
                }
            }
        });

        console.log('[PvP] 開始監聽動作日誌', skipOldActions ? '(已跳過舊動作)' : '');
    }

    /**
     * 停止監聽動作日誌
     */
    stopListenActionLog() {
        if (this.actionLogListener) {
            this.actionLogListener();
            this.actionLogListener = null;
        }
    }

    /**
     * 更新遊戲狀態到 Firebase (公開資訊)
     * @param {Object} stateUpdate - 要更新的狀態
     */
    async updateGameState(stateUpdate) {
        if (!this.currentRoomId || !this.myPlayerId) return;

        const myStateKey = `${this.myPlayerId}State`;

        try {
            await update(ref(database, `game_rooms/${this.currentRoomId}/gameState/${myStateKey}`), stateUpdate);
            console.log('[PvP] 狀態已同步:', stateUpdate);
        } catch (error) {
            console.error('[PvP] 同步狀態失敗:', error);
        }
    }

    /**
     * 同步 Mulligan 完成狀態
     */
    async syncMulliganStatus(isReady) {
        if (!this.currentRoomId || !this.myPlayerId) return;

        try {
            await update(ref(database, `game_rooms/${this.currentRoomId}/gameState/mulliganStatus`), {
                [this.myPlayerId]: isReady
            });
            console.log('[PvP] Mulligan 狀態已同步:', isReady);
            return { success: true };
        } catch (error) {
            console.error('[PvP] 同步 Mulligan 狀態失敗:', error);
            return { success: false };
        }
    }

    /**
     * 保存初始手牌到 Firebase（用於重連恢復）
     * @param {Array<string>} cardIds - 手牌的卡牌 ID 陣列
     */
    async saveInitialHand(cardIds) {
        if (!this.currentRoomId || !this.myPlayerId) {
            console.warn('[PvP] saveInitialHand: 未在遊戲中');
            return { success: false };
        }

        try {
            await update(ref(database, `game_rooms/${this.currentRoomId}/gameState/initialHands`), {
                [this.myPlayerId]: cardIds
            });
            console.log('[PvP] 初始手牌已保存:', cardIds);
            return { success: true };
        } catch (error) {
            console.error('[PvP] 保存初始手牌失敗:', error);
            return { success: false };
        }
    }

    /**
     * 監聯 Mulligan 狀態，雙方都完成時觸發回調
     * @param {Function} onBothReady - 雙方都準備好時的回調
     */
    listenMulliganStatus(onBothReady) {
        if (!this.currentRoomId) return;

        const statusRef = ref(database, `game_rooms/${this.currentRoomId}/gameState/mulliganStatus`);

        this.mulliganListener = onValue(statusRef, (snapshot) => {
            if (!snapshot.exists()) return;

            const status = snapshot.val();
            console.log('[PvP] Mulligan 狀態更新:', status);

            // 檢查雙方是否都完成
            if (status.player1 && status.player2) {
                console.log('[PvP] 雙方 Mulligan 完成，開始遊戲');
                if (onBothReady) onBothReady();

                // 清理監聽器
                if (this.mulliganListener) {
                    this.mulliganListener();
                    this.mulliganListener = null;
                }
            }
        });
    }

    /**
     * 檢查是否輪到自己
     */
    isMyTurn() {
        return this.currentRoom?.gameState?.currentTurn === this.myPlayerId;
    }

    /**
     * 取得當前遊戲狀態
     */
    getGameState() {
        return this.currentRoom?.gameState || null;
    }

    /**
     * 嘗試重新連接到之前的對戰
     * @returns {Object|null} 如果有未完成對戰返回 {roomId, playerId}，否則返回 null
     */
    async tryReconnect() {
        const savedRoom = localStorage.getItem('pvp_current_room');
        const savedPlayer = localStorage.getItem('pvp_player_id');

        if (!savedRoom || !savedPlayer) {
            return null;
        }

        console.log('[PvP] 檢測到未完成對戰:', savedRoom, savedPlayer);

        // 檢查房間是否還存在且未結束
        try {
            const roomRef = ref(database, `game_rooms/${savedRoom}`);
            const snapshot = await get(roomRef);

            if (!snapshot.exists()) {
                console.log('[PvP] 房間已不存在');
                localStorage.removeItem('pvp_current_room');
                localStorage.removeItem('pvp_player_id');
                return null;
            }

            const room = snapshot.val();
            if (room.status === 'finished') {
                console.log('[PvP] 對戰已結束');
                localStorage.removeItem('pvp_current_room');
                localStorage.removeItem('pvp_player_id');
                return null;
            }

            // 房間存在且未結束，返回資訊
            return {
                roomId: savedRoom,
                playerId: savedPlayer,
                room: room
            };
        } catch (error) {
            console.error('[PvP] 檢查房間失敗:', error);
            return null;
        }
    }

    /**
     * 重新連接到對戰
     * @param {string} roomId 
     * @param {string} playerId 
     */
    async reconnect(roomId, playerId) {
        console.log('[PvP] 重新連接:', roomId, playerId);

        // 更新 connected 狀態為 true
        const playerRef = ref(database, `game_rooms/${roomId}/players/${playerId}`);
        await update(playerRef, { connected: true, lastPing: Date.now() });

        // 重新加入房間
        await this._joinGameRoom(roomId, playerId);

        console.log('[PvP] 重新連接成功');
    }

    /**
     * 設定對手斷線狀態
     */
    async markOpponentDisconnected() {
        if (!this.currentRoomId || !this.opponentId) return;

        const statusPath = `game_rooms/${this.currentRoomId}/gameState/disconnectionStatus/${this.opponentId}`;
        await update(ref(database, statusPath), {
            isDisconnected: true,
            disconnectedAt: Date.now(),
            waitingForReconnect: true
        });

        console.log('[PvP] 已標記對手斷線:', this.opponentId);
    }

    /**
     * 對手超時未重連,判定己方勝利
     */
    async claimVictoryByTimeout() {
        if (!this.currentRoomId) return;

        const updatePath = `game_rooms/${this.currentRoomId}`;
        const updateData = {
            status: 'finished',
            result: {
                winner: this.myPlayerId,
                reason: 'timeout',
                endTime: Date.now()
            }
        };

        try {
            await update(ref(database, updatePath), updateData);
            console.log('[PvP] ✅ 對手超時未重連,己方獲勝');

            localStorage.removeItem('pvp_current_room');
            localStorage.removeItem('pvp_player_id');
            return { success: true };
        } catch (error) {
            console.error('[PvP] ❌ 判定勝利失敗:', error);
            return { success: false };
        }
    }

    /**
     * 玩家主動放棄重連 (從重連 Modal)
     */
    async abandonReconnection() {
        const savedRoom = localStorage.getItem('pvp_current_room');
        if (!savedRoom) return;

        const playerId = localStorage.getItem('pvp_player_id');
        const winnerId = playerId === 'player1' ? 'player2' : 'player1';

        const updatePath = `game_rooms/${savedRoom}`;
        const updateData = {
            status: 'finished',
            result: {
                winner: winnerId,
                reason: 'abandon',
                endTime: Date.now()
            }
        };

        try {
            await update(ref(database, updatePath), updateData);
            console.log('[PvP] ✅ 已放棄重連,對手獲勝');

            localStorage.removeItem('pvp_current_room');
            localStorage.removeItem('pvp_player_id');
            return { success: true };
        } catch (error) {
            console.error('[PvP] ❌ 放棄重連失敗:', error);
            return { success: false };
        }
    }

    /**
     * 投降
     */
    async surrender() {
        console.log('[PvP] surrender() 被調用');
        console.log('[PvP] currentRoomId:', this.currentRoomId);
        console.log('[PvP] opponentId:', this.opponentId);

        if (!this.currentRoomId) {
            console.error('[PvP] 投降失敗：沒有房間 ID');
            return;
        }

        const winnerId = this.opponentId;
        const updatePath = `game_rooms/${this.currentRoomId}`;
        const updateData = {
            status: 'finished',
            result: {
                winner: winnerId,
                reason: 'surrender',
                endTime: Date.now()
            }
        };

        console.log('[PvP] 準備更新 Firebase:', updatePath, updateData);

        try {
            await update(ref(database, updatePath), updateData);
            console.log('[PvP] ✅ Firebase 更新成功，投降完成');

            // 清除 localStorage
            localStorage.removeItem('pvp_current_room');
            localStorage.removeItem('pvp_player_id');

            return { success: true };
        } catch (error) {
            console.error('[PvP] ❌ Firebase 更新失敗:', error);
            return { success: false };
        }
    }

    /**
     * 離開遊戲房間
     */
    async leaveRoom() {
        // 清除 localStorage
        localStorage.removeItem('pvp_current_room');
        localStorage.removeItem('pvp_player_id');

        if (this.roomListener) {
            this.roomListener();
            this.roomListener = null;
        }

        // 清理動作日誌監聽器
        if (this.actionLogListener) {
            this.actionLogListener();
            this.actionLogListener = null;
        }

        // 清理 Mulligan 監聽器
        if (this.mulliganListener) {
            this.mulliganListener();
            this.mulliganListener = null;
        }

        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }

        this.currentRoom = null;
        this.currentRoomId = null;
        this.myPlayerId = null;
        this.opponentId = null;
        this.lastProcessedActionKey = null;
        this._gameEndTriggered = false; // 重置標記

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
