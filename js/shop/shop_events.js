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
    }

    // 初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initShopEvents);
    } else {
        initShopEvents();
    }
})();
