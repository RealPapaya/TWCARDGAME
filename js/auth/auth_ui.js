/**
 * AuthUI - Handling Login/Register View interactions
 */

/**
 * auth_ui.js
 * 檔案用途: 管理登入、註冊及登出介面的 DOM 互動
 * 相依性: auth_manager.js (執行身份證驗邏輯)
 * 調用者: index.html (透過 script 標籤載入)
 */
const AuthUI = {
    init() {
        this.cacheDOM();
        this.bindEvents();
    },

    cacheDOM() {
        this.view = document.getElementById("auth-view");
        this.tabLogin = document.getElementById("tab-login");
        this.tabRegister = document.getElementById("tab-register");
        this.formLogin = document.getElementById("form-login");
        this.formRegister = document.getElementById("form-register");

        this.loginUsernameField = document.getElementById("login-username");
        this.loginPasswordField = document.getElementById("login-password");
        this.regUsernameField = document.getElementById("reg-username");
        this.regPasswordField = document.getElementById("reg-password");
        this.regConfirmField = document.getElementById("reg-confirm-password");

        this.btnLogin = document.getElementById("btn-do-login");
        this.btnRegister = document.getElementById("btn-do-register");

    },

    bindEvents() {
        // Tab switching
        this.tabLogin.addEventListener("click", () => this.switchTab("login"));
        this.tabRegister.addEventListener("click", () => this.switchTab("register"));

        // Login Action
        this.btnLogin.addEventListener("click", () => this.handleLogin());

        // Register Action
        this.btnRegister.addEventListener("click", () => this.handleRegister());

        // Enter key support
        const handleEnter = (e) => {
            if (e.key === 'Enter') this.handleLogin();
        };
        this.loginUsernameField.addEventListener('keydown', handleEnter);
        this.loginPasswordField.addEventListener('keydown', handleEnter);
    },

    switchTab(type) {
        if (type === "login") {
            this.tabLogin.classList.add("active");
            this.tabRegister.classList.remove("active");
            this.formLogin.style.display = "flex";
            this.formRegister.style.display = "none";
        } else {
            this.tabLogin.classList.remove("active");
            this.tabRegister.classList.add("active");
            this.formLogin.style.display = "none";
            this.formRegister.style.display = "flex";
        }
    },

    async handleLogin() {
        const username = this.loginUsernameField.value.trim();
        const password = this.loginPasswordField.value.trim();

        if (!username || !password) {
            await showCustomAlert("請輸入帳號與密碼");
            return;
        }

        if (window.showLoadingIndicator) showLoadingIndicator("登入中...");
        this.btnLogin.disabled = true;
        this.btnLogin.innerText = "登入中...";

        try {
            const result = await AuthManager.login(username, password);
            if (window.hideLoadingIndicator) hideLoadingIndicator();

            if (result.success) {
                await showCustomAlert("登入成功！");
                // 載入使用者資料後導向主選單
                if (window.App) {
                    window.App.onUserLogin(result.user);
                }

                // [Tutorial] 檢查新手教學狀態
                if (window.tutorialManager) {
                    setTimeout(() => window.tutorialManager.checkTutorialStatus(result.user), 500);
                }
            } else {
                await showCustomAlert("登入失敗: " + result.message);
            }
        } catch (error) {
            console.error("Login Error:", error);
            if (window.hideLoadingIndicator) hideLoadingIndicator();
            await showCustomAlert("登入伺服器連線失敗");
        } finally {
            this.btnLogin.disabled = false;
            this.btnLogin.innerText = "確定登入";
            // if (window.hideLoadingIndicator) hideLoadingIndicator(); // Moved to try/catch
        }
    },

    async handleRegister() {
        const username = this.regUsernameField.value.trim();
        const password = this.regPasswordField.value.trim();
        const confirm = this.regConfirmField.value.trim();

        if (!username || !password) {
            await showCustomAlert("請填寫所有欄位");
            return;
        }

        if (password !== confirm) {
            await showCustomAlert("兩次輸入的密碼不一致");
            return;
        }

        if (window.showLoadingIndicator) showLoadingIndicator("註冊中...");
        this.btnRegister.disabled = true;
        this.btnRegister.innerText = "註冊中...";

        try {
            const result = await AuthManager.register(username, password);
            if (window.hideLoadingIndicator) hideLoadingIndicator();

            if (result.success) {
                await showCustomAlert("註冊請求已送出！請稍候再試著登入");
                this.switchTab("login");
            } else {
                await showCustomAlert("註冊失敗: " + result.message);
            }
        } catch (error) {
            console.error("Register Error:", error);
            if (window.hideLoadingIndicator) hideLoadingIndicator();
            await showCustomAlert("註冊連線失敗");
        } finally {
            this.btnRegister.disabled = false;
            this.btnRegister.innerText = "建立帳號";
            // if (window.hideLoadingIndicator) hideLoadingIndicator(); // Moved to try/catch
        }
    },

    reset() {
        if (this.loginUsernameField) this.loginUsernameField.value = "";
        if (this.loginPasswordField) this.loginPasswordField.value = "";
        if (this.regUsernameField) this.regUsernameField.value = "";
        if (this.regPasswordField) this.regPasswordField.value = "";
        if (this.regConfirmField) this.regConfirmField.value = "";
        this.switchTab("login");
    }
};

window.AuthUI = AuthUI;

// Initialize on load
document.addEventListener("DOMContentLoaded", () => {
    AuthUI.init();
});
