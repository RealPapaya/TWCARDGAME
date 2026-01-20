/**
 * PvP 房間清理工具
 * 用途：清理 Firebase Realtime Database 中的舊房間資料
 */

import { database, ref, get, remove } from './firebase_config.js';

/**
 * 清理已結束且超過指定時間的房間
 * @param {number} maxAgeHours - 保留時間（小時）
 * @returns {Object} 清理結果
 */
export async function cleanupOldRooms(maxAgeHours = 24) {
    try {
        const roomsRef = ref(database, 'game_rooms');
        const snapshot = await get(roomsRef);

        if (!snapshot.exists()) {
            return { success: true, removed: 0, message: '沒有房間需要清理' };
        }

        const rooms = snapshot.val();
        const now = Date.now();
        const maxAge = maxAgeHours * 60 * 60 * 1000; // 轉換為毫秒
        const toRemove = [];

        // 遍歷所有房間
        for (const [roomId, room] of Object.entries(rooms)) {
            const createdAt = room.createdAt || 0;
            const age = now - createdAt;

            // 條件 1: 已結束且超過 1 小時
            if (room.status === 'finished' && age > 60 * 60 * 1000) {
                toRemove.push({ roomId, reason: '已結束超過 1 小時' });
                continue;
            }

            // 條件 2: 創建超過指定時間的廢棄房間
            if (age > maxAge) {
                toRemove.push({ roomId, reason: `創建超過 ${maxAgeHours} 小時` });
            }
        }

        // 執行刪除
        for (const item of toRemove) {
            const roomRef = ref(database, `game_rooms/${item.roomId}`);
            await remove(roomRef);
            console.log(`[清理] 已刪除房間 ${item.roomId}: ${item.reason}`);
        }

        return {
            success: true,
            removed: toRemove.length,
            message: `已清理 ${toRemove.length} 個房間`
        };
    } catch (error) {
        console.error('[清理] 清理房間失敗:', error);
        return {
            success: false,
            removed: 0,
            message: `清理失敗: ${error.message}`
        };
    }
}

/**
 * 清理配對佇列中的過期玩家
 * @param {number} maxAgeMinutes - 最大等待時間（分鐘）
 * @returns {Object} 清理結果
 */
export async function cleanupMatchmakingQueue(maxAgeMinutes = 10) {
    try {
        const queueRef = ref(database, 'matchmaking_queue');
        const snapshot = await get(queueRef);

        if (!snapshot.exists()) {
            return { success: true, removed: 0, message: '配對佇列為空' };
        }

        const queue = snapshot.val();
        const now = Date.now();
        const maxAge = maxAgeMinutes * 60 * 1000;
        const toRemove = [];

        for (const [userId, player] of Object.entries(queue)) {
            const timestamp = player.timestamp || 0;
            const age = now - timestamp;

            if (age > maxAge) {
                toRemove.push(userId);
            }
        }

        // 執行刪除
        for (const userId of toRemove) {
            const playerRef = ref(database, `matchmaking_queue/${userId}`);
            await remove(playerRef);
            console.log(`[清理] 已移除過期玩家: ${userId}`);
        }

        return {
            success: true,
            removed: toRemove.length,
            message: `已清理 ${toRemove.length} 個過期玩家`
        };
    } catch (error) {
        console.error('[清理] 清理配對佇列失敗:', error);
        return {
            success: false,
            removed: 0,
            message: `清理失敗: ${error.message}`
        };
    }
}

/**
 * 獲取當前房間統計
 * @returns {Object} 統計資訊
 */
export async function getRoomStats() {
    try {
        const roomsRef = ref(database, 'game_rooms');
        const snapshot = await get(roomsRef);

        if (!snapshot.exists()) {
            return {
                total: 0,
                playing: 0,
                finished: 0,
                initializing: 0
            };
        }

        const rooms = snapshot.val();
        const stats = {
            total: 0,
            playing: 0,
            finished: 0,
            initializing: 0
        };

        for (const room of Object.values(rooms)) {
            stats.total++;
            if (room.status === 'playing') stats.playing++;
            else if (room.status === 'finished') stats.finished++;
            else if (room.status === 'initializing') stats.initializing++;
        }

        return stats;
    } catch (error) {
        console.error('[統計] 獲取房間統計失敗:', error);
        return null;
    }
}

// 如果是 admin，暴露清理函數到全域（供 Console 使用）
if (typeof window !== 'undefined') {
    window.PvPCleanup = {
        cleanupOldRooms,
        cleanupMatchmakingQueue,
        getRoomStats
    };
}
