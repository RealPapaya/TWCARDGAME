/**
 * collection_manager.js
 * 檔案用途: 卡牌圖鑑系統核心邏輯
 * 調用者: shop_events.js, app.js
 */

const CollectionManager = {
    currentFilter: 'all',
    searchQuery: '',

    /**
     * 渲染卡牌圖鑑
     */
    renderCollection(filter) {
        if (filter !== undefined) this.currentFilter = filter;

        const grid = document.getElementById('collection-grid');
        const ownedCards = AuthManager.currentUser?.ownedCards || {};

        if (!grid) return;

        // 核心篩選邏輯
        let cardsToShow = [...CARD_DATA];

        const isAdminTest = window.isDebugMode && window.isAdmin?.();

        // 1. 狀態篩選 (全部/已擁有/未擁有)
        if (this.currentFilter === 'owned' && !isAdminTest) {
            cardsToShow = cardsToShow.filter(c => ownedCards[c.id] > 0);
        } else if (this.currentFilter === 'missing' && !isAdminTest) {
            cardsToShow = cardsToShow.filter(c => !ownedCards[c.id] || ownedCards[c.id] === 0);
        }

        // 2. 關鍵字篩選
        if (this.searchQuery) {
            const query = this.searchQuery.toLowerCase();
            cardsToShow = cardsToShow.filter(c =>
                c.name.toLowerCase().includes(query) ||
                (c.category && c.category.toLowerCase().includes(query)) ||
                (c.description && c.description.toLowerCase().includes(query))
            );
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
                     onclick="CollectionManager.showCardOpModal('${card.id}')"
                     title="${card.description}">
                    ${isOwned ? `<div class="card-count-badge">x${count}</div>` : ''}
                    ${cardHtml}
                </div>
            `;
        }).join('');

        // 更新進度 (僅計算總數，不受搜尋篩選影響)
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
        const totalCards = CARD_DATA.length;
        const ownedCount = Object.keys(ownedCards).filter(id => ownedCards[id] > 0).length;

        const progressEl = document.getElementById('collection-progress');
        if (progressEl) {
            progressEl.textContent = `已收集卡片種類: ${ownedCount}/${totalCards}`;
        }
        this.updateVoucherDisplay();
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
     * 設置篩選器與搜尋事件
     */
    setupFilters() {
        // 篩選按鈕
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

        // 搜尋框
        const searchInput = document.getElementById('collection-search-input');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.searchQuery = e.target.value.trim();
                this.renderCollection();
            });
        }
    },

    /**
     * 顯示卡牌操作彈窗
     */
    showCardOpModal(cardId) {
        const card = CARD_DATA.find(c => c.id === cardId);
        if (!card) return;

        const ownedCards = AuthManager.currentUser?.ownedCards || {};
        const count = ownedCards[cardId] || 0;
        const vouchers = AuthManager.currentUser?.vouchers || 0;

        const modal = document.getElementById('card-op-modal');
        const title = document.getElementById('card-op-title');
        const preview = document.getElementById('card-op-preview');
        const countText = document.getElementById('card-op-count');

        const btnDisenchant = document.getElementById('btn-card-disenchant');
        const btnCraft = document.getElementById('btn-card-craft');

        const rates = {
            'COMMON': { disenchant: 20, craft: 50 },
            'RARE': { disenchant: 60, craft: 200 },
            'EPIC': { disenchant: 160, craft: 400 },
            'LEGENDARY': { disenchant: 300, craft: 800 }
        };

        const rate = rates[card.rarity] || rates['COMMON'];

        title.textContent = card.name;
        preview.innerHTML = this.createCardHtml(card, true);
        countText.textContent = `擁有數量: ${count}`;

        btnDisenchant.querySelector('span').textContent = rate.disenchant;
        btnCraft.querySelector('span').textContent = rate.craft;

        // 綁定點擊事件 (先移除舊的)
        btnDisenchant.onclick = () => this.disenchantCard(cardId, rate.disenchant);
        btnCraft.onclick = () => this.craftCard(cardId, rate.craft);

        // 檢查狀態
        btnDisenchant.disabled = count <= 0;
        btnCraft.disabled = vouchers < rate.craft;

        modal.style.display = 'flex';
    },

    /**
     * 分解卡牌
     */
    async disenchantCard(cardId, amount) {
        const user = AuthManager.currentUser;
        if (!user || !user.ownedCards[cardId] || user.ownedCards[cardId] <= 0) return;

        // 加入確認對話框 (自定義)
        if (!await gameConfirm(`確定要分解這張卡牌嗎？\n分解後將獲得 ${amount} 點消費券。`, '分解卡牌')) return;

        user.ownedCards[cardId]--;
        user.vouchers = (user.vouchers || 0) + amount;

        AuthManager.saveData();
        this.renderCollection(this.currentFilter);
        this.showCardOpModal(cardId); // 刷新彈窗狀態
        showToast(`分解成功！獲得 ${amount} 點消費券`);
    },

    /**
     * 合成卡牌
     */
    async craftCard(cardId, cost) {
        const user = AuthManager.currentUser;
        if (!user || (user.vouchers || 0) < cost) {
            showToast('消費券不足！');
            return;
        }

        // 加入確認對話框 (自定義)
        if (!await gameConfirm(`確定要合成這張卡牌嗎？\n合成將消耗 ${cost} 點消費券。`, '合成卡牌')) return;

        user.vouchers -= cost;
        if (!user.ownedCards[cardId]) user.ownedCards[cardId] = 0;
        user.ownedCards[cardId]++;

        AuthManager.saveData();
        this.renderCollection(this.currentFilter);
        this.showCardOpModal(cardId); // 刷新彈窗狀態
        showToast(`合成成功！消耗 ${cost} 點消費券`);
    },

    /**
     * 更新消費券顯示
     */
    updateVoucherDisplay() {
        const user = AuthManager.currentUser;
        const voucherAmount = document.getElementById('vouchers-amount');
        if (voucherAmount && user) {
            voucherAmount.textContent = user.vouchers || 0;
        }
    }
};

window.CollectionManager = CollectionManager;
