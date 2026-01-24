/**
 * TutorialManager - Handles the New Player "Ko Wen-je" Guide
 */
class TutorialManager {
    constructor() {
        this.currentStep = 0;
        this.isActive = false;
        this.overlay = null;
        this.guide = null;
        this.dialog = null;
        this.backdrop = null;
        this.targetElement = null;

        // Steps Configuration
        // Steps Configuration
        this.steps = {
            1: {
                target: '.collection-entrance-btn',
                text: '這是存放卡牌的地方。',
                actionRequired: 'click', // wait for click on target
                view: 'main-menu' // expected view
            },
            2: {
                target: '.product-card[data-product="card-pack"] .btn-buy', // Specific buy button
                fallbackTarget: '#btn-shop', // If we are not in shop
                text: '這裡可以購買卡牌，購買完成會存進去卡牌庫，現在就來試抽一包吧。',
                actionRequired: 'click',
                view: 'shop-view'
            },
            3: {
                target: '#profile-vouchers-display', // Will need to find this in DOM
                text: '這是消費券，透過剛才的卡牌庫分解過多的牌獲得，也可以用來合成卡片。',
                actionRequired: 'next', // Click next button on dialog
                view: 'profile-view'
            },
            4: {
                target: '#profile-deck-list', // Or a create deck button
                text: '我們再來慢慢研發。',
                actionRequired: 'finish',
                view: 'profile-view'
            }
        };

        // Re-defining steps object fully if needed or just assuming it's closed in previous block? 
        // Wait, the previous block replaced createUI AND setupTarget, effectively removing the middle methods?
        // Ah, I replaced from createUI (line 57) to setupTarget end (line 266).
        // The middle methods checkTutorialStatus, startTutorial, goToStep were DELETED.
        // I need to put them back.
    }

    init() {
        if (!document.getElementById('tutorial-overlay')) {
            this.createUI();
        }
        this.overlay = document.getElementById('tutorial-overlay');
        this.guide = document.getElementById('tutorial-guide');
        this.dialog = this.overlay.querySelector('.tutorial-dialog');
    }

    // ... createUI is here ...

    /**
     * Check if tutorial needs to run for the user
     */
    checkTutorialStatus(user) {
        if (!user) return;

        // [New] Require nickname to be set before starting tutorial
        if (!user.nickname) {
            console.log('[Tutorial] Skipping check: Nickname not set yet.');
            return;
        }

        if (!user.stats) user.stats = {};
        const level = user.level || 1;
        const progress = user.stats.tutorial_progress || 0;
        console.log(`[Tutorial] Checking status: Lv.\${level}, Progress: \${progress}`);
        if (level === 1 && progress < 5) {
            this.startTutorial(progress);
        }
    }

    startTutorial(savedProgress) {
        // [Failsafe] Only run tutorial if Main Menu is visible
        const mainMenu = document.getElementById('main-menu');
        if (mainMenu && window.getComputedStyle(mainMenu).display === 'none') {
            console.warn('[Tutorial] Aborted: Main Menu not visible.');
            return;
        }

        this.isActive = true;
        this.init();

        // If starting fresh (progress 0 or less), play intro first
        if (savedProgress <= 0) {
            this.playIntroSequence();
        } else {
            this.goToStep(savedProgress);
        }
    }

    playIntroSequence() {
        // Ensure guide is active
        if (this.guide) this.guide.classList.add('active');

        // Ensure reset mask (full cover)
        this.resetMask();

        // 1. Hello
        const nickname = (AuthManager.currentUser && AuthManager.currentUser.nickname)
            ? AuthManager.currentUser.nickname
            : ((AuthManager.currentUser && AuthManager.currentUser.username) ? AuthManager.currentUser.username : "玩家");

        this.updateDialog(`尊敬的${nickname}你好`);
        this.showNextButton(() => {
            // 2. Welcome
            this.updateDialog("歡迎來到寶島遊戲王");
            this.showNextButton(() => {
                // 3. Intro
                this.updateDialog("現在阿北帶你簡單介紹一下環境");
                this.showNextButton(() => {
                    // Start actual tutorial
                    this.goToStep(1);
                });
            });
        });
    }

