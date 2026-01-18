/**
 * shop_events.js
 * 檔案用途: 商店系統事件綁定
 * 調用者: index.html (在 app.js 之後載入)
 */

(function () {
    'use strict';

    function initShopEvents() {
        // 商店入口按鈕
        const btnShop = document.getElementById('btn-shop');
        if (btnShop) {
            btnShop.addEventListener('click', () => {
                showView('shop-view');
                ShopManager.updateGoldDisplay();
            });
        }

        // 商店返回按鈕
        const btnShopBack = document.getElementById('btn-shop-back');
        if (btnShopBack) {
            btnShopBack.addEventListener('click', () => {
                showView('main-menu');
            });
        }

        // 購買按鈕
        const buyButtons = document.querySelectorAll('.btn-buy');
        buyButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const card = btn.closest('.product-card');
                const productId = card.dataset.product;
                ShopManager.buyProduct(productId);
            });
        });

        // 關閉開包 Modal
        const btnClosePack = document.getElementById('btn-close-pack');
        if (btnClosePack) {
            btnClosePack.addEventListener('click', () => {
                const modal = document.getElementById('pack-opening-modal');
                modal.style.display = 'none';
            });
        }

        // 卡牌庫入口按鈕 (主選單)
        const btnCollection = document.getElementById('btn-collection');
        if (btnCollection) {
            btnCollection.addEventListener('click', () => {
                showView('collection-view');
                CollectionManager.renderCollection('all');
                CollectionManager.setupFilters();
            });
        }

        // 圖鑑返回按鈕
        const btnCollectionBack = document.getElementById('btn-collection-back');
        if (btnCollectionBack) {
            btnCollectionBack.addEventListener('click', () => {
                showView('main-menu');
            });
        }
    }

    // 初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initShopEvents);
    } else {
        initShopEvents();
    }
})();
