/**
 * card_renderer.js
 * 檔案用途: 統一的卡牌渲染組件，提供一致的卡牌 DOM 生成邏輯
 * 調用者: collection_manager.js, deck_builder, app.js 等所有需要顯示卡牌的模組
 * 
 * 此模組的結構完全匹配 app.js 中的 createCardEl 函數
 */

const CardRenderer = {
    /**
     * 創建卡牌 DOM 元素 (HTML 字串版本)
     * 完全匹配 createCardEl 的結構以確保視覺一致性
     * 
     * @param {Object} card - 卡牌資料物件 (來自 CARD_DATA)
     * @param {Object} options - 渲染選項
     * @param {boolean} options.isOwned - 是否已擁有此卡 (影響顯示方式)
     * @param {boolean} options.showDetails - 是否顯示完整資訊 (false 則隱藏部分內容)
     * @returns {string} 卡牌的 HTML 字串
     */
    createHTML(card, options = {}) {
        const {
            isOwned = true,
            showDetails = true
        } = options;

        if (!card) return '';

        const rarityClass = card.rarity ? card.rarity.toLowerCase() : 'common';
        const typeClass = card.type === 'NEWS' ? 'news-card' : '';

        // 費用 (採用 createCardEl 的簡潔結構)
        const costHtml = `<div class="card-cost"><span>${card.cost}</span></div>`;

        // 標題間距（給費用預留空間）- createCardEl line 2942
        const headerSpacerHtml = `<div style="width: 100%; height: 10px;"></div>`;

        // 名稱 - createCardEl line 2944
        const nameHtml = `<div class="card-title" style="margin: 2px 0; font-size: 10px; z-index: 5; text-shadow: 0 1px 2px #000;">${showDetails ? card.name : '???'}</div>`;

        // 圖片 - createCardEl line 2914-2916
        let artHtml = '';
        if (card.image && showDetails) {
            artHtml = `<div class="card-art-box" style="width: 100%; height: 55px; background: url('${card.image}') no-repeat center; background-size: cover; border-radius: 4px; margin: 2px 0; border: 1px solid #444; flex-shrink: 0; background-color: transparent;"></div>`;
        } else {
            artHtml = `<div class="card-art-box placeholder" style="width: 100%; height: 40px; background: #222; margin: 5px 0; flex-shrink: 0;"></div>`;
        }

        // 種族標籤 - createCardEl line 2948
        const categoryHtml = `<div class="card-category" style="margin: 2px 0; font-size: 7px;">${(card.category && showDetails) ? card.category : ''}</div>`;

        // 描述 - createCardEl line 2950
        const descHtml = `<div class="card-desc" style="font-size: 8px; line-height: 1.1; overflow: hidden; padding: 2px; flex-grow: 1; text-align: center; white-space: pre-wrap;">${showDetails ? (card.description || '') : '尚未解鎖'}</div>`;

        // 攻血數值 (僅隨從有) - createCardEl line 2880-2884
        let statsHtml = '';
        if (card.type === 'MINION') {
            const attackValue = showDetails ? card.attack : '?';
            const healthValue = showDetails ? card.health : '?';
            statsHtml = `
        <div class="minion-stats">
            <span class="stat-atk"><span>${attackValue}</span></span>
            <span class="stat-hp">${healthValue}</span>
        </div>`;
        }

        // 組合完整結構 - 匹配 createCardEl line 2938+
        // 使用與 createCardEl 完全相同的結構
        return `
            <div class="card rarity-${rarityClass} ${typeClass}" style="justify-content: flex-start; padding: 2px;">
                ${costHtml}
                ${headerSpacerHtml}
                ${nameHtml}
                ${artHtml}
                ${categoryHtml}
                ${descHtml}
                ${statsHtml}
            </div>
        `;
    },

    /**
     * 創建卡牌 DOM 元素 (DOM Element 版本)
     * @param {Object} card - 卡牌資料物件
     * @param {Object} options - 渲染選項
     * @returns {HTMLElement} 卡牌的 DOM 元素
     */
    createElement(card, options = {}) {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = this.createHTML(card, options);
        return wrapper.firstElementChild;
    }
};

// 全域暴露
window.CardRenderer = CardRenderer;