    async goToStep(stepIndex) {
        this.currentStep = stepIndex;
        console.log(`[Tutorial] Starting Step ${stepIndex}`);

        if (AuthManager.currentUser) {
            if (!AuthManager.currentUser.stats) AuthManager.currentUser.stats = {};
            AuthManager.currentUser.stats.tutorial_progress = stepIndex;
            AuthManager.saveData();
        }

        const stepConfig = this.steps[stepIndex];
        if (!stepConfig) {
            this.completeTutorial();
            return;
        }

        // Note: active class on backdrop triggers opacity, but we use masks now.
        // We still need guide active
        if (this.guide) this.guide.classList.add('active');

        // Logic for steps
        if (stepIndex === 1) {
            if (typeof showView === 'function') showView('main-menu');
            this.setupTarget('.collection-entrance-btn', stepConfig.text);
            this.addOneTimeClick('.collection-entrance-btn', () => {
                setTimeout(() => {
                    // In Collection View:
                    this.hideHighlights(); // Hides the dark mask (User requested no dark background)

                    // Specific blocking for Back Button
                    this.blockElement('#btn-collection-back');

                    this.updateDialog("在這裡可以查看所有獲得的卡牌。");
                    this.showNextButton(() => {
                        this.clearBlockers(); // Unblock
                        this.advance();
                    });
                }, 500);
            });
        }
        else if (stepIndex === 2) {
            if (document.getElementById('collection-view') && document.getElementById('collection-view').style.display !== 'none') {
                if (document.getElementById('btn-collection-back')) document.getElementById('btn-collection-back').click();
            }
            if (typeof showView === 'function') showView('main-menu');

            this.setupTarget('.shop-entrance-btn', "我們去商店看看吧！");
            this.addOneTimeClick('.shop-entrance-btn', () => {
                setTimeout(() => {
                    this.setupTarget('.product-card[data-product="card-pack"] .btn-buy', "這裡可以購買卡牌，購買完成會存進去卡牌庫。");
                    this.addOneTimeClick('.product-card[data-product="card-pack"] .btn-buy', () => {
                        this.hideHighlights();
                        // Wait for pack opening animation to finish and close button to appear
                        this.waitForElement('#btn-pack-done.visible', (btn) => {
                            this.setupTarget('#btn-pack-done', "點擊完成繼續");
                            this.addOneTimeClick('#btn-pack-done', () => {
                                this.hideHighlights();
                                setTimeout(() => {
                                    this.advance();
                                }, 500);
                            });
                        });
                    });
                }, 500);
            });
        }
        else if (stepIndex === 3) {
            if (document.getElementById('shop-view') && document.getElementById('shop-view').style.display !== 'none') {
                if (typeof showView === 'function') showView('main-menu');
            }
            this.setupTarget('#btn-main-profile', "前往個人頁面查看詳細資訊。");
            this.addOneTimeClick('#btn-main-profile', () => {
                setTimeout(() => {
                    this.blockElement('#btn-profile-back'); // Block back button here too
                    this.setupTarget('.profile-vouchers-display', "這是消費券，透過剛才的卡牌庫分解過多的牌獲得，也可以用來合成卡片。");
                    this.showNextButton(() => {
                        this.clearBlockers();
                        this.advance();
                    });
                }, 500);
            });
        }
        else if (stepIndex === 4) {
            this.setupTarget('.deck-management', "我們再來慢慢研發。");
            this.showNextButton(() => {
                this.completeTutorial();
            });
        }
    }

    init() {
        // Create UI elements if they don't exist
        if (!document.getElementById('tutorial-overlay')) {
            this.createUI();
        }
        this.overlay = document.getElementById('tutorial-overlay');
        this.backdrop = this.overlay.querySelector('.tutorial-backdrop');
        this.guide = document.getElementById('tutorial-guide');
        this.dialog = this.overlay.querySelector('.tutorial-dialog');
    }

    createUI() {
        const container = document.createElement('div');
        container.id = 'tutorial-overlay';
        container.innerHTML = `
            <div id="mask-top" class="tutorial-mask"></div>
            <div id="mask-bottom" class="tutorial-mask"></div>
            <div id="mask-left" class="tutorial-mask"></div>
            <div id="mask-right" class="tutorial-mask"></div>
            <div id="tutorial-spotlight" class="tutorial-spotlight-border"></div>
            
            <div id="tutorial-guide">
                <img src="assets/images/ko_guide.png" alt="Guide">
            </div>
            <div class="tutorial-dialog">
                <div class="tutorial-dialog-content"></div>
            </div>
        `;
        // Always append to body for fixed positioning relative to viewport
        document.body.appendChild(container);
    }

