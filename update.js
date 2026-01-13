const UPDATE_LOG = [
    {
        version: "0.4.0",
        date: "2026-01-13",
        changes: [
            {
                type: "NEW_CARD",
                title: "新增卡牌",
                items: [
                    "卓榮泰", "大法官", "林佳龍", "8+9", "無期徒刑", "鉅額交保", "普發一萬", "停班停課", "王定宇"
                ]
            },
            {
                type: "MECHANIC",
                title: "新增機制",
                items: [
                    "LOCK_ALL_AND_BUFF_CATEGORY: 戰吼效果，鎖定全場並對特定種族進行增益。",
                    "UNLOCK_AND_BUFF_HEALTH: 戰吼效果，解除鎖定並增加生命。",
                    "ON_PLAY_NEWS (Heal): 觸發效果，支援在使用新聞牌時回復隨從生命，並附帶綠色回復數字特效。"
                ]
            }
        ]
    }
];

if (typeof window !== 'undefined') {
    window.UPDATE_LOG = UPDATE_LOG;
}
