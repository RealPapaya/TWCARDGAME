/**
 * 排行榜管理器
 * 職責：
 * - 從後端獲取排行榜資料
 * - 管理排行榜顯示邏輯
 * - 處理玩家互動（查看資料、加入好友）
 */

class LeaderboardManager {
    constructor() {
        this.apiUrl = 'https://script.google.com/macros/s/AKfycbxgyK3pOaHPtWkHaw1oIbc-RRM-rUiZKyMbOul6mgDNV9ELd9spyMB11kmq7j8NTY6R6A/exec';
        this.players = [];
        this.currentSortBy = 'level'; // 目前排序方式
        this.limit = 50; // 每次載入筆數
        this.offset = 0; // 偏移量
    }

    /**
     * 載入排行榜資料
     * @param {string} sortBy - 排序依據 (level, wins, etc.)
     * @returns {Promise<Array>}
     */
    async fetchLeaderboard(sortBy = 'level') {
        try {
            const url = `${this.apiUrl}?action=leaderboard&sortBy=${sortBy}&limit=${this.limit}&offset=${this.offset}`;
            const response = await fetch(url);
            const data = await response.json();

            if (data.success) {
                this.players = data.players;
                this.currentSortBy = sortBy;
                return this.players;
            } else {
                console.error('載入排行榜失敗:', data.message);
                return [];
            }
        } catch (error) {
            console.error('排行榜 API 錯誤:', error);
            return [];
        }
    }

    /**
     * 取得特定玩家資料
     * @param {string} username - 玩家帳號
     * @returns {Object|null}
     */
    getPlayerData(username) {
        return this.players.find(p => p.username === username) || null;
    }

    /**
     * 渲染排行榜列表
     * @param {HTMLElement} container - 容器元素
     */
    renderLeaderboard(container) {
        if (!container) return;

        container.innerHTML = '';

        if (this.players.length === 0) {
            container.innerHTML = '<div class="empty-message">暫無排行榜資料</div>';
            return;
        }

        this.players.forEach((player, index) => {
            const rank = this.offset + index + 1;
            const playerCard = this.createPlayerCard(player, rank);
            container.appendChild(playerCard);
        });
    }