    blockElement(selector) {
        const el = document.querySelector(selector);
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const blocker = document.createElement('div');
        blocker.className = 'tutorial-blocker';
        blocker.style.top = `${rect.top}px`;
        blocker.style.left = `${rect.left}px`;
        blocker.style.width = `${rect.width}px`;
        blocker.style.height = `${rect.height}px`;

        let container = document.getElementById('tutorial-blockers-container');
        if (!container) {
            // fallback if UI not updated yet
            this.overlay.appendChild(document.createElement('div')).id = 'tutorial-blockers-container';
            container = document.getElementById('tutorial-blockers-container');
        }
        container.appendChild(blocker);
    }

    clearBlockers() {
        const container = document.getElementById('tutorial-blockers-container');
        if (container) container.innerHTML = '';
    }

    hideHighlights() {
        if (!this.overlay) return;
        this.stopTracking(); // Stop loop
        const masks = this.overlay.querySelectorAll('.tutorial-mask');
        masks.forEach(m => m.style.display = 'none');
        const spotlight = this.overlay.querySelector('#tutorial-spotlight');
        if (spotlight) spotlight.style.display = 'none';
        this.targetElement = null;
    }

    setupTarget(selector, text) {
        // Clean up previous highlight styles (if any remained)
        if (this.targetElement) {
            this.targetElement.classList.remove('tutorial-highlight');
        }

        this.targetElement = document.querySelector(selector);

        if (this.targetElement) {
            // Scroll to target first
            this.targetElement.scrollIntoView({ behavior: "smooth", block: "center" });

            // Wait a bit for scroll/render, then update mask
            setTimeout(() => this.updateMask(), 300);

            // Add resize listener to keep mask updated
            if (!this.resizeListener) {
                this.resizeListener = () => this.updateMask();
                window.addEventListener('resize', this.resizeListener);
                window.addEventListener('scroll', this.resizeListener);
            }

            // Start animation loop to track moving elements
            this.startTracking();
        } else {
            console.warn(`[Tutorial] Target not found: ${selector}`);
            // If target not found, maybe just full mask?
            this.resetMask();
        }

        this.updateDialog(text);
    }

    startTracking() {
        if (this.trackingRaf) cancelAnimationFrame(this.trackingRaf);
        const loop = () => {
            if (this.targetElement && this.isActive) {
                this.updateMask();
                this.trackingRaf = requestAnimationFrame(loop);
            }
        };
        this.trackingRaf = requestAnimationFrame(loop);
    }

    stopTracking() {
        if (this.trackingRaf) {
            cancelAnimationFrame(this.trackingRaf);
            this.trackingRaf = null;
        }
    }

    updateMask() {
        if (!this.overlay || !this.targetElement) return;

        const rect = this.targetElement.getBoundingClientRect();
        const spotlight = this.overlay.querySelector('#tutorial-spotlight');
        const masks = this.overlay.querySelectorAll('.tutorial-mask');

        // Ensure visible
        masks.forEach(m => m.style.display = 'block');
        spotlight.style.display = 'block';

        const maskTop = this.overlay.querySelector('#mask-top');
        const maskBottom = this.overlay.querySelector('#mask-bottom');
        const maskLeft = this.overlay.querySelector('#mask-left');
        const maskRight = this.overlay.querySelector('#mask-right');

        const pad = 15; // Increased padding for better clearance

        // Spotlight Border
        spotlight.style.top = `${rect.top - pad}px`;
        spotlight.style.left = `${rect.left - pad}px`;
        spotlight.style.width = `${rect.width + pad * 2}px`;
        spotlight.style.height = `${rect.height + pad * 2}px`;
        spotlight.style.display = 'block';

        // Masks Logic
        // Top: 0 to rect.top-pad
        maskTop.style.top = '0';
        maskTop.style.left = '0';
        maskTop.style.width = '100%';
        maskTop.style.height = `${Math.max(0, rect.top - pad)}px`;

        // Bottom: rect.bottom+pad to 100%
        maskBottom.style.top = `${rect.bottom + pad}px`;
        maskBottom.style.left = '0';
        maskBottom.style.width = '100%';
        maskBottom.style.height = `calc(100vh - ${rect.bottom + pad}px)`;

        // Left: 0 to rect.left-pad (vertical bound by top/bottom masks??)
        // Simplest strategy: Top/Bottom cover full width. Left/Right cover middle band.

        maskLeft.style.top = `${rect.top - pad}px`;
        maskLeft.style.left = '0';
        maskLeft.style.width = `${Math.max(0, rect.left - pad)}px`;
        maskLeft.style.height = `${rect.height + pad * 2}px`;

        // Right: rect.right+pad to 100%
        maskRight.style.top = `${rect.top - pad}px`;
        maskRight.style.left = `${rect.right + pad}px`;
        maskRight.style.width = `calc(100vw - ${rect.right + pad}px)`;
        maskRight.style.height = `${rect.height + pad * 2}px`;
    }

