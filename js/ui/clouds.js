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
        this.maxClouds = 5; // 最大雲朵數量
        this.init();
    }

    init() {
        // 建立雲朵容器
        this.container = document.createElement('div');
        this.container.id = 'cloud-container';
        this.container.style.display = 'none';

        // 預先生成一些雲朵（減少數量）
        for (let i = 0; i < 3; i++) {
            this.spawnCloud(Math.random() * 100);
        }

        // 持續生成新雲朵（增加間隔時間）
        setInterval(() => {
            // 檢查雲朵數量，避免過多
            if (this.container.children.length < this.maxClouds) {
                this.spawnCloud();
            }
        }, 12000 + Math.random() * 8000); // 12-20秒生成一次

        // 初始化時根據目前視圖判斷是否顯示
        setTimeout(() => {
            const currentView = window.currentViewId || (document.getElementById('auth-view').style.display !== 'none' ? 'auth-view' : 'main-menu');
            this.updateView(currentView);
        }, 100);

        // 監聽視窗大小變化，重新調整雲朵動畫
        window.addEventListener('resize', () => this.handleResize());
    }

    spawnCloud(initialOffsetPercent = null) {
        const cloud = document.createElement('img');
        const imgPath = this.cloudImages[Math.floor(Math.random() * this.cloudImages.length)];

        cloud.src = imgPath;
        cloud.className = 'cloud';

        // 隨機屬性
        const size = 150 + Math.random() * 250; // 150px ~ 400px
        const top = Math.random() * 40; // 0% ~ 40% (上半部)
        const duration = 80 + Math.random() * 40; // 80-120秒
        const zIndex = Math.floor(Math.random() * 3); // 簡單的層次感

        cloud.style.width = `${size}px`;
        cloud.style.height = 'auto';
        cloud.style.top = `${top}%`;
        cloud.style.opacity = '0.8'; // 稍微透明
        cloud.style.zIndex = zIndex;
        cloud.style.position = 'absolute';

        // 關鍵：從右邊開始，使用 transform 而非 left
        cloud.style.left = '100%'; // 從畫面右側外開始
        cloud.style.transform = 'translateX(0)';

        // 使用 CSS 變數來控制動畫終點
        const animationDistance = window.innerWidth + size; // 畫面寬度 + 雲朵寬度
        cloud.style.setProperty('--animation-distance', `-${animationDistance}px`);

        // 動畫設定：從右到左
        cloud.style.animation = `cloud-move-responsive ${duration}s linear infinite`;

        if (initialOffsetPercent !== null) {
            const delay = -(initialOffsetPercent / 100) * duration;
            cloud.style.animationDelay = `${delay}s`;
        }

        this.container.appendChild(cloud);

        // 動畫結束後重新定位
        cloud.addEventListener('animationiteration', () => {
            this.repositionCloud(cloud);
        });

        // 動畫結束後移除雲朵，避免累積
        setTimeout(() => {
            if (cloud.parentElement) {
                cloud.remove();
            }
        }, duration * 1000);
    }

    repositionCloud(cloud) {
        // 微調高度以增加隨機感
        cloud.style.top = `${Math.random() * 40}%`;

        // 更新動畫距離
        const size = parseFloat(cloud.style.width);
        const animationDistance = window.innerWidth + size;
        cloud.style.setProperty('--animation-distance', `-${animationDistance}px`);
    }

    handleResize() {
        // 視窗大小改變時，更新所有雲朵的動畫距離
        const clouds = this.container.querySelectorAll('.cloud');
        clouds.forEach(cloud => {
            const size = parseFloat(cloud.style.width);
            const animationDistance = window.innerWidth + size;
            cloud.style.setProperty('--animation-distance', `-${animationDistance}px`);
        });
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