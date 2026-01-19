/**
 * collection_manager.js
 * 檔案用途: 卡牌圖鑑系統核心邏輯
 * 調用者: shop_events.js, app.js
 */

const CollectionManager = {
    currentFilter: 'all',

    /**
     * 渲染卡牌圖鑑
     */
    renderCollection(filter = 'all') {
        this.currentFilter = filter;

        const grid = document.getElementById('collection-grid');
        const ownedCards = AuthManager.currentUser?.ownedCards || {};

        if (!grid) return;

        // 篩選卡牌
        // 篩選卡牌
        let cardsToShow = CARD_DATA.filter(c => c.type === 'MINION'); // 只顯示隨從卡

        const isAdminTest = window.isDebugMode && window.isAdmin?.();

        if (filter === 'owned' && !isAdminTest) {
            cardsToShow = cardsToShow.filter(c => ownedCards[c.id] > 0);
        } else if (filter === 'missing' && !isAdminTest) {
            cardsToShow = cardsToShow.filter(c => !ownedCards[c.id] || ownedCards[c.id] === 0);
        }

        // 生成卡牌網格
        grid.innerHTML = cardsToShow.map(card => {
            const count = ownedCards[card.id] || 0;
            // admin 在測試模式下視為全開
            const isOwned = isAdminTest || (count > 0);
            const cardHtml = this.createCardHtml(card, isOwned);

            return `
                <div class="collection-card ${isOwned ? 'owned' : 'missing'}" 
                     data-card-id="${card.id}" 
                     title="${isOwned ? card.description : '尚未擁有此卡牌'}">
                    ${isOwned ? `<div class="card-count-badge">x${count}</div>` : ''}
                    ${cardHtml}
                </div>
            `;
        }).join('');

        // 更新進度
        this.updateProgress();
    },

    /**
     * 生成完整的卡牌 HTML 結構 (使用統一的 CardRenderer)
     */
    createCardHtml(card, isOwned) {
        if (!card) return '';

        // 調用統一的卡牌渲染器
        return CardRenderer.createHTML(card, {
            isOwned: isOwned,
            showDetails: true,
            size: 'normal'
        });
    },

    /**
     * 更新收藏進度
     */
    updateProgress() {
        const ownedCards = AuthManager.currentUser?.ownedCards || {};
        const totalCards = CARD_DATA.filter(c => c.type === 'MINION').length;
        const ownedCount = Object.keys(ownedCards).filter(id => ownedCards[id] > 0).length;

        const progressEl = document.getElementById('collection-progress');
        if (progressEl) {
            progressEl.textContent = `${ownedCount}/${totalCards}`;
        }
    },

    /**
     * 稀有度文字
     */
    getRarityText(rarity) {
        const map = {
            'COMMON': '一般',
            'RARE': '精良',
            'EPIC': '史詩',
            'LEGENDARY': '傳說',
            'REPIC': '超稀有'
        };
        return map[rarity] || rarity;
    },

    /**
     * 設置篩選器事件
     */
    setupFilters() {
        const filterBtns = document.querySelectorAll('.filter-btn');
        filterBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                // 移除所有Active狀態
                filterBtns.forEach(b => b.classList.remove('active'));
                // 設置當前按鈕為Active
                btn.classList.add('active');
                // 重新渲染
                this.renderCollection(btn.dataset.filter);
            });
        });
    }
};

window.CollectionManager = CollectionManager;
