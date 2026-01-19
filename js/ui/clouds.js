/**
 * clouds.js
 * 檔案用途: 處理封面的雲朵隨機生成與平移運動
 */

class CloudManager {
    constructor() {
        this.container = null;
        this.cloudImages = [
            'assets/images/backgrounds/Cloud (1).webp',
            'assets/images/backgrounds/Cloud (2).webp',
            'assets/images/backgrounds/Cloud (3).webp',
            'assets/images/backgrounds/Cloud (4).webp'
        ];
        this.init();
    }

    init() {
        // 建立雲朵容器但不先插入，由 updateView 決定位置
        this.container = document.createElement('div');
        this.container.id = 'cloud-container';
        this.container.style.display = 'none';

        // 預先生成一些雲朵
        for (let i = 0; i < 5; i++) {
            this.spawnCloud(Math.random() * 100);
        }

        // 持續生成新雲朵
        setInterval(() => this.spawnCloud(), 8000 + Math.random() * 5000);

        // 初始化時根據目前視圖判斷是否顯示
        setTimeout(() => {
            const currentView = window.currentViewId || (document.getElementById('auth-view').style.display !== 'none' ? 'auth-view' : 'main-menu');
            this.updateView(currentView);
        }, 100);
    }

    spawnCloud(initialOffsetPercent = null) {
        const cloud = document.createElement('img');
        const imgPath = this.cloudImages[Math.floor(Math.random() * this.cloudImages.length)];

        cloud.src = imgPath;
        cloud.className = 'cloud';

        // 隨機屬性
        const size = 200 + Math.random() * 300; // 200px ~ 500px
        const top = Math.random() * 40; // 0% ~ 40% (上半部)
        const duration = 100 + Math.random() * 60; // 
        const zIndex = Math.floor(Math.random() * 3); // 簡單的層次感

        cloud.style.width = `${size}px`;
        cloud.style.top = `${top}%`;
        cloud.style.opacity = '1'; // 不透明
        cloud.style.zIndex = zIndex;

        // 動畫設定
        cloud.style.animation = `cloud-move ${duration}s linear infinite`;

        if (initialOffsetPercent !== null) {
            const delay = -(initialOffsetPercent / 100) * duration;
            cloud.style.animationDelay = `${delay}s`;
        }

        this.container.appendChild(cloud);

        cloud.addEventListener('animationiteration', () => {
            this.repositionCloud(cloud);
        });
    }

    repositionCloud(cloud) {
        // 微調高度以增加隨機感
        cloud.style.top = `${Math.random() * 40}%`;
    }

    /**
     * 根據當前視圖更新雲朵可見性與位置
     * @param {string} viewId 
     */
    updateView(viewId) {
        if (!this.container) return;

        // 僅在封面相關視圖顯示：主選單(main-menu) 與 登入畫面(auth-view)
        const isCoverView = (viewId === 'main-menu' || viewId === 'auth-view');

        if (isCoverView) {
            const targetView = document.getElementById(viewId);
            if (targetView) {
                // 將容器移動到目標視圖的最前端，確保在背景圖之上，UI 之下
                if (this.container.parentElement !== targetView) {
                    targetView.insertBefore(this.container, targetView.firstChild);
                }
                this.container.style.display = 'block';
            }
        } else {
            this.container.style.display = 'none';
        }

        console.log(`[CloudManager] View updated to ${viewId}, active: ${isCoverView}`);
    }
}

// 當內容載入後啟動
window.addEventListener('load', () => {
    window.cloudManager = new CloudManager();
});
