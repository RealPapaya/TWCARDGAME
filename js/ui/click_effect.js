// 全局點擊特效 (Dust Effect)
document.addEventListener('click', function (e) {
    // 檢查是否點擊了卡片或其他重要互動元素，如果是則不顯示特效 (或者都顯示以增加打擊感)
    // 這裡我們簡單判定: 只要不是拖曳中，就顯示
    // 也可以判斷 class list

    // 如果點擊的是按鈕，可能不需要顯示灰塵，或者顯示不同效果
    // 但使用者要求 "點擊空白處"，所以我們嘗試過濾
    // 不過灰塵效果很淡，全域顯示也無妨，增加打擊感

    // 檢查是否在戰鬥畫面 (Battle View)
    const battleView = document.getElementById('battle-view');
    if (!battleView || getComputedStyle(battleView).display === 'none') {
        return;
    }

    // 嚴格僅在 "空白處" 觸發 (忽略卡片、按鈕、Modal)
    if (e.target.closest('.card') || e.target.closest('button') || e.target.closest('.minion') || e.target.closest('.modal')) {
        return;
    }

    const x = e.clientX;
    const y = e.clientY;

    // 產生 8-12 個微粒 (增加數量以形成"一團"的感覺)
    const count = 15 + Math.floor(Math.random() * 5);

    for (let i = 0; i < count; i++) {
        const p = document.createElement('div');
        p.className = 'dust-particle';

        // 設定初始位置 (微調偏移量，讓特效出現在滑鼠尖端右下方一點)
        p.style.left = (x + 10) + 'px';
        p.style.top = (y + 10) + 'px';

        // 設定隨機擴散方向與距離
        // "集中一點" -> 減少擴散距離
        const angle = Math.random() * Math.PI * 2;
        const dist = 10 + Math.random() * 20; // 範圍縮小到 10px - 30px

        const tx = Math.cos(angle) * dist + 'px';
        const ty = Math.sin(angle) * dist + 'px';

        p.style.setProperty('--tx', tx);
        p.style.setProperty('--ty', ty);

        // "灰塵感" -> 顆粒較小不規則
        const size = 2 + Math.random() * 4 + 'px';
        p.style.width = size;
        p.style.height = size;

        document.body.appendChild(p);

        // 動畫結束後移除
        setTimeout(() => {
            p.remove();
        }, 600);
    }
}, { capture: true });