    /**
     * 建立玩家卡片
     * @param {Object} player - 玩家資料
     * @param {number} rank - 排名
     * @returns {HTMLElement}
     */
    createPlayerCard(player, rank) {
        const card = document.createElement('div');
        card.className = 'leaderboard-player-card';

        // 前三名特殊樣式
        if (rank <= 3) {
            card.classList.add(`rank-${rank}`);
        }

        const rankBadge = this.getRankBadge(rank);
        const avatarId = player.selectedavatar || player.avatar || 'avatar1';
        const titleId = player.selectedtitle || player.title || 'beginner';
        const level = parseInt(player.level || 1);
        const username = player.username || '未知玩家';

        const avatarPath = this.getAvatarPath(avatarId);
        const titleName = this.getTitleName(titleId);

        card.innerHTML = `
      <div class="rank-badge">${rankBadge}</div>
      <div class="player-avatar-display" style="background-image: url('${avatarPath}'); background-size: cover; background-position: center;"></div>
      <div class="player-info-display">
        <div class="player-name">${username}</div>
        <div class="player-title-display">#${titleName}</div>
      </div>
      <div class="player-level-display">Lv. ${level}</div>
      <button class="player-action-btn" data-username="${username}">⋯</button>
    `;

        // 綁定點擊事件
        const actionBtn = card.querySelector('.player-action-btn');
        actionBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showPlayerActionMenu(player, actionBtn);
        });

        return card;
    }

    /**
     * 取得排名徽章
     * @param {number} rank - 排名
     * @returns {string}
     */
    getRankBadge(rank) {
        switch (rank) {
            case 1: return '🥇';
            case 2: return '🥈';
            case 3: return '🥉';
            default: return `#${rank}`;
        }
    }

    /**
     * 取得頭像圖片路徑
     * @param {string} avatarId - 頭像 ID
     * @returns {string}
     */
    getAvatarPath(avatarId) {
        const avatarData = window.PROFILE_DATA?.AVATAR_DATA || [];
        const avatar = avatarData.find(a => a.id === avatarId);
        return avatar ? avatar.path : 'assets/images/avatars/avatar1.jpg';
    }

    /**
     * 取得稱號顯示名稱
     * @param {string} titleId - 稱號 ID
     * @returns {string}
     */
    getTitleName(titleId) {
        const titleData = window.PROFILE_DATA?.TITLE_DATA || [];
        const title = titleData.find(t => t.id === titleId);
        return title ? title.name : '菜鳥';
    }

    /**
     * 顯示玩家操作選單
     * @param {Object} player - 玩家資料
     * @param {HTMLElement} btnElement - 按鈕元素（用於定位）
     */
    showPlayerActionMenu(player, btnElement) {
        // 移除現有選單
        const existingMenu = document.querySelector('.player-action-menu');
        if (existingMenu) {
            existingMenu.remove();
        }

        const menu = document.createElement('div');
        menu.className = 'player-action-menu';
        menu.innerHTML = `
      <button class="action-menu-item" data-action="view">🔍 查看資料</button>
      <button class="action-menu-item" data-action="friend">👥 加入好友</button>
    `;

        // 定位選單
        const rect = btnElement.getBoundingClientRect();
        menu.style.position = 'fixed';
        menu.style.top = `${rect.bottom + 5}px`;
        menu.style.left = `${rect.left - 100}px`;

        document.body.appendChild(menu);

        // 綁定選單事件
        menu.querySelectorAll('.action-menu-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const action = e.currentTarget.dataset.action;
                if (action === 'view') {
                    this.showPlayerProfile(player);
                } else if (action === 'friend') {
                    this.addFriend(player);
                }
                menu.remove();
            });
        });

        // 點擊外部關閉選單
        setTimeout(() => {
            document.addEventListener('click', function closeMenu(e) {
                if (!menu.contains(e.target)) {
                    menu.remove();
                    document.removeEventListener('click', closeMenu);
                }
            });
        }, 100);
    }

    /**
     * 顯示玩家詳細資料
     * @param {Object} player - 玩家資料
     */
    showPlayerProfile(player) {
        const modal = document.getElementById('player-profile-modal');
        if (!modal) return;

        const username = player.username || '未知';
        const level = parseInt(player.level || 1);
        const gold = parseInt(player.gold || 0);
        const avatarPath = this.getAvatarPath(player.selectedavatar || 'avatar1');
        const titleName = this.getTitleName(player.selectedtitle || 'beginner');

        // 解析統計資料
        let stats = {};
        try {
            stats = JSON.parse(player.stats || '{}');
        } catch (e) {
            stats = {};
        }

        const totalWins = (stats.pvpWins || 0) + (stats.aiWins || 0);
        const pvpWinrate = stats.pvpGames > 0
            ? Math.round((stats.pvpWins / stats.pvpGames) * 100)
            : 0;

        const avatarEl = document.getElementById('profile-modal-avatar');
        avatarEl.style.backgroundImage = `url('${avatarPath}')`;
        avatarEl.style.backgroundSize = 'cover';
        avatarEl.style.backgroundPosition = 'center';
        avatarEl.style.borderRadius = '50%';
        avatarEl.textContent = '';

        document.getElementById('profile-modal-username').textContent = username;
        document.getElementById('profile-modal-title').textContent = `#${titleName}`;
        document.getElementById('profile-modal-level').textContent = level;
        document.getElementById('profile-modal-gold').textContent = gold;
        document.getElementById('profile-modal-wins').textContent = totalWins;
        document.getElementById('profile-modal-winrate').textContent = `${pvpWinrate}%`;

        modal.style.display = 'flex';
    }

    /**
     * 加入好友（目前只顯示訊息，未來可擴展）
     * @param {Object} player - 玩家資料
     */
    addFriend(player) {
        // 顯示自定義訊息 modal
        if (window.showCustomModal) {
            window.showCustomModal(`已發送好友邀請給 ${player.username}！\n（好友系統開發中）`, false);
        } else {
            alert(`已發送好友邀請給 ${player.username}！\n（好友系統開發中）`);
        }
    }

    /**
     * 清理資源
     */
    destroy() {
        this.players = [];
        const menu = document.querySelector('.player-action-menu');
        if (menu) menu.remove();
    }
}

// 建立全域實例
window.leaderboardManager = new LeaderboardManager();
