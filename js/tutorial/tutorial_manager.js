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
        this.steps = {
            1: {
                target: '.collection-entrance-btn',
                text: '這是存放卡牌的地方。',
                actionRequired: 'click',
                view: 'main-menu'
            },
            2: {
                target: '.product-card[data-product="card-pack"] .btn-buy',
                text: '這裡可以購買卡牌，購買完成會存進去卡牌庫，現在就來試抽一包吧。',
                actionRequired: 'click',
                view: 'shop-view'
            },
            3: {
                target: '#profile-vouchers-display',
                text: '這是消費券，透過剛才的卡牌庫分解過多的牌獲得，也可以用來合成卡片。',
                actionRequired: 'next',
                view: 'profile-view'
            },
            4: {
                target: '.add-deck-item',
                text: '我們來組一副套牌吧！點擊這裡新增牌組。',
                actionRequired: 'click',
                view: 'profile-view'
            },
            5: {
                target: '#btn-create-custom',
                text: '選擇「自由組建」來開始打造你的專屬牌組。',
                actionRequired: 'click',
                view: 'profile-view'
            },
            6: {
                target: '#all-cards-grid',
                text: '這裡是牌組編輯器。左邊是所有卡牌，右邊是你目前的牌組。',
                actionRequired: 'next',
                view: 'deck-builder'
            },
            7: {
                target: '#my-deck-list',
                text: '一副牌組需要由 30 張卡牌組成。每種卡牌最多放 2 張，傳說卡牌只能放 2 張(總數)。',
                actionRequired: 'next',
                view: 'deck-builder'
            },
            8: {
                target: '#btn-auto-build',
                text: '為了節省時間，阿北幫你用「一鍵組成」功能快速完成。',
                actionRequired: 'click',
                view: 'deck-builder'
            },
            9: {
                target: '#btn-custom-confirm',
                text: '按下確定，讓阿北幫你補滿！',
                actionRequired: 'click',
                view: 'deck-builder'
            },
            10: {
                target: '#btn-save-deck',
                text: '組好之後，記得保存喔！',
                actionRequired: 'click',
                view: 'deck-builder'
            },
            11: {
                target: '#btn-builder-back',
                text: '保存成功，點擊返回離開編輯器。',
                actionRequired: 'click',
                view: 'deck-builder'
            },
            12: {
                target: '#btn-profile-back',
                text: '現在回到大廳。',
                actionRequired: 'click',
                view: 'profile-view'
            },
            13: {
                target: '#btn-main-battle',
                text: '準備好了嗎？讓我們開始第一場戰鬥吧！',
                actionRequired: 'click',
                view: 'main-menu'
            },
            14: {
                target: '#btn-mode-ai',
                text: '選擇電腦對戰模式',
                actionRequired: 'click',
                view: 'mode-selection'
            },
            15: {
                target: '.option-item[data-deck-id="dpp2"]', // Tsai Ing-wen
                text: '選擇你的對手：蔡英文',
                actionRequired: 'click',
                view: 'ai-battle-setup'
            },
            16: {
                target: '.deck-option-group.expanded .sub-difficulty-btn[data-value="NORMAL"]', // Normal difficulty
                text: '選擇普通難度',
                actionRequired: 'click',
                view: 'ai-battle-setup'
            },
            17: {
                target: '#btn-start-ai-battle',
                text: '開始戰鬥！',
                actionRequired: 'finish',
                view: 'ai-battle-setup'
            }
        };
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
        console.log(`[Tutorial] Checking status: Lv.${level}, Progress: ${progress}`);
        if (level === 1 && progress < 17) { // Back to 17 steps (removed 1, added 1)
            this.startTutorial(progress);
        }
    }

    startTutorial(savedProgress) {
        // [Failsafe] Only run tutorial if Main Menu is visible
        const mainMenu = document.getElementById('main-menu');
        // Allow resuming from Profile (step 3/4)
        const profileView = document.getElementById('profile-view');

        const isMainMenu = mainMenu && window.getComputedStyle(mainMenu).display !== 'none';
        const isProfileView = profileView && window.getComputedStyle(profileView).display !== 'none';

        if (!isMainMenu && !isProfileView && savedProgress < 4) {
            console.warn('[Tutorial] Aborted: Not in Main Menu or Profile.');
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

        // Do NOT call hideHighlights here to allow smooth gliding between steps
        // The individual step setup will handle positioning and visibility.
        this.updateDialog(stepConfig.text || stepConfig.dialog); // Use dialog if text is not present

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
                // Check if back button exists, otherwise force showView
                const backBtn = document.getElementById('btn-shop-back');
                if (backBtn) backBtn.click();
                else if (typeof showView === 'function') showView('main-menu');
            }
            // Ensure we are in main menu before targeting profile button
            setTimeout(() => {
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
            }, 300);
        }
        else if (stepIndex === 4) { // Add Deck
            const selector = '.add-deck-item';
            const text = "我們來組一副套牌吧！點擊這裡新增牌組。";

            this.waitForElement(selector, () => {
                this.setupTarget(selector, text);

                const handler = (e) => {
                    if (e.target.closest(selector)) {
                        document.removeEventListener('click', handler, true);
                        this.hideHighlights();
                        setTimeout(() => this.advance(), 500);
                    }
                };
                document.addEventListener('click', handler, true);
            });
        }
        else if (stepIndex === 5) { // Modal: Click Custom Build
            const selector = '#btn-create-custom';
            this.waitForElement(selector, () => {
                this.setupTarget(selector, stepConfig.text);
                this.addOneTimeClick(selector, () => {
                    this.advance();
                });
            });
        }
        else if (stepIndex === 6) { // Deck Builder Intro
            this.waitForElement('#deck-builder', (el) => {
                if (window.getComputedStyle(el).display === 'none') return;
                this.setupTarget('#all-cards-grid', stepConfig.text);
                this.showNextButton(() => this.advance());
            });
        }
        else if (stepIndex === 7) { // Rules
            this.setupTarget('#my-deck-list', stepConfig.text);
            this.showNextButton(() => this.advance());
        }
        else if (stepIndex === 8) { // One Click Build
            const selector = '#btn-auto-build';
            this.waitForElement(selector, () => {
                this.setupTarget(selector, stepConfig.text);
                this.addOneTimeClick(selector, () => {
                    setTimeout(() => this.advance(), 800);
                });
            });
        }
        else if (stepIndex === 9) { // Confirm Modal
            const selector = '#btn-custom-confirm';
            this.waitForElement(selector, () => {
                this.setupTarget(selector, stepConfig.text);
                this.addOneTimeClick(selector, () => {
                    setTimeout(() => this.advance(), 1000);
                });
            });
        }
        else if (stepIndex === 10) { // Save
            const selector = '#btn-save-deck';
            this.waitForElement(selector, () => {
                this.setupTarget(selector, stepConfig.text);
                this.addOneTimeClick(selector, () => this.advance());
            });
        }
        else if (stepIndex === 11) { // Back from Builder
            const selector = '#btn-builder-back';
            this.waitForElement(selector, () => {
                this.setupTarget(selector, stepConfig.text);
                this.addOneTimeClick(selector, () => {
                    setTimeout(() => this.advance(), 500);
                });
            });
        }
        else if (stepIndex === 12) { // Back from Profile
            const selector = '#btn-profile-back';
            this.waitForElement(selector, () => {
                this.setupTarget(selector, stepConfig.text);
                this.addOneTimeClick(selector, () => {
                    setTimeout(() => this.advance(), 500);
                });
            });
        }
        else if (stepIndex === 13) { // Battle Intro
            const selector = '#btn-main-battle';
            this.waitForElement(selector, () => {
                this.setupTarget(selector, stepConfig.text);
                this.blockElement('#btn-main-profile');
                this.blockElement('#btn-shop');
                this.blockElement('#btn-collection');
                this.addOneTimeClick(selector, () => {
                    setTimeout(() => this.advance(), 500);
                });
            });
        }
        else if (stepIndex === 14) { // Mode AI
            const selector = '#btn-mode-ai';
            this.waitForElement(selector, () => {
                this.setupTarget(selector, stepConfig.text);
                this.addOneTimeClick(selector, () => {
                    setTimeout(() => this.advance(), 500);
                });
            });
        }
        else if (stepIndex === 15) { // Select Opponent
            const selector = '.option-item[data-deck-id="dpp2"]';
            this.waitForElement(selector, () => {
                this.setupTarget(selector, stepConfig.text);
                this.addOneTimeClick(selector, () => {
                    setTimeout(() => this.advance(), 500);
                });
            });
        }
        else if (stepIndex === 16) { // Difficulty
            const selector = '.deck-option-group.expanded .sub-difficulty-btn[data-value="NORMAL"]';
            this.waitForElement(selector, () => {
                this.setupTarget(selector, stepConfig.text);
                this.addOneTimeClick(selector, () => this.advance());
            });
        }
        else if (stepIndex === 17) { // Start
            const selector = '#btn-start-ai-battle';
            this.waitForElement(selector, () => {
                this.setupTarget(selector, stepConfig.text);
                this.addOneTimeClick(selector, () => {
                    this.clearBlockers();
                    this.completeTutorial();
                });
            });
        }
    }

    createUI() {
        const container = document.createElement('div');
        container.id = 'tutorial-overlay';

        // Add guide and dialog inside container
        container.innerHTML = `
            <div id="mask-top" class="tutorial-mask"></div>
            <div id="mask-bottom" class="tutorial-mask"></div>
            <div id="mask-left" class="tutorial-mask"></div>
            <div id="mask-right" class="tutorial-mask"></div>
            <div class="tutorial-spotlight-border"></div>
            
            <div id="tutorial-guide">
                <img src="assets/images/ko_guide.png" alt="Guide">
            </div>
            <div class="tutorial-dialog">
                <div class="tutorial-dialog-content"></div>
            </div>
            <div id="tutorial-blockers-container"></div>
        `;

        document.body.appendChild(container);

        this.overlay = container;
        this.guide = container.querySelector('#tutorial-guide');
        this.dialog = container.querySelector('.tutorial-dialog');
        this.masks = Array.from(container.querySelectorAll('.tutorial-mask'));
        this.spotlightBorder = container.querySelector('.tutorial-spotlight-border');

        // Initial state
        this.hideHighlights();
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

        const container = document.getElementById('tutorial-blockers-container');
        if (container) container.appendChild(blocker);
    }

    clearBlockers() {
        const container = document.getElementById('tutorial-blockers-container');
        if (container) container.innerHTML = '';
    }

    hideHighlights() {
        if (this.masks) {
            this.masks.forEach(mask => {
                mask.style.opacity = '0';
                mask.style.pointerEvents = 'none';
            });
        }
        if (this.spotlightBorder) {
            this.spotlightBorder.style.opacity = '0';
        }
        this.stopTracking();
        this.targetElement = null;
    }

    setupTarget(selector, text) {
        this.currentSelector = selector;

        if (this.targetElement) {
            this.targetElement.classList.remove('tutorial-highlight');

            const modalParent = this.targetElement.closest('.modal-overlay');
            if (modalParent && modalParent.dataset.originalZIndex !== undefined) {
                modalParent.style.zIndex = modalParent.dataset.originalZIndex;
                delete modalParent.dataset.originalZIndex;
            }

            const viewParent = this.targetElement.closest('.view');
            if (viewParent && viewParent.dataset.originalZIndex !== undefined) {
                viewParent.style.zIndex = viewParent.dataset.originalZIndex;
                delete viewParent.dataset.originalZIndex;
            }

            if (this.targetElement.dataset.originalPosition === 'static') {
                this.targetElement.style.position = '';
                delete this.targetElement.dataset.originalPosition;
            }
        }

        this.targetElement = document.querySelector(selector);

        if (this.targetElement) {
            this.targetElement.classList.add('tutorial-highlight');

            const modalParent = this.targetElement.closest('.modal-overlay');
            if (modalParent) {
                modalParent.dataset.originalZIndex = modalParent.style.zIndex;
                modalParent.style.zIndex = '100001';
            }

            const viewParent = this.targetElement.closest('.view');
            if (viewParent) {
                viewParent.dataset.originalZIndex = viewParent.style.zIndex;
                viewParent.style.zIndex = '100001';
            }

            const computedStyle = window.getComputedStyle(this.targetElement);
            if (computedStyle.position === 'static') {
                this.targetElement.dataset.originalPosition = 'static';
                this.targetElement.style.position = 'relative';
            }

            setTimeout(() => this.updateMask(), 300);

            if (!this.resizeListener) {
                this.resizeListener = () => this.updateMask();
                window.addEventListener('resize', this.resizeListener);
                window.addEventListener('scroll', this.resizeListener);
            }

            this.startTracking();
        } else {
            console.warn(`[Tutorial] Target not found: ${selector}`);
            this.resetMask();
        }

        this.updateDialog(text);
    }

    startTracking() {
        if (this.trackingRaf) cancelAnimationFrame(this.trackingRaf);
        const loop = () => {
            if (this.isActive) {
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
        if (!this.overlay) return;

        if ((!this.targetElement || !this.targetElement.isConnected) && this.currentSelector) {
            const freshEl = document.querySelector(this.currentSelector);
            if (freshEl && freshEl !== this.targetElement) {
                this.targetElement = freshEl;
                this.targetElement.classList.add('tutorial-highlight');
                const computedStyle = window.getComputedStyle(this.targetElement);
                if (computedStyle.position === 'static') {
                    this.targetElement.dataset.originalPosition = 'static';
                    this.targetElement.style.position = 'relative';
                }
            }
        }

        if (!this.targetElement || !this.targetElement.isConnected) {
            // During transitions, the old target might disappear before the new one is found.
            // If we are actively waiting for a new target (currentSelector is set), 
            // do NOT reset the mask instantly to avoid flickering.
            if (this.currentSelector) return;

            this.resetMask();
            return;
        }

        const rect = this.targetElement.getBoundingClientRect();

        if (rect.width === 0 || rect.height === 0) {
            if (this.targetElement) return;
        }

        if (this.masks) {
            this.masks.forEach(m => {
                m.style.opacity = '1';
                m.style.pointerEvents = 'auto';
            });
        }
        if (this.spotlightBorder) {
            this.spotlightBorder.style.opacity = '1';
        }

        const maskTop = this.overlay.querySelector('#mask-top');
        const maskBottom = this.overlay.querySelector('#mask-bottom');
        const maskLeft = this.overlay.querySelector('#mask-left');
        const maskRight = this.overlay.querySelector('#mask-right');

        const pad = 15;

        if (this.spotlightBorder) {
            this.spotlightBorder.style.top = `${rect.top - pad}px`;
            this.spotlightBorder.style.left = `${rect.left - pad}px`;
            this.spotlightBorder.style.width = `${rect.width + pad * 2}px`;
            this.spotlightBorder.style.height = `${rect.height + pad * 2}px`;
        }

        if (maskTop) {
            maskTop.style.top = '0';
            maskTop.style.left = '0';
            maskTop.style.width = '100%';
            maskTop.style.height = `${Math.max(0, rect.top - pad)}px`;
        }

        if (maskBottom) {
            maskBottom.style.top = `${rect.bottom + pad}px`;
            maskBottom.style.left = '0';
            maskBottom.style.width = '100%';
            maskBottom.style.height = `calc(100vh - ${rect.bottom + pad}px)`;
        }

        if (maskLeft) {
            maskLeft.style.top = `${rect.top - pad}px`;
            maskLeft.style.left = '0';
            maskLeft.style.width = `${Math.max(0, rect.left - pad)}px`;
            maskLeft.style.height = `${rect.height + pad * 2}px`;
        }

        if (maskRight) {
            maskRight.style.top = `${rect.top - pad}px`;
            maskRight.style.left = `${rect.right + pad}px`;
            maskRight.style.width = `calc(100vw - ${rect.right + pad}px)`;
            maskRight.style.height = `${rect.height + pad * 2}px`;
        }
    }

    resetMask() {
        if (this.masks) {
            this.masks.forEach(mask => {
                mask.style.opacity = '0';
                mask.style.pointerEvents = 'none';
            });
        }
        if (this.spotlightBorder) {
            this.spotlightBorder.style.opacity = '0';
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
            if (el) {
                const style = window.getComputedStyle(el);
                // Improved visibility check: include '0' string and very low values
                const opacity = parseFloat(style.opacity);
                const isVisible = style.display !== 'none' && style.visibility !== 'hidden' && opacity > 0;

                if (isVisible) {
                    const rect = el.getBoundingClientRect();
                    // Some elements might have width/height during transition but still be small
                    if (rect.width > 2 && rect.height > 2) {
                        callback(el);
                        return;
                    }
                }
            }
            requestAnimationFrame(check);
        };
        check();
    }

    completeTutorial() {
        console.log('[Tutorial] Completed!');
        this.isActive = false;

        // Hide UI completely to release frozen state
        if (this.overlay) {
            this.overlay.style.display = 'none';
        }
        if (this.guide) this.guide.classList.remove('active');
        if (this.dialog) this.dialog.classList.remove('active');
        this.resetMask();
        if (this.targetElement) {
            this.targetElement.classList.remove('tutorial-highlight');
        }

        // Grant Rewards
        if (AuthManager.currentUser) {
            AuthManager.currentUser.stats.tutorial_progress = 5; // Completed

            // User requested 500 gold
            AuthManager.currentUser.gold = (AuthManager.currentUser.gold || 0) + 500;

            // Grant XP to Lv 2
            if (AuthManager.currentUser.level < 2) {
                AuthManager.currentUser.level = 2;
                AuthManager.currentUser.currentXP = 0;
            }

            // Sync and update UI
            AuthManager.saveData();

            // Trigger UI updates (Globals from app.js)
            if (window.updatePlayerInfo) window.updatePlayerInfo();
            if (window.updateLevelDisplay) window.updateLevelDisplay();
            if (window.ShopManager && typeof window.ShopManager.updateGoldDisplay === 'function') {
                window.ShopManager.updateGoldDisplay();
            }

            // Show completion modal
            if (window.gameAlert) {
                window.gameAlert('恭喜完成新手導覽！獲得 500 金幣與等級提升！', '教學完成');
            } else {
                alert('恭喜完成新手導覽！獲得 500 金幣！');
            }
        }
    }
}

// Export instance
window.tutorialManager = new TutorialManager();
