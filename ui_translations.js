/**
 * 戰鬥提示詞集中管理
 */
window.UI_TEXT = {
    // 資源類
    INSUFFICIENT_MANA: "法力值不足！",

    //戰場類
    BOARD_FULL: "戰場太擠了，最多只能放 7 個從者！",

    // 攻擊驗證類
    CANNOT_ATTACK_SLEEPING: "這名隨從剛召喚，還不能攻擊！",
    ALREADY_ATTACKED: "此隨從本回合已經攻擊過了！",
    ATTACK_ZERO: "攻擊力為 0 的隨從無法發動攻擊！",
    LOCKED_CANNOT_ATTACK: "此隨從目前處於鎖定狀態，無法攻擊！",

    // 目標驗證類
    NO_VALID_TARGET: "目前沒有合法的目標！",
    INVALID_TARGET: "這不是有效的目標！",
    NEED_TAUNT_TARGET: "你必須先攻擊具有「嘲諷」技能的隨從！",

    // 卡牌操作類
    HAND_FULL: "手牌已滿！",
    PLAY_CANCELLED: "操作已取消",
    DISCARD_FAILED: "手牌不足以發動棄牌效果！",
    CANNOT_PLAY_CARD: "無法打出此卡！",
    BATTLECRY_CHOOSE_TARGET: "請選擇戰吼的目標！",
    SPELL_CHOOSE_TARGET: "請選擇目標！",

    // 系統狀態
    NOT_YOUR_TURN: "現在不是你的回合！",
    OPPONENT_THINKING: "對手正在思考中...",
    OPPONENT_PLAYS: "對手打出了：",
    CANCEL_PLAY_REFUND: "取消出牌 (隨從已退回)"
};