    resetMask() {
        // Cover everything if no target
        const maskTop = this.overlay.querySelector('#mask-top');
        const masks = this.overlay.querySelectorAll('.tutorial-mask');
        if (maskTop) {
            // Ensure visible
            masks.forEach(m => m.style.display = 'block');

            maskTop.style.top = '0';
            maskTop.style.left = '0';
            maskTop.style.width = '100vw';
            maskTop.style.height = '100vh';

            // Hide others to avoid overlaps (though z-index stack is same)
            const otherMasks = [
                this.overlay.querySelector('#mask-bottom'),
                this.overlay.querySelector('#mask-left'),
                this.overlay.querySelector('#mask-right')
            ];
            otherMasks.forEach(m => {
                if (m) m.style.display = 'none';
            });

            // Hide spotlight
            const spotlight = this.overlay.querySelector('#tutorial-spotlight');
            if (spotlight) spotlight.style.display = 'none';
        }
    }

    updateDialog(text) {
        const content = this.dialog.querySelector('.tutorial-dialog-content');
        content.innerHTML = text;
        this.dialog.classList.add('active');
        // Remove any existing next button logic from previous calls if simple text update
        const existBtn = this.dialog.querySelector('.btn-tutorial-next');
        if (existBtn) existBtn.remove();
    }

    showNextButton(callback) {
        let btn = this.dialog.querySelector('.btn-tutorial-next');
        if (!btn) {
            btn = document.createElement('button');
            btn.className = 'btn-tutorial-next';
            btn.innerText = '下一步';
            this.dialog.appendChild(btn);
        }
        // Clone to remove old listeners
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);

        newBtn.onclick = (e) => {
            e.stopPropagation();
            newBtn.remove(); // Remove button after click
            callback();
        };
    }

    addOneTimeClick(selector, callback) {
        const el = document.querySelector(selector);
        if (!el) return;

        const handler = (e) => {
            // e.preventDefault(); // Don't prevent default, allow navigation?
            // If we allow navigation, the view changes.
            // We usually want to detect the action.

            // Remove highlight
            el.classList.remove('tutorial-highlight');
            el.removeEventListener('click', handler);

            callback();
        };

        el.addEventListener('click', handler);
    }

    advance() {
        const next = this.currentStep + 1;
        this.goToStep(next);
    }

    waitForElement(selector, callback) {
        const check = () => {
            const el = document.querySelector(selector);
            // Ensure element exists AND is visible (display not none)
            if (el && el.offsetParent !== null) {
                callback(el);
            } else {
                requestAnimationFrame(check);
            }
        };
        check();
    }

    completeTutorial() {
        console.log('[Tutorial] Completed!');
        this.isActive = false;

        // Hide UI
        if (this.guide) this.guide.classList.remove('active');
        if (this.dialog) this.dialog.classList.remove('active');
        this.resetMask();
        if (this.targetElement) this.targetElement.classList.remove('tutorial-highlight');

        // Grant Rewards
        if (AuthManager.currentUser) {
            AuthManager.currentUser.stats.tutorial_progress = 5; // Completed

            // Grant XP to Lv 2
            // Lv 1 -> Lv 2 need 20 XP usually.
            // Let's just set Level to 2 directly as per user request "升 to 2級"
            if (AuthManager.currentUser.level < 2) {
                AuthManager.currentUser.level = 2;
                AuthManager.currentUser.currentXP = 0; // Reset XP?
                console.log('[Tutorial] Level Up to 2!');
                // Show level up (Optional UI, but system is updated)
            }

            AuthManager.saveData();
        }
    }
}

// Export instance
window.tutorialManager = new TutorialManager();
