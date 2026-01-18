/**
 * shop_manager.js
 * 檔案用途: 商店系統核心邏輯
 * 調用者: app.js
 */

const ShopManager = {
    products: {
        'card-pack': {
            name: '卡牌包',
            price: 100,
            type: 'CARDS',
            rewards: { cardCount: 5 }
        },
        'cosmetic-pack': {
            name: '酷炫包',
            price: 150,
            type: 'COSMETICS',
            rewards: { itemCount: 2 }
        }
    },

    /**
     * 購買商品
     */
    buyProduct(productId) {
        const product = this.products[productId];
        const user = AuthManager.currentUser;

        if (!user) {
            showToast('請先登入');
            return false;
        }

        // 檢查金幣
        if (user.gold < product.price) {
            showToast('金幣不足！');
            return false;
        }

        // 扣除金幣
        user.gold -= product.price;
        this.updateGoldDisplay();
        AuthManager.saveData();

        // 開包
        PackOpener.open(product);
        return true;
    },

    /**
     * 更新所有金幣顯示
     */
    updateGoldDisplay() {
        const user = AuthManager.currentUser;
        if (!user) return;

        const shopGold = document.getElementById('shop-gold-amount');
        const profileGold = document.getElementById('profile-gold-amount');

        if (shopGold) shopGold.textContent = user.gold;
        if (profileGold) profileGold.textContent = user.gold;
    }
};

// 暴露到 window
window.ShopManager = ShopManager;
