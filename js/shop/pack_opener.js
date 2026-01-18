/**
 * pack_opener.js
 * 檔案用途: 開包系統與隨機獎勵生成
 * 調用者: shop_manager.js
 */

const PackOpener = {
    // 稀有度機率 (用戶指定)
    rarityWeights: {
        'COMMON': 65,
        'RARE': 25,
        'EPIC': 7,
        'LEGENDARY': 3
    },

    /**
     * 開包主函數
     */
    open(product) {
        if (product.type === 'CARDS') {
            this.openCardPack(product.rewards.cardCount);
        } else if (product.type === 'COSMETICS') {
            this.openCosmeticPack(product.rewards.itemCount);
        }
    },

    /**
     * 開啟卡牌包
     */
    openCardPack(count) {
        const cards = this.generateRandomCards(count);
        this.showPackAnimation('card', cards);
        this.addCardsToCollection(cards);
    },

    /**
     * 生成隨機卡牌
     */
    generateRandomCards(count) {
        const cards = [];

        for (let i = 0; i < count; i++) {
            // 加權隨機稀有度
            const rarity = this.weightedRandomRarity();

            // 從對應稀有度的卡池隨機抽取
            const availableCards = CARD_DATA.filter(c => c.rarity === rarity);
            if (availableCards.length > 0) {
                const randomCard = availableCards[Math.floor(Math.random() * availableCards.length)];
                cards.push(randomCard);
            }
        }

        return cards;
    },

    /**
     * 加權隨機稀有度
     */
    weightedRandomRarity() {
        const rand = Math.random() * 100;
        let cumulative = 0;

        for (const [rarity, weight] of Object.entries(this.rarityWeights)) {
            cumulative += weight;
            if (rand < cumulative) {
                return rarity;
            }
        }

        return 'COMMON'; // fallback
    },

    /**
     * 開啟酷炫包
     */
    openCosmeticPack(count) {
        const items = this.generateRandomCosmetics(count);
        this.showPackAnimation('cosmetic', items);
        this.unlockCosmetics(items);
    },

    /**
     * 生成隨機外觀物品
     */
    generateRandomCosmetics(count) {
        const items = [];

        for (let i = 0; i < count; i++) {
            const type = Math.random() > 0.5 ? 'avatar' : 'title';

            if (type === 'avatar') {
                // 隨機選擇未解鎖的頭像
                const unlockedAvatars = AuthManager.currentUser?.unlockedAvatars || [];
                const availableAvatars = AVAILABLE_AVATARS.filter(a => !unlockedAvatars.includes(a.id));

                if (availableAvatars.length > 0) {
                    const randomAvatar = availableAvatars[Math.floor(Math.random() * availableAvatars.length)];
                    items.push({ type: 'avatar', data: randomAvatar });
                }
            } else {
                // 隨機選擇未解鎖的稱號
                const unlockedTitles = AuthManager.currentUser?.unlockedTitles || [];
                const availableTitles = AVAILABLE_TITLES.filter(t => !unlockedTitles.includes(t.name));

                if (availableTitles.length > 0) {
                    const randomTitle = availableTitles[Math.floor(Math.random() * availableTitles.length)];
                    items.push({ type: 'title', data: randomTitle });
                }
            }
        }

        return items;
    },

    /**
     * 顯示開包動畫與獎勵
     */
    showPackAnimation(packType, rewards) {
        const modal = document.getElementById('pack-opening-modal');
        const animation = document.getElementById('pack-animation');
        const rewardsContainer = document.getElementById('pack-rewards');

        // 顯示 Modal
        modal.style.display = 'flex';

        // 簡單的開包動畫
        animation.innerHTML = packType === 'card' ? '🎴' : '✨';
        animation.style.animation = 'pack-shake 0.5s ease-in-out 3';

        // 等待動畫完成後顯示獎勵
        setTimeout(() => {
            rewardsContainer.innerHTML = '';

            if (packType === 'card') {
                rewards.forEach(card => {
                    const rewardEl = document.createElement('div');
                    rewardEl.className = `reward-item ${card.rarity}`;
                    rewardEl.innerHTML = `
                        <div style="font-size: 40px;">🎴</div>
                        <div class="reward-item-name">${card.name}</div>
                        <div style="font-size: 12px; color: var(--text-secondary);">${this.getRarityText(card.rarity)}</div>
                    `;
                    rewardsContainer.appendChild(rewardEl);
                });
            } else {
                rewards.forEach(item => {
                    const rewardEl = document.createElement('div');
                    rewardEl.className = 'reward-item';
                    const icon = item.type === 'avatar' ? '👤' : '🏷️';
                    const name = item.type === 'avatar' ? item.data.name : item.data.name;
                    rewardEl.innerHTML = `
                        <div style="font-size: 40px;">${icon}</div>
                        <div class="reward-item-name">${name}</div>
                    `;
                    rewardsContainer.appendChild(rewardEl);
                });
            }
        }, 1500);
    },

    /**
     * 將卡牌加入玩家收藏
     */
    addCardsToCollection(cards) {
        const user = AuthManager.currentUser;
        if (!user) return;

        if (!user.ownedCards) {
            user.ownedCards = {};
        }

        cards.forEach(card => {
            if (!user.ownedCards[card.id]) {
                user.ownedCards[card.id] = 0;
            }
            user.ownedCards[card.id]++;
        });

        AuthManager.saveData();
    },

    /**
     * 解鎖外觀物品
     */
    unlockCosmetics(items) {
        const user = AuthManager.currentUser;
        if (!user) return;

        if (!user.unlockedAvatars) user.unlockedAvatars = [];
        if (!user.unlockedTitles) user.unlockedTitles = [];

        items.forEach(item => {
            if (item.type === 'avatar') {
                if (!user.unlockedAvatars.includes(item.data.id)) {
                    user.unlockedAvatars.push(item.data.id);
                }
            } else if (item.type === 'title') {
                if (!user.unlockedTitles.includes(item.data.name)) {
                    user.unlockedTitles.push(item.data.name);
                }
            }
        });

        AuthManager.saveData();
    },

    /**
     * 稀有度文字
     */
    getRarityText(rarity) {
        const map = {
            'COMMON': '一般',
            'RARE': '精良',
            'EPIC': '史詩',
            'LEGENDARY': '傳說'
        };
        return map[rarity] || rarity;
    }
};

// CSS 動畫需要在 shop.css 中定義
// @keyframes pack-shake { ... }

window.PackOpener = PackOpener;
