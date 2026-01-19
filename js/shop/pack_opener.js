/**
 * pack_opener.js
 * 檔案用途: 開包系統與隨機獎勵生成
 * 調用者: shop_manager.js
 */

const PackOpener = {
    // 稀有度機率 (用戶指定)
    rarityWeights: {
        'COMMON': 60,
        'RARE': 26,
        'EPIC': 10,
        'LEGENDARY': 4
    },

    /**
     * 開包主函數
     */
    async open(product) {
        if (product.type === 'CARDS') {
            await this.openCardPack(product.rewards.cardCount);
        } else if (product.type === 'COSMETICS') {
            await this.openCosmeticPack(product.rewards.itemCount);
        }
    },

    /**
     * 開啟卡牌包
     */
    async openCardPack(count) {
        const cards = this.generateRandomCards(count);
        this.addCardsToCollection(cards); // 改為非阻塞
        // 使新的互動式開包動畫
        this.showInteractivePackOpening(cards);
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
     * 互動式開包動畫 (Hearthstone Style)
     */
    showInteractivePackOpening(cards) {
        // 創建全螢幕遮罩
        const overlay = document.createElement('div');
        overlay.className = 'pack-overlay';
        overlay.id = 'pack-opening-overlay';

        // 卡牌容器
        const container = document.createElement('div');
        container.className = 'pack-cards-container';

        let flippedCount = 0;
        const totalCards = cards.length;

        // 完成按鈕
        const doneBtn = document.createElement('button');
        doneBtn.id = 'btn-pack-done';
        doneBtn.textContent = '完成';
        doneBtn.onclick = () => {
            document.body.removeChild(overlay);
        };

        // 創建每張卡牌
        cards.forEach((card, index) => {
            const wrapper = document.createElement('div');
            wrapper.className = `pack-card-wrapper ${card.rarity}`;

            // 錯開初始動畫時間
            wrapper.style.animation = `deal-card 0.5s ease-out ${index * 0.1}s backwards`;

            const inner = document.createElement('div');
            inner.className = 'pack-card-inner';

            // 背面
            const back = document.createElement('div');
            back.className = 'pack-card-back';

            // 正面 (使用 CardRenderer)
            const front = document.createElement('div');
            front.className = 'pack-card-front';

            // 使用 CardRenderer 生成卡牌 HTML
            // 注意：CardRenderer 可能生成的是字串或元素，這裡假設是 HTML 字串，如果沒有 CardRenderer 則手動生成
            if (window.CardRenderer) {
                front.innerHTML = window.CardRenderer.createHTML(card);
            } else {
                front.innerHTML = `<div class="card-name">${card.name}</div>`;
            }

            inner.appendChild(back);
            inner.appendChild(front);
            wrapper.appendChild(inner);

            // 翻牌點擊事件
            wrapper.addEventListener('click', () => {
                if (wrapper.classList.contains('flipped')) return;

                wrapper.classList.add('flipped');
                // 播放翻牌音效 (如果有的話)
                // AudioController.play('card_flip'); 

                flippedCount++;
                if (flippedCount === totalCards) {
                    doneBtn.classList.add('visible');
                }
            });

            container.appendChild(wrapper);
        });

        overlay.appendChild(container);
        overlay.appendChild(doneBtn);
        document.body.appendChild(overlay);

        // 添加發牌動畫 keyframes (如果 CSS 中沒有)
        if (!document.getElementById('pack-keyframes')) {
            const style = document.createElement('style');
            style.id = 'pack-keyframes';
            style.textContent = `
                @keyframes deal-card {
                    from { opacity: 0; transform: translateY(-100vh) rotate(180deg); }
                    to { opacity: 1; transform: translateY(0) rotate(0); }
                }
            `;
            document.head.appendChild(style);
        }
    },

    /**
     * 開啟酷炫包 (維持舊版動畫或簡單顯示)
     */
    openCosmeticPack(count) {
        const items = this.generateRandomCosmetics(count);
        this.unlockCosmetics(items);
        this.showPackAnimation('cosmetic', items); // 酷炫包暫時維持舊動畫，或需要另外實作
    },

    /**
     * 生成隨機外觀物品
     */
    generateRandomCosmetics(count) {
        const items = [];
        const avatarPool = window.PROFILE_DATA?.AVATAR_DATA || [];
        const titlePool = window.PROFILE_DATA?.TITLE_DATA || [];
        const user = AuthManager.currentUser;

        // 目前已擁有的清單
        const ownedAvatars = user?.ownedAvatars || ['avatar1'];
        const ownedTitles = user?.ownedTitles || ['beginner'];

        for (let i = 0; i < count; i++) {
            const type = Math.random() > 0.5 ? 'avatar' : 'title';

            if (type === 'avatar') {
                const availableAvatars = avatarPool.filter(a => !ownedAvatars.includes(a.id));
                if (availableAvatars.length > 0) {
                    const randomAvatar = availableAvatars[Math.floor(Math.random() * availableAvatars.length)];
                    items.push({ type: 'avatar', data: randomAvatar });
                } else {
                    // 已集齊所有頭像 -> 補償消費券
                    items.push({ type: 'voucher', amount: 50, name: '頭像重複補償' });
                }
            } else {
                const availableTitles = titlePool.filter(t => !ownedTitles.includes(t.id));
                if (availableTitles.length > 0) {
                    const randomTitle = availableTitles[Math.floor(Math.random() * availableTitles.length)];
                    items.push({ type: 'title', data: randomTitle });
                } else {
                    // 已集齊所有稱號 -> 補償消費券
                    items.push({ type: 'voucher', amount: 30, name: '稱號重複補償' });
                }
            }
        }

        return items;
    },

    /**
     * 顯示開包動畫與獎勵 (酷炫包用)
     */
    showPackAnimation(packType, rewards) {
        const modal = document.getElementById('pack-opening-modal');
        if (!modal) {
            console.warn('pack-opening-modal not found');
            return;
        }

        const animation = document.getElementById('pack-animation');
        const rewardsContainer = document.getElementById('pack-rewards');

        // 顯示 Modal
        modal.style.display = 'flex';

        // 簡單的開包動畫
        animation.innerHTML = packType === 'card' ? '🎴' : '✨';

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

                    let icon = '🎁';
                    let name = '未知獎勵';
                    let subText = '外觀物品';

                    if (item.type === 'avatar') {
                        icon = '👤';
                        name = item.data.name;
                        subText = '新頭像';
                    } else if (item.type === 'title') {
                        icon = '🏷️';
                        name = '#' + item.data.name;
                        subText = '新稱號';
                    } else if (item.type === 'voucher') {
                        icon = '🎟️';
                        name = item.amount;
                        subText = item.name;
                    }

                    rewardEl.innerHTML = `
                        <div style="font-size: 40px;">${icon}</div>
                        <div class="reward-item-name">${name}</div>
                        <div style="font-size: 12px; color: var(--text-secondary);">${subText}</div>
                    `;
                    rewardsContainer.appendChild(rewardEl);
                });
            }
        }, 1500);
    },

    /**
     * 將卡牌加入玩家收藏
     */
    async addCardsToCollection(cards) {
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

        AuthManager.saveData(); // 非阻塞存檔
    },

    /**
     * 解鎖外觀物品
     */
    unlockCosmetics(items) {
        const user = AuthManager.currentUser;
        if (!user) return;

        if (!user.ownedAvatars) user.ownedAvatars = ['avatar1'];
        if (!user.ownedTitles) user.ownedTitles = ['beginner'];
        if (user.vouchers === undefined) user.vouchers = 0;

        let changed = false;

        items.forEach(item => {
            if (item.type === 'avatar') {
                if (!user.ownedAvatars.includes(item.data.id)) {
                    user.ownedAvatars.push(item.data.id);
                    changed = true;
                }
            } else if (item.type === 'title') {
                if (!user.ownedTitles.includes(item.data.id)) {
                    user.ownedTitles.push(item.data.id);
                    changed = true;
                }
            } else if (item.type === 'voucher') {
                user.vouchers += item.amount;
                changed = true;
            }
        });

        if (changed) {
            AuthManager.saveData();
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
            'LEGENDARY': '傳說'
        };
        return map[rarity] || rarity;
    }
};

// CSS 動畫需要在 shop.css 中定義
// @keyframes pack-shake { ... }

window.PackOpener = PackOpener;
