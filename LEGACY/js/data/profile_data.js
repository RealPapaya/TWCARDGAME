/**
 * profile_data.js
 * 檔案用途: 儲存玩家頭像與稱號的資料庫
 * 調用者: app.js, collection_manager.js
 */

const PROFILE_DATA = {
    // 可用頭像資料
    AVATAR_DATA: [
        { id: 'avatar1', path: 'assets/images/avatars/avatar1.webp', name: '柯文哲' },
        { id: 'avatar2', path: 'assets/images/avatars/avatar2.webp', name: '蔡英文' },
        { id: 'avatar3', path: 'assets/images/avatars/avatar3.webp', name: '韓國瑜' },
        { id: 'avatar4', path: 'assets/images/avatars/avatar4.webp', name: '傅崐萁' }
    ],

    // 可用稱號資料
    TITLE_DATA: [
        { id: 'beginner', name: '菜鳥' },
        { id: 'salary_thief', name: '薪水小偷' },
        { id: 'monument_smoker', name: '古蹟抽菸' },
        { id: 'busy_worker', name: '活網仔' },
        { id: 'wehavemusic', name: '至少我們還有音樂' },
        { id: 'heartbroken_dog', name: '心碎小狗' },
        { id: 'sixty_seven', name: '67' },
        { id: 'salmon_dream', name: '張鮭魚之夢' },
        { id: 'how_pitiful', name: '可憐哪' },
        { id: 'kaohsiung_fortune', name: '高雄發大財' },
        { id: 'duck_blood_tofu', name: '鴨血豆腐鴨血豆腐' },
        { id: 'taoyuan_hsinchu', name: '你從桃園新竹' }
    ]
};

// 導出至全域
window.PROFILE_DATA = PROFILE_DATA;
