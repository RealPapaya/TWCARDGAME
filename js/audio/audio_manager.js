/**
 * AudioManager
 * 負責管理遊戲音效與背景音樂
 */
class AudioManager {
    constructor() {
        this.bgm = null;
        this.sfxVolume = parseFloat(localStorage.getItem('sfxVolume')) || 0.5;
        this.bgmVolume = parseFloat(localStorage.getItem('bgmVolume')) || 0.5;
        this.previousVolume = this.bgmVolume; // Store previous volume for mute toggle
    }

    /**
     * 載入背景音樂
     * @param {string} path - 音樂檔案路徑
     */
    loadBGM(path) {
        this.bgm = new Audio(path);
        this.bgm.loop = true;
        this.bgm.volume = this.bgmVolume;
    }

    /**
     * 播放背景音樂
     */
    play() {
        if (this.bgm) {
            this.bgm.play().catch(err => {
                console.warn('[AudioManager] 無法播放音樂:', err);
            });
        }
    }

    /**
     * 暫停背景音樂
     */
    pause() {
        if (this.bgm) {
            this.bgm.pause();
        }
    }

    /**
     * 停止背景音樂並重置播放位置
     */
    stop() {
        if (this.bgm) {
            this.bgm.pause();
            this.bgm.currentTime = 0;
        }
    }

    /**
     * 設定背景音樂音量
     * @param {number} value - 音量 (0-1)
     */
    setBGMVolume(value) {
        this.bgmVolume = Math.max(0, Math.min(1, value));
        if (this.bgm) {
            this.bgm.volume = this.bgmVolume;
        }
        localStorage.setItem('bgmVolume', this.bgmVolume);

        // Update previous volume if not muted
        if (this.bgmVolume > 0) {
            this.previousVolume = this.bgmVolume;
        }
    }

    /**
     * 獲取當前背景音樂音量
     * @returns {number} 音量 (0-1)
     */
    getBGMVolume() {
        return this.bgmVolume;
    }

    /**
     * 切換靜音狀態
     * @returns {boolean} 切換後的靜音狀態
     */
    toggleMute() {
        if (this.bgm) {
            if (this.bgm.volume > 0) {
                this.previousVolume = this.bgm.volume;
                this.bgm.volume = 0;
            } else {
                this.bgm.volume = this.previousVolume || this.bgmVolume;
            }
        }
        return this.isMuted();
    }

    /**
     * 檢查是否靜音
     * @returns {boolean} 是否靜音
     */
    isMuted() {
        return this.bgm ? this.bgm.volume === 0 : false;
    }

    /**
     * 播放音效
     * @param {string} path - 音效檔案路徑
     * @param {number} volumeMultiplier - 音量倍率 (預設 1.0)
     */
    playSFX(path, volumeMultiplier = 1.0) {
        const sfx = new Audio(path);
        sfx.volume = Math.min(1, this.sfxVolume * volumeMultiplier);
        sfx.play().catch(err => {
            console.warn('[AudioManager] 無法播放音效:', err);
        });
    }

    /**
     * 設定音效音量
     * @param {number} value - 音量 (0-1)
     */
    setSFXVolume(value) {
        this.sfxVolume = Math.max(0, Math.min(1, value));
        localStorage.setItem('sfxVolume', this.sfxVolume);
    }

    /**
     * 獲取當前音效音量
     * @returns {number} 音量 (0-1)
     */
    getSFXVolume() {
        return this.sfxVolume;
    }
}

// 全域單例
if (typeof window !== 'undefined') {
    window.AudioManager = AudioManager;
}
