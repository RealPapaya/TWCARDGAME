let gameEngine;
let gameState;
// Embedded Card Data to avoid CORS issues
const CARD_DATA = [
    // --- 民進黨 (DPP) ---
    { "id": "TW010", "name": "謝長廷", "category": "民進黨政治人物", "cost": 3, "attack": 3, "health": 3, "type": "MINION", "rarity": "EPIC", "description": "戰吼: 對一個非民進黨政治人物造成3點傷害", "keywords": { "battlecry": { "type": "DAMAGE_NON_CATEGORY", "value": 3, "target": { "side": "ALL", "type": "MINION" }, "target_category": "民進黨政治人物" } }, "image": "img/tw011.jpg" },
    { "id": "TW020", "name": "蔡英文", "category": "民進黨政治人物", "cost": 6, "attack": 4, "health": 4, "type": "MINION", "rarity": "LEGENDARY", "description": "戰吼:將對手場上卡牌全部放回手牌", "keywords": { "battlecry": { "type": "BOUNCE_ALL_ENEMY" } }, "image": "img/tw006.png" },

    // --- 國民黨 (KMT) ---
    { "id": "TW016", "name": "吳敦義", "category": "國民黨政治人物", "cost": 5, "attack": 1, "health": 3, "type": "MINION", "rarity": "EPIC", "description": "戰吼：深藍能量！賦予所有友方隨從 +1 攻擊力", "keywords": { "battlecry": { "type": "BUFF_ALL", "value": 1, "stat": "ATTACK" } }, "image": "img/tw002.png" },
    { "id": "TW023", "name": "陳玉珍", "category": "國民黨政治人物", "cost": 7, "attack": 3, "health": 8, "type": "MINION", "rarity": "EPIC", "description": "嘲諷。金門坦克", "keywords": { "taunt": true }, "image": "img/tw017.png" },
    { "id": "TW024", "name": "馬英九", "category": "國民黨政治人物", "cost": 9, "attack": 3, "health": 4, "type": "MINION", "rarity": "LEGENDARY", "description": "死亡之握\n戰吼: 直接擊殺一個隨從", "keywords": { "battlecry": { "type": "DESTROY", "target": { "side": "ALL", "type": "MINION" } } }, "image": "img/tw012.png" },
    { "id": "TW030", "name": "朱立倫", "category": "國民黨政治人物", "cost": 2, "attack": 1, "health": 1, "type": "MINION", "rarity": "COMMON", "description": "戰吼：對兩側單位 +1/+1", "keywords": { "battlecry": { "type": "BUFF_ADJACENT", "value": 1 } }, "image": "img/tw030.png" },
    { "id": "TW032", "name": "韓國瑜", "category": "國民黨政治人物", "cost": 3, "attack": 2, "health": 2, "type": "MINION", "rarity": "LEGENDARY", "description": "發財外交！！\n(回到手牌時永久獲得 +2/+2)", "image": "img/tw032.png" },
    { "id": "TW031", "name": "蔣萬安", "category": "國民黨政治人物", "cost": 3, "attack": 3, "health": 2, "type": "MINION", "rarity": "EPIC", "description": "臺北市正常上班上課\n戰吼：將一個隨從放回手牌", "keywords": { "battlecry": { "type": "BOUNCE_TARGET", "target": { "side": "ALL", "type": "MINION" } } }, "image": "img/tw031.png" },
    { "id": "TW033", "name": "郝龍斌", "category": "國民黨政治人物", "cost": 2, "attack": 1, "health": 2, "type": "MINION", "rarity": "RARE", "description": "擊潰丁守中！！\n(回到手牌時永久獲得 +1/+1)", "image": "img/tw033.png" },
    { "id": "TW034", "name": "趙少康", "category": "國民黨政治人物", "cost": 6, "attack": 2, "health": 2, "type": "MINION", "rarity": "EPIC", "description": "嘲諷+戰吼：消滅一個友方隨從並獲得其體質", "keywords": { "taunt": true, "battlecry": { "type": "EAT_FRIENDLY", "target": { "side": "FRIENDLY", "type": "MINION" } } }, "image": "img/tw034.png" },
    { "id": "TW035", "name": "江啟臣", "category": "國民黨政治人物", "cost": 3, "attack": 3, "health": 5, "type": "MINION", "rarity": "RARE", "description": "戰吼：丟棄一張隨機手牌", "keywords": { "battlecry": { "type": "DISCARD_RANDOM" } }, "image": "img/tw035.png" },
    { "id": "TW036", "name": "連勝文", "category": "國民黨政治人物", "cost": 4, "attack": 2, "health": 2, "type": "MINION", "rarity": "EPIC", "description": "政壇不死鳥\n遺志: 回到手牌", "keywords": { "deathrattle": { "type": "BOUNCE_SELF" } }, "image": "img/tw036.png" },

    // --- 民眾黨 (TPP) ---
    { "id": "TW011", "name": "柯文哲", "category": "民眾黨政治人物", "cost": 4, "attack": 3, "health": 3, "type": "MINION", "rarity": "LEGENDARY", "description": "戰吼：將自己戰場上的隨從血量全部回復", "keywords": { "battlecry": { "type": "HEAL_ALL_FRIENDLY" } }, "image": "img/tw001.png" },
    { "id": "TW014", "name": "黃瀞瑩", "category": "民眾黨政治人物", "cost": 4, "attack": 3, "health": 2, "type": "MINION", "rarity": "EPIC", "description": "戰吼：回復一個隨從3點血量", "keywords": { "battlecry": { "type": "HEAL", "value": 3, "target": { "side": "ALL", "type": "MINION" } } }, "image": "img/tw019.png" },
    { "id": "TW015", "name": "高虹安", "category": "民眾黨政治人物", "cost": 4, "attack": 3, "health": 3, "type": "MINION", "rarity": "EPIC", "description": "戰吼：賦予一個隨從「光盾」", "keywords": { "battlecry": { "type": "GIVE_DIVINE_SHIELD", "target": { "side": "ALL", "type": "MINION" } } }, "image": "img/tw020.png" },
    { "id": "TW019", "name": "陳珮琪", "category": "民眾黨政治人物", "cost": 4, "attack": 2, "health": 2, "type": "MINION", "rarity": "RARE", "description": "戰吼：將一個隨從生命回復全滿", "keywords": { "battlecry": { "type": "FULL_HEAL", "target": { "side": "ALL", "type": "MINION" } } }, "image": "img/peggy_chen.png" },
    { "id": "TW021", "name": "黃國昌", "category": "民眾黨政治人物", "cost": 7, "attack": 4, "health": 5, "type": "MINION", "rarity": "EPIC", "description": "衝鋒+激怒：+3攻擊。你在大聲甚麼！！！", "keywords": { "charge": true, "enrage": { "type": "BUFF_STAT", "stat": "ATTACK", "value": 3 } }, "image": "img/tw018.png" },
    { "id": "TW026", "name": "黃珊珊", "category": "民眾黨政治人物", "cost": 2, "attack": 1, "health": 1, "type": "MINION", "rarity": "RARE", "description": "珊言良語\n光盾+嘲諷", "keywords": { "divineShield": true, "taunt": true }, "image": "img/TW026.png" },
    { "id": "TW025", "name": "民眾黨黨部", "category": "民眾黨機關", "cost": 8, "attack": 0, "health": 4, "type": "MINION", "rarity": "EPIC", "description": "戰吼：賦予所有友方「民眾黨政治人物」光盾", "keywords": { "battlecry": { "type": "GIVE_DIVINE_SHIELD_CATEGORY", "target_category": "民眾黨政治人物" } }, "image": "img/TW025.png" },
    { "id": "TW028", "name": "京華城", "category": "建築", "cost": 6, "attack": 0, "health": 6, "type": "MINION", "rarity": "RARE", "description": "肖恩柯的救贖\n持續效果: 賦予左右兩側的隨從 +1/+1", "keywords": { "ongoing": { "type": "ADJACENT_BUFF_STATS", "value": 1 } }, "image": "img/tw028.png" },

    // --- 公眾人物 / 媒體 ---
    { "id": "TW012", "name": "四叉貓", "category": "公眾人物", "cost": 4, "attack": 1, "health": 1, "type": "MINION", "rarity": "RARE", "description": "戰吼：賦予所有友方隨從 +1 生命值", "keywords": { "battlecry": { "type": "BUFF_ALL", "value": 1, "stat": "HEALTH" } }, "image": "img/tw003.jpg" },
    { "id": "TW027", "name": "館長", "category": "公眾人物", "cost": 10, "attack": 3, "health": 8, "type": "MINION", "rarity": "RARE", "description": "要頭腦有肌肉\n激怒：+5攻擊", "keywords": { "enrage": { "type": "BUFF_STAT", "stat": "ATTACK", "value": 5 } }, "image": "img/TW027.png" },

    // --- 企業與組織 ---
    { "id": "TW017", "name": "勞工局", "category": "政府機關", "cost": 5, "attack": 0, "health": 5, "type": "MINION", "rarity": "EPIC", "description": "戰吼: 賦予所有\"勞工\"血量上限+2", "keywords": { "battlecry": { "type": "BUFF_CATEGORY", "value": 2, "stat": "HEALTH", "target_category": "勞工" } }, "image": "img/tw013.png" },
    { "id": "TW018", "name": "台積電", "category": "企業", "cost": 5, "attack": 0, "health": 10, "type": "MINION", "rarity": "EPIC", "description": "嘲諷+戰吼: 造成\"我方\"隨機一個單位2點傷害", "keywords": { "taunt": true, "battlecry": { "type": "DAMAGE_RANDOM_FRIENDLY", "value": 2 } }, "image": "img/tw016.png" },
    { "id": "TW029", "name": "沈慶京", "category": "企業家", "cost": 4, "attack": 2, "health": 3, "type": "MINION", "rarity": "EPIC", "description": "戰吼：賦予兩側的隨從「嘲諷」", "keywords": { "battlecry": { "type": "GIVE_KEYWORD_ADJACENT", "keyword": "taunt" } }, "image": "img/tw029.png" },

    // --- 一般隨從 (學生/勞工) ---
    { "id": "TW001", "name": "窮酸大學生", "category": "學生", "cost": 1, "attack": 1, "health": 2, "type": "MINION", "rarity": "COMMON", "description": "一個窮學生", "image": "img/c001.png" },
    { "id": "TW002", "name": "小草大學生", "category": "學生", "cost": 1, "attack": 1, "health": 1, "type": "MINION", "rarity": "COMMON", "description": "戰吼：對一個單位造成 1 點傷害", "keywords": { "battlecry": { "type": "DAMAGE", "value": 1, "target": { "side": "ALL", "type": "ALL" } } }, "image": "img/c004.png" },
    { "id": "TW003", "name": "大樓保全", "category": "勞工", "cost": 2, "attack": 1, "health": 2, "type": "MINION", "rarity": "COMMON", "description": "嘲諷", "keywords": { "taunt": true }, "image": "img/c002.png" },
    { "id": "TW004", "name": "條碼師", "category": "勞工", "cost": 2, "attack": 1, "health": 4, "type": "MINION", "rarity": "COMMON", "description": "五杯大冰拿", "image": "img/tw008.png" },
    { "id": "TW005", "name": "水電徒弟", "category": "勞工", "cost": 2, "attack": 2, "health": 3, "type": "MINION", "rarity": "COMMON", "description": "", "image": "img/tw010.png" },
    { "id": "TW006", "name": "廟口管委", "category": "勞工", "cost": 3, "attack": 3, "health": 2, "type": "MINION", "rarity": "COMMON", "description": "", "image": "img/c013.png" },
    { "id": "TW007", "name": "外送師", "category": "勞工", "cost": 3, "attack": 3, "health": 1, "type": "MINION", "rarity": "COMMON", "description": "我是外送師！！\n衝鋒", "keywords": { "charge": true }, "image": "img/tw007.png" },
    { "id": "TW008", "name": "手搖員工", "category": "勞工", "cost": 3, "attack": 2, "health": 2, "type": "MINION", "rarity": "RARE", "description": "戰吼: 回復一個單位2點血量", "keywords": { "battlecry": { "type": "HEAL", "value": 2, "target": { "side": "ALL", "type": "ALL" } } }, "image": "img/tw014.png" },
    { "id": "TW009", "name": "台積電工程師", "category": "勞工", "cost": 3, "attack": 2, "health": 2, "type": "MINION", "rarity": "RARE", "description": "激怒: 增加3點攻擊 極度耐操", "keywords": { "enrage": { "type": "BUFF_STAT", "stat": "ATTACK", "value": 3 } }, "image": "img/tw015.png" },
    { "id": "TW013", "name": "水電師傅", "category": "勞工", "cost": 4, "attack": 3, "health": 4, "type": "MINION", "rarity": "COMMON", "description": "嘲諷", "keywords": { "taunt": true }, "image": "img/tw009.png" },
    { "id": "TW022", "name": "老草中年", "category": "勞工", "cost": 2, "attack": 2, "health": 2, "type": "MINION", "rarity": "COMMON", "description": "光盾", "keywords": { "divineShield": true }, "image": "img/TW022.png" },

    // --- 新聞 (News) ---
    { "id": "S001", "name": "發票中獎", "category": "新聞", "cost": 2, "type": "NEWS", "rarity": "COMMON", "description": "抽 2 張牌", "keywords": { "battlecry": { "type": "DRAW", "value": 2 } }, "image": "img/tw004.png" },
    { "id": "S002", "name": "彈劾賴皇", "category": "新聞", "cost": 10, "type": "NEWS", "rarity": "EPIC", "description": "造成 10 點傷害。", "keywords": { "battlecry": { "type": "DAMAGE", "value": 10, "target": { "side": "ALL", "type": "ALL" } } }, "image": "img/tw005.png" },
    { "id": "S003", "name": "大罷免", "category": "新聞", "cost": 2, "type": "NEWS", "rarity": "COMMON", "description": "將一個政治人物放回手牌中", "keywords": { "battlecry": { "type": "BOUNCE_CATEGORY", "target_category_includes": "政治人物", "target": { "side": "ALL", "type": "MINION" } } }, "image": "img/tw_recall_v2.png" },
    { "id": "S004", "name": "造勢晚會", "category": "新聞", "cost": 2, "type": "NEWS", "rarity": "COMMON", "description": "凍蒜！！\n(本回合獲得 +2/+2)", "keywords": { "battlecry": { "type": "BUFF_STAT_TARGET_TEMP", "value": 2, "target": { "side": "ALL", "type": "MINION" } } }, "image": "img/tw_rally.png" },
    { "id": "S005", "name": "倒閣", "category": "新聞", "cost": 4, "type": "NEWS", "rarity": "RARE", "description": "將場上的政治人物全部放回手牌", "keywords": { "battlecry": { "type": "BOUNCE_ALL_CATEGORY", "target_category_includes": "政治人物" } }, "image": "img/tw_cabinet_resignation.png" },
    { "id": "S006", "name": "砸雞蛋", "category": "新聞", "cost": 2, "type": "NEWS", "rarity": "COMMON", "description": "對隨從造成 3 點傷害", "keywords": { "battlecry": { "type": "DAMAGE", "value": 3, "target": { "side": "ALL", "type": "MINION" } } }, "image": "img/tw_eggs.png" },
    { "id": "S007", "name": "召開記者會", "category": "新聞", "cost": 2, "type": "NEWS", "rarity": "COMMON", "description": "降低我方全部手牌 1 點消耗", "keywords": { "battlecry": { "type": "REDUCE_COST_ALL_HAND", "value": 1 } }, "image": "img/tw_press_conference.png" },
    { "id": "S008", "name": "法院傳票", "category": "新聞", "cost": 2, "type": "NEWS", "rarity": "COMMON", "description": "抽取一張隨從牌並將其消耗降低 3 點。", "keywords": { "battlecry": { "type": "DRAW_MINION_REDUCE_COST", "value": 3 } }, "image": "img/s003.png" },
    { "id": "TW037", "name": "老榮民", "category": "平民", "cost": 3, "attack": 1, "health": 2, "type": "MINION", "rarity": "COMMON", "description": "遺志：抽兩張牌", "keywords": { "deathrattle": { "type": "DRAW", "value": 2 } }, "image": "img/veteran.png" },
    { "id": "TW038", "name": "傅崐萁", "category": "國民黨政治人物", "cost": 5, "attack": 4, "health": 6, "type": "MINION", "rarity": "LEGENDARY", "description": "花蓮國王\n衝鋒 每當有一張卡牌被丟棄獲得+2/+2", "keywords": { "charge": true, "triggered": { "type": "ON_DISCARD", "value": 2 } }, "image": "img/fu.png" },
    { "id": "TW039", "name": "徐巧芯", "category": "國民黨政治人物", "cost": 1, "attack": 4, "health": 4, "type": "MINION", "rarity": "RARE", "description": "戰吼:隨機丟棄三張手牌", "keywords": { "battlecry": { "type": "DISCARD_RANDOM", "value": 3 } }, "image": "img/hsu.png" },
    { "id": "S009", "name": "政治切割", "category": "新聞", "cost": 1, "type": "NEWS", "rarity": "COMMON", "description": "戰吼:丟棄一張手牌，抽兩張牌", "keywords": { "battlecry": { "type": "DISCARD_DRAW", "discardCount": 1, "drawCount": 2 } }, "image": "img/cutting.png" },
    { "id": "TW040", "name": "謝龍介", "category": "國民黨政治人物", "cost": 3, "attack": 2, "health": 2, "type": "MINION", "rarity": "RARE", "description": "屢敗屢戰\n當這個隨從從手牌被丟棄時，則會跳入戰場", "keywords": { "onDiscard": "SUMMON" }, "image": "img/hsieh.png" },
    { "id": "TW041", "name": "柯文哲(獄中)", "category": "民眾黨政治人物", "cost": 4, "attack": 3, "health": 8, "type": "MINION", "rarity": "RARE", "description": "戰吼: 對自己造成3點傷害", "keywords": { "battlecry": { "type": "DAMAGE_SELF", "value": 3 } }, "image": "img/ko_jail.png" },
    { "id": "TW042", "name": "蔡璧如", "category": "民眾黨政治人物", "cost": 3, "attack": 2, "health": 6, "type": "MINION", "rarity": "COMMON", "description": "戰吼: 對自己造成2點傷害", "keywords": { "battlecry": { "type": "DAMAGE_SELF", "value": 2 } }, "image": "img/tsai_pi_ru.png" },
    { "id": "TW043", "name": "陳珮琪(老公獄中)", "category": "民眾黨政治人物", "cost": 5, "attack": 4, "health": 3, "type": "MINION", "rarity": "RARE", "description": "司法不公！！！\n光盾", "keywords": { "divineShield": true }, "image": "img/tw021.png" },
    { "id": "S010", "name": "921大地震", "category": "新聞", "cost": 7, "type": "NEWS", "rarity": "EPIC", "description": "摧毀雙方場上所有隨從", "keywords": { "battlecry": { "type": "DESTROY_ALL_MINIONS" } }, "image": "img/e921.png" }
];

let cardDB = [];

// Load cards manually (modified for local file access)
// Game state for deck builder
let userDecks = JSON.parse(localStorage.getItem('userDecks')) || [
    { name: "預設牌組 1", cards: [] },
    { name: "預設牌組 2", cards: [] },
    { name: "預設牌組 3", cards: [] }
];
let tempDeck = null; // Temporary deck for editing

// AI Theme Decks
function generateDefaultDeck() {
    const allIds = CARD_DATA.map(c => c.id);
    const deck = [];
    while (deck.length < 30) deck.push(allIds[Math.floor(Math.random() * allIds.length)]);
    return deck;
}

let aiThemeDecks = JSON.parse(localStorage.getItem('aiThemeDecks')) || [
    { id: 'dpp', name: '民進黨牌組', image: 'img/theme_dpp.png', cards: generateDefaultDeck() },
    { id: 'kmt', name: '國民黨牌組', image: 'img/theme_kmt.png', cards: generateDefaultDeck() },
    { id: 'tpp', name: '民眾黨牌組', image: 'img/theme_tpp.png', cards: generateDefaultDeck() }
];
let editingThemeIdx = -1; // -1 means not editing theme

function migrateDecks() {
    // Migration Map to translate old IDs to new ones
    const map = {
        'c001': 'TW001', 'c004': 'TW002', 'c002': 'TW003', 'tw008': 'TW004',
        'tw010': 'TW005', 'c013': 'TW006', 'tw007': 'TW007', 'tw014': 'TW008',
        'tw015': 'TW009', 'tw011': 'TW010', 'tw001': 'TW011', 'tw003': 'TW012',
        'tw009': 'TW013', 'tw019': 'TW014', 'tw020': 'TW015', 'tw002': 'TW016',
        'tw013': 'TW017', 'tw016': 'TW018', 'tw021': 'TW019', 'tw006': 'TW020',
        'tw018': 'TW021', 'tw017': 'TW023', 'tw012': 'TW024',
        'tw004': 'S001', 'tw005': 'S002', 'v023': 'TW037' // Manual fix for the brief TW023 clash if needed
    };

    let needsUpdate = false;
    userDecks.forEach(deck => {
        if (!deck.cards) deck.cards = [];
        const originalLength = deck.cards.length;
        deck.cards = deck.cards.map(id => {
            // Special fix: If someone had TW023 but meant Old Veteran (which clashed briefly)
            // This is hard to be certain about, but we know tw017 maps to TW023 (Chen).
            // Let's just focus on the backward map.
            if (map[id]) {
                needsUpdate = true;
                return map[id];
            }
            return id;
        }).filter(id => {
            const cardExists = CARD_DATA.some(c => c.id === id);
            if (!cardExists) needsUpdate = true;
            return cardExists;
        });

        if (deck.cards.length !== originalLength) needsUpdate = true;
    });

    if (needsUpdate) {
        localStorage.setItem('userDecks', JSON.stringify(userDecks));
        console.log("Decks migrated and cleaned up.");
    }
}

// Ensure valid Slot 2 if empty or broken (for testing convenience)
if (userDecks[1].cards.length === 0) {
    const defaultDeck = [];
    const allIds = CARD_DATA.map(c => c.id);
    for (let i = 0; i < 30; i++) {
        defaultDeck.push(allIds[i % allIds.length]);
    }
    userDecks[1].cards = defaultDeck;
}
let selectedDeckIdx = parseInt(localStorage.getItem('selectedDeckIdx')) || 0;
let selectedThemeId = 'dpp'; // Default theme
let editingDeckIdx = 0;
let pendingViewMode = 'BATTLE'; // 'BATTLE', 'BUILDER', or 'DEBUG'
let isDebugMode = false;
let currentDifficulty = 'NORMAL';
let currentSort = { field: 'cost', direction: 'asc' }; // 'cost', 'category', 'rarity'

function init() {
    migrateDecks();
    gameEngine = new GameEngine(CARD_DATA);

    // --- Main Menu Listeners ---
    document.getElementById('btn-main-battle').addEventListener('click', () => {
        isDebugMode = false;
        showView('mode-selection');
    });

    document.getElementById('btn-main-builder').addEventListener('click', () => {
        isDebugMode = false;
        pendingViewMode = 'BUILDER';
        showView('deck-selection');
        document.getElementById('deck-select-title').innerText = '選擇要編修的牌組';
        renderDeckSelect();
    });

    document.getElementById('btn-main-test').addEventListener('click', () => {
        isDebugMode = true;
        pendingViewMode = 'DEBUG';
        showView('test-mode-selection');
    });

    // --- Mode Selection Listeners ---
    document.getElementById('btn-mode-ai').addEventListener('click', () => {
        showView('difficulty-selection');
    });

    // --- Difficulty Selection Listeners ---
    document.querySelectorAll('.diff-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            currentDifficulty = btn.dataset.diff;
            pendingViewMode = 'BATTLE';
            showView('theme-selection');
            renderThemeSelection();
        });
    });

    // --- Test Mode Selection Listeners ---
    document.getElementById('btn-test-player-decks').addEventListener('click', () => {
        showView('deck-selection');
        document.getElementById('deck-select-title').innerText = '測試模式：選擇玩家牌組';
        renderDeckSelect();
    });

    document.getElementById('btn-test-ai-themes').addEventListener('click', () => {
        showView('theme-selection');
        document.getElementById('theme-selection').querySelector('.sub-title').innerText = '選擇要編輯的主題牌組';
        renderThemeSelection(true); // Pass true for edit mode
    });

    // --- Back Buttons ---
    document.querySelectorAll('.btn-back').forEach(btn => {
        btn.addEventListener('click', () => {
            if (document.getElementById('mode-selection').style.display === 'flex') {
                showView('main-menu');
            } else if (document.getElementById('difficulty-selection').style.display === 'flex') {
                showView('mode-selection');
            } else if (document.getElementById('test-mode-selection').style.display === 'flex') {
                showView('main-menu');
            } else if (document.getElementById('theme-selection').style.display === 'flex') {
                // Check if we're in edit mode or battle mode
                const title = document.getElementById('theme-selection').querySelector('.sub-title').innerText;
                if (title.includes('編輯')) {
                    showView('test-mode-selection');
                } else {
                    showView('difficulty-selection');
                }
            } else if (document.getElementById('deck-selection').style.display === 'flex') {
                // Check if we're in test mode
                const title = document.getElementById('deck-select-title').innerText;
                if (title.includes('測試')) {
                    showView('test-mode-selection');
                } else {
                    showView('theme-selection');
                }
            }
        });
    });

    document.getElementById('btn-builder-back').addEventListener('click', async () => {
        if (tempDeck) {
            if (tempDeck.isTheme) {
                // Editing theme deck
                const original = aiThemeDecks[editingThemeIdx];
                const tempStr = JSON.stringify({ name: tempDeck.name, cards: tempDeck.cards });
                const origStr = JSON.stringify({ name: original.name, cards: original.cards });

                if (tempStr !== origStr) {
                    const confirmed = await showCustomConfirm("您有未保存的修改，確定要放棄並離開嗎？");
                    if (!confirmed) return;
                }
                tempDeck = null;
                editingThemeIdx = -1;
                showView('test-mode-selection');
            } else {
                // Editing player deck
                const original = userDecks[editingDeckIdx];
                const tempStr = JSON.stringify({ name: tempDeck.name, cards: tempDeck.cards });
                const origStr = JSON.stringify({ name: original.name, cards: original.cards });

                if (tempStr !== origStr) {
                    const confirmed = await showCustomConfirm("您有未保存的修改，確定要放棄並離開嗎？");
                    if (!confirmed) return;
                }
                tempDeck = null;
                showView('deck-selection');
                renderDeckSelect();
            }
        } else {
            showView('deck-selection');
            renderDeckSelect();
        }
    });

    // --- Deck Builder Listeners ---
    document.getElementById('btn-save-deck').addEventListener('click', () => {
        if (!tempDeck) return;
        const nameInput = document.getElementById('deck-name-input');

        if (tempDeck.isTheme) {
            // Saving theme deck
            tempDeck.name = nameInput.value || aiThemeDecks[editingThemeIdx].name;
            aiThemeDecks[editingThemeIdx].cards = JSON.parse(JSON.stringify(tempDeck.cards));
            aiThemeDecks[editingThemeIdx].name = tempDeck.name;
            localStorage.setItem('aiThemeDecks', JSON.stringify(aiThemeDecks));
            showToast("主題牌組保存成功！");
        } else {
            // Saving player deck
            tempDeck.name = nameInput.value || `牌組 ${editingDeckIdx + 1}`;
            userDecks[editingDeckIdx] = JSON.parse(JSON.stringify(tempDeck));
            localStorage.setItem('userDecks', JSON.stringify(userDecks));
            showToast("保存成功！");
        }
        renderDeckBuilder();
    });

    // Search Listener
    document.getElementById('card-search-input').addEventListener('input', () => {
        renderDeckBuilder();
    });

    // Filter Listeners
    ['filter-category', 'filter-rarity', 'filter-cost'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', renderDeckBuilder);
    });

    // Populate Category Filter
    const categories = [...new Set(CARD_DATA.map(c => c.category || '一般'))].sort();
    const catSelect = document.getElementById('filter-category');
    if (catSelect) {
        categories.forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat;
            opt.innerText = cat;
            catSelect.appendChild(opt);
        });
    }
}

// Sort Listeners
document.querySelectorAll('.sort-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const field = btn.dataset.sort;
        if (currentSort.field === field) {
            // Toggle direction
            currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
        } else {
            currentSort.field = field;
            currentSort.direction = 'asc';
        }
        renderDeckBuilder();
    });
});

// --- Battle Listeners ---
document.getElementById('end-turn-btn').addEventListener('click', () => {
    if (isBattlecryTargeting || dragging) return;
    try {
        gameState.endTurn();
        render();
        if (gameState.currentPlayerIdx === 1) {
            setTimeout(aiTurn, 1000);
        }
    } catch (e) { logMessage(e.message); }
});

document.getElementById('btn-surrender').addEventListener('click', () => {
    document.getElementById('surrender-modal').style.display = 'flex';
});

document.getElementById('btn-surrender-confirm').addEventListener('click', () => {
    document.getElementById('surrender-modal').style.display = 'none';
    endGame('DEFEAT');
});

document.getElementById('btn-surrender-cancel').addEventListener('click', () => {
    document.getElementById('surrender-modal').style.display = 'none';
});

// Update Log Listeners
document.getElementById('btn-update-log')?.addEventListener('click', () => {
    const list = document.getElementById('update-log-list');
    if (list && typeof UPDATE_LOGS !== 'undefined') {
        // 渲染日誌內容
        list.innerHTML = UPDATE_LOGS.map(log => `
            <div class="update-version-section">
                <h3 style="color: var(--neon-cyan); margin-bottom: 10px;">版本 ${log.version} (${log.date})</h3>
                <ul style="list-style: none; padding: 0;">
                    ${log.items.map(item => `
                        <li style="margin-bottom: 15px;">
                            <b style="color: var(--neon-yellow);">${item.title}</b><br>
                            <span style="color: #ccc; font-size: 14px;">${item.desc}</span>
                        </li>
                    `).join('')}
                </ul>
            </div>
        `).join('<hr style="border: 0; border-top: 1px solid #333; margin: 20px 0;">');

        // 自動掃描並包裝卡牌名稱以實現懸停預覽
        const allCardNames = CARD_DATA.map(c => c.name);
        allCardNames.sort((a, b) => b.length - a.length);

        const sections = list.querySelectorAll('.update-version-section li span, .update-version-section li b');
        sections.forEach(el => {
            let text = el.innerText;
            // 避免在 innerHTML 中直接取代，改用一個暫存標記來處理
            let segments = [{ text: text, isLink: false }];

            allCardNames.forEach(name => {
                const card = CARD_DATA.find(c => c.name === name);
                let newSegments = [];
                segments.forEach(seg => {
                    if (seg.isLink) {
                        newSegments.push(seg);
                    } else {
                        const parts = seg.text.split(name);
                        for (let i = 0; i < parts.length; i++) {
                            if (parts[i]) newSegments.push({ text: parts[i], isLink: false });
                            if (i < parts.length - 1) {
                                newSegments.push({ text: name, isLink: true, cardId: card.id });
                            }
                        }
                    }
                });
                segments = newSegments;
            });

            // 重新組裝 HTML
            el.innerHTML = segments.map(seg => {
                if (seg.isLink) {
                    return `<span class="log-card-link" data-card-id="${seg.cardId}">${seg.text}</span>`;
                }
                return seg.text;
            }).join('');
        });

        // 為所有連結綁定事件
        list.querySelectorAll('.log-card-link').forEach(link => {
            const cardId = link.dataset.cardId;
            const card = CARD_DATA.find(c => c.id === cardId);
            if (!card) return;

            link.addEventListener('mouseenter', (e) => {
                const preview = document.getElementById('card-preview');
                if (!preview || !card) return;

                // 修正置中邏輯：使用 fixed 並重置所有位移
                preview.style.position = 'fixed';
                preview.style.top = '50%';
                preview.style.left = '50%';
                preview.style.bottom = 'auto';
                preview.style.right = 'auto';
                // 必須移除內部可能干擾的 transform: none
                preview.style.transform = 'translate(-50%, -50%)';
                preview.style.display = 'block';
                preview.style.zIndex = '10001';

                showPreview(card);

                // 再次確保 transform 有生效 (有些時候 showPreview 會覆寫 innerHTML 導致重繪)
                setTimeout(() => {
                    preview.style.transform = 'translate(-50%, -50%)';
                }, 0);
            });
            link.addEventListener('mouseleave', hidePreview);
        });
    }
    document.getElementById('update-log-modal').style.display = 'flex';
});

document.getElementById('btn-update-log-close')?.addEventListener('click', () => {
    document.getElementById('update-log-modal').style.display = 'none';
});

// --- Result View Listeners ---
document.getElementById('btn-result-continue').addEventListener('click', () => {
    showView('main-menu');
});

// Global drag events
document.addEventListener('mousemove', onDragMove);
document.addEventListener('mouseup', onDragEnd);

// Initial view
showView('main-menu');


function renderThemeSelection(isEditMode = false) {
    const container = document.getElementById('theme-cards-container');
    container.innerHTML = '';

    aiThemeDecks.forEach((theme, idx) => {
        const card = document.createElement('div');
        card.className = 'theme-card';

        const imageDiv = document.createElement('div');
        imageDiv.className = 'theme-card-image';

        // Try to load image, fallback to emoji
        const img = new Image();
        img.src = theme.image;
        img.onload = () => {
            imageDiv.style.backgroundImage = `url('${theme.image}')`;
            imageDiv.style.backgroundSize = 'cover';
            imageDiv.style.backgroundPosition = 'center';
            imageDiv.innerHTML = '';
        };
        img.onerror = () => {
            // Fallback emoji based on theme
            const emojis = { 'dpp': '🟢', 'kmt': '🔵', 'tpp': '🟡' };
            imageDiv.innerHTML = emojis[theme.id] || '🎴';
        };

        const content = document.createElement('div');
        content.className = 'theme-card-content';
        content.innerHTML = `
            <h3>${theme.name}</h3>
            <p>${theme.cards.length} / 30 張卡</p>
        `;

        card.appendChild(imageDiv);
        card.appendChild(content);

        card.addEventListener('click', () => {
            if (isEditMode) {
                // Edit mode: open deck builder
                editingThemeIdx = idx;
                tempDeck = JSON.parse(JSON.stringify(theme));
                tempDeck.isTheme = true; // Mark as theme deck
                showView('deck-builder');
                renderDeckBuilder();
            } else {
                // Battle mode: select theme
                selectedThemeId = theme.id;
                showView('deck-selection');
                document.getElementById('deck-select-title').innerText = '選擇出戰牌組';
                renderDeckSelect();
            }
        });

        container.appendChild(card);
    });
}


function renderDeckSelect() {
    const container = document.getElementById('deck-select-slots');
    container.innerHTML = '';

    const startBtn = document.getElementById('btn-start-battle');
    const editBtn = document.getElementById('btn-edit-deck');
    const titleEl = document.getElementById('deck-select-title');

    // Title is already set by the caller, no need to override here
    // Just keep the existing title

    // Reset Buttons
    if (startBtn) startBtn.style.display = 'none';
    if (editBtn) editBtn.style.display = 'none';

    if (pendingViewMode === 'BATTLE' || pendingViewMode === 'DEBUG') {
        if (startBtn) {
            startBtn.style.display = 'block';
            startBtn.onclick = async () => {
                if (selectedDeckIdx < 0 || selectedDeckIdx >= userDecks.length) return;
                const deck = userDecks[selectedDeckIdx];
                const isTest = deck.isTest || isDebugMode;
                if (deck.cards.length === 30 || (isTest && deck.cards.length > 0)) {
                    // Get selected theme deck
                    const themeDeck = aiThemeDecks.find(t => t.id === selectedThemeId);
                    const oppDeck = themeDeck ? themeDeck.cards : null;
                    startBattle(deck.cards, isDebugMode, oppDeck);
                } else {
                    await showCustomAlert(`「${deck.name}」目前有 ${deck.cards.length} 張卡，需要剛好 30 張才能戰鬥！${isTest ? '(測試模式需至少 1 張)' : ''}`);
                }
            };
        }
    }

    if (pendingViewMode === 'BUILDER' || pendingViewMode === 'DEBUG') {
        if (editBtn) {
            editBtn.style.display = 'block';
            editBtn.onclick = () => {
                if (selectedDeckIdx < 0 || selectedDeckIdx >= userDecks.length) return;
                editingDeckIdx = selectedDeckIdx;
                // Deep copy for editing
                tempDeck = JSON.parse(JSON.stringify(userDecks[editingDeckIdx]));
                showView('deck-builder');
                renderDeckBuilder();
            };
        }
    }

    // Strict Isolation: Test Mode shows ONLY test decks, Normal Mode shows ONLY normal decks
    const visibleDecks = userDecks.map((d, i) => ({ ...d, originalIdx: i }))
        .filter(d => isDebugMode ? d.isTest : !d.isTest);

    visibleDecks.forEach((deck, idx) => {
        const slot = document.createElement('div');
        slot.className = `deck-slot ${deck.originalIdx === selectedDeckIdx ? 'selected' : ''}`;

        const isDeckIncomplete = deck.cards.length !== 30;
        const warningIcon = (isDeckIncomplete && !deck.isTest) ? '<span title="牌組未滿30張" style="color: var(--neon-yellow); margin-right: 8px;">⚠️</span>' : '';
        const testLabel = deck.isTest ? '<span style="color: var(--neon-pink); font-size: 10px; margin-left: 5px;">[測試]</span>' : '';

        slot.innerHTML = `
            <button class="btn-delete-deck" title="刪除牌組">×</button>
            <h3>${warningIcon}${deck.name}${testLabel}</h3>
            <div class="slot-info">${deck.cards.length} / 30 張卡</div>
        `;

        slot.querySelector('.btn-delete-deck').addEventListener('click', async (e) => {
            e.stopPropagation();
            if (userDecks.length <= 1) {
                await showCustomAlert("至少需保留一個牌組！");
                return;
            }
            const confirmed = await showCustomConfirm(`確定要刪除「${deck.name}」嗎？`);
            if (confirmed) {
                userDecks.splice(deck.originalIdx, 1);
                if (selectedDeckIdx >= userDecks.length) selectedDeckIdx = userDecks.length - 1;
                localStorage.setItem('userDecks', JSON.stringify(userDecks));
                renderDeckSelect();
            }
        });

        // Click slot to select
        slot.addEventListener('click', () => {
            selectedDeckIdx = deck.originalIdx;
            localStorage.setItem('selectedDeckIdx', selectedDeckIdx);
            renderDeckSelect();
        });

        container.appendChild(slot);
    });

    // Add New Deck Slot (Only in Builder or Debug Mode)
    if (pendingViewMode !== 'BATTLE' && userDecks.length < 10) {
        const addSlot = document.createElement('div');
        addSlot.className = 'deck-slot add-deck-slot';
        addSlot.innerHTML = `
            <div class="plus-icon">+</div>
            <div>建立${isDebugMode ? '測試' : '新'}牌組</div>
        `;
        addSlot.onclick = () => {
            const newDeck = {
                name: (isDebugMode ? '測試牌組 ' : '自定義牌組 ') + (userDecks.length + 1),
                cards: []
            };
            if (isDebugMode) newDeck.isTest = true;
            userDecks.push(newDeck);
            localStorage.setItem('userDecks', JSON.stringify(userDecks));
            selectedDeckIdx = userDecks.length - 1;
            renderDeckSelect();
        };
        container.appendChild(addSlot);
    }
}


function showView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
    const view = document.getElementById(viewId);
    if (view) view.style.display = 'flex';

    // Toggle message log visibility
    const log = document.getElementById('message-log');
    if (log) {
        log.style.display = (viewId === 'battle-view') ? 'flex' : 'none';
    }
}

let previousPlayerHandSize = 0;

async function startBattle(deckIds, debugMode = false, oppDeckIds = null) {
    // Use provided opponent deck or generate random one
    let oppDeck;
    if (oppDeckIds && oppDeckIds.length > 0) {
        oppDeck = oppDeckIds;
    } else {
        const allIds = CARD_DATA.map(c => c.id);
        oppDeck = [];
        while (oppDeck.length < 30) oppDeck.push(allIds[Math.floor(Math.random() * allIds.length)]);
    }

    try {
        gameState = gameEngine.createGame(deckIds, oppDeck, isDebugMode, currentDifficulty);
        showView('battle-view');
    } catch (e) {
        logMessage(e.message);
        return;
    }

    // Initial Draw Sequence Logic
    const initialHand = [...gameState.players[0].hand];
    gameState.players[0].hand = [];
    previousPlayerHandSize = 0;

    // Init Mana Containers for the new game view
    initManaContainers('player-mana-container');
    initManaContainers('opp-mana-container');

    showView('battle-view');
    render();

    // Animate sorting out cards one by one
    // We don't block the UI thread completely, just delay the appearance
    for (const card of initialHand) {
        await new Promise(r => setTimeout(r, 400));
        gameState.players[0].hand.push(card);
        render();
    }

    // If opponent starts, trigger AI
    if (gameState.currentPlayerIdx === 1) {
        setTimeout(aiTurn, 1000);
    } else {
        // Player starts
        setTimeout(() => showTurnAnnouncement("你的回合"), 500);
    }
}

function initManaContainers(id) {
    const container = document.getElementById(id);
    container.innerHTML = '';

    for (let i = 0; i < 10; i++) {
        const crystal = document.createElement('div');
        crystal.className = 'mana-crystal locked';
        container.appendChild(crystal);
    }
}

function renderDeckBuilder() {
    // Use tempDeck for rendering during edit
    const deck = tempDeck || userDecks[editingDeckIdx];
    document.getElementById('deck-name-input').value = deck.name;

    const gridEl = document.getElementById('all-cards-grid');
    gridEl.innerHTML = '';

    // Search Functionality
    // Search Functionality & Window Filters
    const searchInput = document.getElementById('card-search-input');
    const searchTerm = searchInput ? searchInput.value.toLowerCase() : "";

    // Read Filters
    const catFilter = document.getElementById('filter-category') ? document.getElementById('filter-category').value : 'ALL';
    const rarFilter = document.getElementById('filter-rarity') ? document.getElementById('filter-rarity').value : 'ALL';
    const costFilter = document.getElementById('filter-cost') ? document.getElementById('filter-cost').value : 'ALL';

    // Update Sort Indicators (UI)
    document.querySelectorAll('.sort-btn').forEach(btn => {
        const field = btn.dataset.sort;
        const arrow = btn.querySelector('.sort-arrow');
        if (field === currentSort.field) {
            btn.classList.add('active');
            arrow.innerText = currentSort.direction === 'asc' ? '↑' : '↓';
        } else {
            btn.classList.remove('active');
            arrow.innerText = '↕';
        }
    });

    CARD_DATA.filter(card => {
        const matchSearch = card.name.toLowerCase().includes(searchTerm) || (card.description && card.description.toLowerCase().includes(searchTerm));
        const matchCat = catFilter === 'ALL' || (card.category || '一般') === catFilter;
        const matchRarity = rarFilter === 'ALL' || (card.rarity || 'COMMON') === rarFilter; // Default rarity if missing?

        let matchCost = true;
        if (costFilter !== 'ALL') {
            if (costFilter === '7+') matchCost = card.cost >= 7;
            else matchCost = card.cost === parseInt(costFilter);
        }

        return matchSearch && matchCat && matchRarity && matchCost;
    }).sort((a, b) => {
        const dir = currentSort.direction === 'asc' ? 1 : -1;
        let valA, valB;

        if (currentSort.field === 'cost') {
            valA = a.cost; valB = b.cost;
        } else if (currentSort.field === 'category') {
            valA = a.category || '一般'; valB = b.category || '一般';
            return valA.localeCompare(valB) * dir;
        } else if (currentSort.field === 'rarity') {
            const rMap = { 'COMMON': 1, 'RARE': 2, 'EPIC': 3, 'LEGENDARY': 4 };
            valA = rMap[a.rarity || 'COMMON'] || 0;
            valB = rMap[b.rarity || 'COMMON'] || 0;
        }
        return (valA - valB) * dir;
    }).forEach(card => {
        const cardEl = createCardEl(card, -1);



        // Count copies in current deck
        const countInDeck = deck.cards.filter(id => id === card.id).length;
        if (countInDeck > 0) {
            const badge = document.createElement('div');
            badge.innerText = `x${countInDeck}`;
            badge.style.position = 'absolute';
            badge.style.top = '5px';
            badge.style.right = '5px';
            badge.style.background = 'var(--neon-yellow)';
            badge.style.color = '#000';
            badge.style.fontWeight = 'bold';
            badge.style.fontSize = '12px';
            badge.style.padding = '2px 6px';
            badge.style.borderRadius = '10px';
            badge.style.zIndex = '20';
            badge.style.boxShadow = '0 0 5px rgba(0,0,0,0.8)';
            badge.style.border = '1px solid #000';
            cardEl.appendChild(badge);

            // Visual feedback for max copies
            // Legendary: max 1 (but logic says global limit 2? Wait logic says "legendCount >= 2" is global limit, but usually deck limit is 1 per unique legendary. 
            // In Hearthstone: 1 per legendary, 2 per non-legendary.
            // My code handles global legendary limit of 2? "傳說卡牌在牌組中最多只能放 2 張！" -> This sounds like total legendaries in deck <= 2. 
            // But let's look at "count >= 2" check below (lines 236-237). It applies to everything. 
            // So currently duplicate limit is 2 for ALL cards.
            // Let's stick to simple dimming if count >= 2.

            if (countInDeck >= 2) {
                cardEl.style.opacity = '0.5';
                cardEl.style.filter = 'grayscale(0.5)';
            }
        }

        cardEl.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (deck.cards.length < 30 || isDebugMode) {
                // Check legendary limit
                if (!isDebugMode && card.rarity === 'LEGENDARY') {
                    const legendCount = deck.cards.filter(id => {
                        const c = CARD_DATA.find(x => x.id === id);
                        return c?.rarity === 'LEGENDARY';
                    }).length;
                    if (legendCount >= 2) {
                        await showCustomAlert("傳說卡牌在牌組中最多只能放 2 張！");
                        return;
                    }
                }

                // Normal 2 copies limit
                const count = deck.cards.filter(id => id === card.id).length;
                if (!isDebugMode && count >= 2) {
                    await showCustomAlert("每種卡牌最多只能放 2 張！");
                    return;
                }

                deck.cards.push(card.id);
                renderDeckBuilder();
            }
        });
        gridEl.appendChild(cardEl);
    });

    const listEl = document.getElementById('my-deck-list');
    listEl.innerHTML = '';

    // Sort cards by cost then name
    const sortedCards = [...deck.cards].sort((a, b) => {
        const cardA = CARD_DATA.find(c => c.id === a);
        const cardB = CARD_DATA.find(c => c.id === b);
        if (cardA.cost !== cardB.cost) return cardA.cost - cardB.cost;
        return cardA.name.localeCompare(cardB.name);
    });

    // Group cards
    const cardCounts = {};
    sortedCards.forEach(id => {
        cardCounts[id] = (cardCounts[id] || 0) + 1;
    });

    // Render grouped cards
    const processedIds = new Set();
    sortedCards.forEach((id) => {
        if (processedIds.has(id)) return;
        processedIds.add(id);

        const card = CARD_DATA.find(c => c.id === id);
        const count = cardCounts[id];

        const item = document.createElement('div');
        item.className = 'deck-item';
        // Fix: Add rarity border to deck list item
        item.style.borderLeft = `4px solid ${getBorderColor(card.rarity)}`;

        // Show count if > 1
        const countBadge = count > 1 ? `<span style="background:var(--neon-yellow); color:black; border-radius:50%; padding:0 6px; font-size:12px; margin-right:5px; font-weight:bold;">${count}</span>` : '';

        item.innerHTML = `<div style="display:flex; align-items:center;">${countBadge}<span>${card.name}</span></div><span>${card.cost}</span>`;

        item.addEventListener('click', () => {
            // Remove one instance of this card
            const indexToRemove = deck.cards.indexOf(id);
            if (indexToRemove > -1) {
                deck.cards.splice(indexToRemove, 1);
                renderDeckBuilder();
            }
        });

        // Add hover preview for deck list items
        item.addEventListener('mouseenter', (e) => {
            const preview = document.getElementById('card-preview');
            const builderView = document.getElementById('deck-builder');
            if (builderView.style.display === 'flex') {
                // Show on left side since list is on right
                preview.style.right = 'auto';
                preview.style.left = '40px';
                preview.style.top = '50%';
                preview.style.transform = 'translateY(-50%)';
            }
            showPreview(card);
        });
        item.addEventListener('mouseleave', hidePreview);

        listEl.appendChild(item);
    });

    if (isDebugMode) {
        document.getElementById('deck-count-indicator').innerText = `測試模式: ${deck.cards.length} 張卡 (無數量限制)`;
        document.getElementById('deck-count-indicator').style.color = 'var(--neon-blue)';
    } else {
        document.getElementById('deck-count-indicator').innerText = `已選擇: ${deck.cards.length} / 30`;
        document.getElementById('deck-count-indicator').style.color = (deck.cards.length === 30) ? 'var(--neon-green)' : 'white';
    }

    // Calculate Stats
    let totalCost = 0;
    let minionCount = 0;
    let newsCount = 0;

    deck.cards.forEach(id => {
        const card = CARD_DATA.find(c => c.id === id);
        if (card) {
            totalCost += card.cost;
            if (card.type === 'MINION') minionCount++;
            else if (card.type === 'NEWS') newsCount++;
        }
    });

    const avgCost = deck.cards.length > 0 ? (totalCost / deck.cards.length).toFixed(1) : "0.0";

    const statsEl = document.getElementById('deck-stats');
    if (statsEl) {
        statsEl.innerHTML = `
            <div class="stat-row">平均花費: <span style="color:var(--neon-cyan)">${avgCost}</span></div>
            <div class="stat-row">單位卡: <span style="color:var(--neon-yellow)">${minionCount}</span></div>
            <div class="stat-row">技能卡: <span style="color:#ff4b2b">${newsCount}</span></div>
        `;
    }
}

function getBorderColor(rarity) {
    if (!rarity) return '#ffffff';
    switch (rarity.toUpperCase()) {
        case 'LEGENDARY': return '#ffa500';
        case 'EPIC': return '#a335ee';
        case 'RARE': return '#0070dd';
        default: return '#ffffff';
    }
}

async function aiTurn() {
    logMessage("Opponent is thinking...");
    try {
        // Simple loop to execute actions one by one
        let moves = 0;
        const maxMoves = 10; // Prevent infinite loops

        while (moves < maxMoves) {
            // Recalculate best move each time state changes
            const action = gameEngine.ai.getNextMove(gameState);

            if (!action) {
                break; // No more good moves
            }

            if (action.type === 'PLAY_CARD') {
                const card = gameState.currentPlayer.hand[action.index];
                if (!card) break;

                logMessage(`Opponent plays ${card.name}`);

                const oppBoard = document.getElementById('opp-board');
                const insertionIndex = action.insertionIndex !== undefined ? action.insertionIndex : -1;
                const targetSlot = insertionIndex === -1 ? null : oppBoard.children[insertionIndex];

                await showCardPlayPreview(card, true, targetSlot);

                try {
                    gameState.playCard(action.index, action.target, insertionIndex);
                } catch (e) {
                    console.error("AI failed to play card:", e);
                    break;
                }
                render();

                // Visual Delay for drawing battlecries
                if (card.keywords?.battlecry?.type === 'DRAW') {
                    const drawCount = card.keywords.battlecry.value || 1;
                    for (let i = 0; i < drawCount; i++) {
                        await new Promise(r => setTimeout(r, 600));
                        gameState.currentPlayer.drawCard();
                        render();
                    }
                } else if (card.keywords?.battlecry?.type === 'DISCARD_DRAW') {
                    const drawCount = card.keywords.battlecry.drawCount || 2;
                    // Ai discard visuals are usually instant render, so we just wait a bit
                    await new Promise(r => setTimeout(r, 600));
                    for (let i = 0; i < drawCount; i++) {
                        gameState.currentPlayer.drawCard();
                        render();
                        await new Promise(r => setTimeout(r, 600));
                    }
                }

                await resolveDeaths();

                // Show Battlecry Visuals
                if (action.target) {
                    const board = document.getElementById('opp-board');
                    // Newest minion is at the end
                    const sourceEl = board.children[board.children.length - 1];

                    let destEl = null;
                    if (action.target.type === 'HERO') {
                        // AI perspective side: 'OPPONENT' is Player, 'PLAYER' is AI.
                        destEl = (action.target.side === 'OPPONENT') ? document.getElementById('player-hero') : document.getElementById('opp-hero');
                    } else if (action.target.type === 'MINION') {
                        const targetBoardId = (action.target.side === 'OPPONENT') ? 'player-board' : 'opp-board';
                        destEl = document.getElementById(targetBoardId).children[action.target.index];
                    }

                    if (sourceEl && destEl) {
                        const type = card.keywords?.battlecry?.type;
                        let color = '#ff0000';
                        let effectType = 'DAMAGE';
                        if (type === 'HEAL') { color = '#43e97b'; effectType = 'HEAL'; }
                        else if (type === 'BUFF_STAT_TARGET') { color = '#ffa500'; effectType = 'BUFF'; }

                        await animateAbility(sourceEl, destEl, color);
                        triggerCombatEffect(destEl, effectType);
                    }
                } else if (card.keywords?.battlecry) {
                    const type = card.keywords.battlecry.type;
                    if (type === 'DESTROY_ALL_MINIONS') {
                        await triggerEarthquakeAnimation();
                    } else {
                        setTimeout(() => {
                            if (type === 'BUFF_ALL' || type === 'BUFF_CATEGORY') {
                                document.querySelectorAll('#opp-board .minion').forEach(m => triggerCombatEffect(m, 'BUFF'));
                            } else if (type === 'HEAL_ALL_FRIENDLY') {
                                document.querySelectorAll('#opp-board .minion').forEach(m => triggerCombatEffect(m, 'HEAL'));
                                triggerCombatEffect(document.getElementById('opp-hero'), 'HEAL');
                            } else if (type === 'BOUNCE_ALL_ENEMY') {
                                triggerFullBoardBounceAnimation(true);
                            }
                        }, 100);
                    }
                }

                await new Promise(r => setTimeout(r, 1000));

            } else if (action.type === 'ATTACK') {
                const attackerIdx = action.attackerIndex;
                const targetType = action.target.type;
                const targetIndex = action.target.index;

                // Visuals
                const attackerEl = document.getElementById('opp-board').children[attackerIdx];
                const targetEl = targetType === 'HERO' ? document.getElementById('player-hero') : document.getElementById('player-board').children[targetIndex];

                if (attackerEl && targetEl) {
                    await animateAttack(attackerEl, targetEl);
                }

                gameState.attack(attackerIdx, action.target);
                render();
                await resolveDeaths();
                await new Promise(r => setTimeout(r, 600));
            }

            moves++;
        }

        gameState.endTurn();
        render();
        showTurnAnnouncement("你的回合");
    } catch (e) {
        logMessage("AI Error: " + e.message);
        console.error(e);
        gameState.endTurn();
        render();
        showTurnAnnouncement("你的回合"); // Ensure turn passes back even on error
    }
}

function render() {
    document.getElementById('turn-indicator').innerText = `TURN: ${gameState.turnCount}`;

    // Toggle Turn Lights
    const isPlayerTurn = gameState.currentPlayerIdx === 0;
    const playerInd = document.getElementById('indicator-player');
    const oppInd = document.getElementById('indicator-opp');
    const endBtn = document.getElementById('end-turn-btn');

    if (playerInd && oppInd) {
        if (isPlayerTurn) {
            playerInd.classList.add('active');
            oppInd.classList.remove('active');
            if (endBtn) endBtn.disabled = false;
        } else {
            playerInd.classList.remove('active');
            oppInd.classList.add('active');
            if (endBtn) endBtn.disabled = true;
        }
    }

    const p1 = gameState.players[0];
    const p2 = gameState.players[1];

    renderMana('player-mana-container', p1.mana);
    renderMana('opp-mana-container', p2.mana);

    document.getElementById('player-hp').innerText = p1.hero.hp;
    document.getElementById('opp-hp').innerText = p2.hero.hp;

    const handEl = document.getElementById('player-hand');
    handEl.innerHTML = '';
    p1.hand.forEach((card, idx) => {
        const cardEl = createCardEl(card, idx);
        handEl.appendChild(cardEl);
    });

    // Detect and animate new cards
    if (p1.hand.length > previousPlayerHandSize) {
        const newCount = p1.hand.length - previousPlayerHandSize;
        const children = handEl.children;
        // Only animate if it looks like a draw event (not a full reload from 0 to 30)
        // Ensure we don't crash if children count mismatch
        if (newCount > 0 && newCount < 15) {
            for (let i = Math.max(0, children.length - newCount); i < children.length; i++) {
                if (children[i]) animateCardFromDeck(children[i]);
            }
        }
    }
    previousPlayerHandSize = p1.hand.length;

    const oppHandEl = document.getElementById('opp-hand');
    oppHandEl.innerHTML = '';
    p2.hand.forEach(() => {
        const back = document.createElement('div');
        back.className = 'card';
        oppHandEl.appendChild(back);
    });

    // Apply Hearthstone-like Arc Logic
    [handEl, oppHandEl].forEach((container, cIdx) => {
        const cards = Array.from(container.children);
        const total = cards.length;
        const center = (total - 1) / 2;

        // Curvature parameters
        const degPerCard = 6;
        const yPerCard = 12; // Stronger curve

        cards.forEach((card, i) => {
            const delta = i - center;
            const rot = delta * degPerCard;
            // Parabolic Curve: y = x^2 * factor roughly
            const y = Math.abs(delta) * Math.abs(delta) * 2 + Math.abs(delta) * 5;

            card.style.setProperty('--rot', `${rot}deg`);
            card.style.setProperty('--y', `${y}px`);
        });
    });

    const boardEl = document.getElementById('player-board');
    boardEl.innerHTML = '';
    p1.board.forEach((minion, idx) => {
        boardEl.appendChild(createMinionEl(minion, idx, true));
    });

    const oppBoardEl = document.getElementById('opp-board');
    oppBoardEl.innerHTML = '';
    p2.board.forEach((minion, idx) => {
        oppBoardEl.appendChild(createMinionEl(minion, idx, false));
    });

    document.querySelector('#player-deck .count-badge').innerText = p1.deck.length;
    // document.querySelector('#player-discard .count-badge').innerText = p1.graveyard?.length || 0;
    document.querySelector('#opp-deck .count-badge').innerText = p2.deck.length;
    // document.querySelector('#opp-discard .count-badge').innerText = p2.graveyard?.length || 0;

    if (gameState.lastAction === 'attack') {
        // Implement visual shake if hit
    }

    // Check for Win/Loss
    if (gameState.winner !== null) {
        setTimeout(() => {
            endGame(gameState.winner === 0 ? 'VICTORY' : 'DEFEAT');
        }, 1000);
    }
}

async function resolveDeaths() {
    const dead = gameState.checkDeaths ? gameState.checkDeaths() : [];

    if (dead.length > 0) {
        const boards = [document.getElementById('player-board'), document.getElementById('opp-board')];
        const animations = [];

        for (const death of dead) {
            const board = (death.side === 'PLAYER') ? boards[0] : boards[1];
            if (board && board.children[death.index]) {
                animations.push(animateShatter(board.children[death.index]));
            }
        }

        await Promise.all(animations);
        gameState.resolveDeaths();
        render();
    }
}

function endGame(result) {
    const resultView = document.getElementById('game-result-view');
    const resultText = document.getElementById('result-status-text');

    resultText.innerText = result === 'VICTORY' ? '勝利' : '敗北';
    resultText.className = `result-text ${result === 'VICTORY' ? 'victory-text' : 'defeat-text'}`;

    showView('game-result-view');
    document.getElementById('game-result-view').style.display = 'flex'; // Ensure flex
}

function formatDesc(text) {
    if (!text) return "";
    // 1. Process explicit bolding: **text** -> <b>text</b>
    let formatted = text.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');

    // 2. Auto-bold common keywords
    const keywords = ["戰吼", "嘲諷", "衝鋒", "光盾", "激怒", "持續效果"];
    keywords.forEach(k => {
        const reg = new RegExp(k, 'g');
        formatted = formatted.replace(reg, `<b>${k}</b>`);
    });

    // 3. Special highlighting for "遺志" (Deathrattle) in yellow
    formatted = formatted.replace(/遺志/g, '<b style="color: #ffd700;">遺志</b>');

    return formatted;
}

function renderMana(containerId, mana) {
    const container = document.getElementById(containerId);
    const textEl = document.getElementById(containerId === 'player-mana-container' ? 'player-mana-text' : 'opp-mana-text');

    container.innerHTML = '';

    for (let i = 0; i < 10; i++) {
        const crystal = document.createElement('div');
        crystal.className = 'mana-crystal';
        if (i < mana.current) {
            crystal.classList.add('active');
        } else if (i < mana.max) {
            crystal.classList.add('spent');
        } else {
            crystal.classList.add('locked');
        }
        container.appendChild(crystal);
    }

    if (textEl) {
        textEl.innerText = `${mana.current}/${mana.max}`;
    }
}

function showPreview(card) {
    const preview = document.getElementById('card-preview');
    const rarityClass = card.rarity ? card.rarity.toLowerCase() : 'common';

    const base = CARD_DATA.find(c => c.id === card.id) || card;
    let statsHtml = '';
    if (card.attack !== undefined && card.health !== undefined && card.type !== 'NEWS') {
        const atkClass = card.attack > base.attack ? 'stat-buffed' : (card.attack < base.attack ? 'stat-damaged' : '');
        const hpClass = (card.currentHealth !== undefined && card.currentHealth < card.health) ? 'stat-damaged' : (card.health > base.health ? 'stat-buffed' : '');
        const hpValue = card.currentHealth !== undefined ? card.currentHealth : card.health;

        // 屬性在最下方 (Stats at bottom) - Revised padding for more description space
        statsHtml = `
        <div class="minion-stats" style="margin-top: auto; padding: 5px 20px 10px 20px; display: flex; justify-content: space-between; width: 100%;">
            <span class="stat-atk ${atkClass}" style="width: 70px; height: 70px; font-size: 32px;"><span>${card.attack}</span></span>
            <span class="stat-hp ${hpClass}" style="width: 70px; height: 70px; font-size: 32px;">${hpValue}</span>
        </div>`;
    }
    // height: 140px; 圖片高度
    const artHtml = card.image ?
        `<div class="card-art" style="width: 100%; height: 140px; background: url('${card.image}') no-repeat center; background-size: cover; border-radius: 4px; margin: 10px auto 5px auto; border: 1px solid rgba(255,255,255,0.2);"></div>` :
        `<div class="card-art" style="width: 100%; height: 140px; background: #333; margin: 10px auto 5px auto; border-radius: 4px;"></div>`;

    const baseCard = CARD_DATA.find(c => c.id === card.id) || card;
    const isReduced = card.cost < baseCard.cost || card.isReduced;
    const costClass = isReduced ? 'cost-reduced' : '';

    preview.innerHTML = `
        <div class="card rarity-${rarityClass} ${card.type === 'NEWS' ? 'news-card' : ''}" style="width:280px; height:410px; transform:none !important; display: flex; flex-direction: column; justify-content: flex-start; padding: 10px;">
            <div style="position: relative; display: flex; align-items: center; width: 100%; margin-bottom: 5px; height: 40px;">
                <div class="card-cost ${costClass}" style="position: relative; width:30px; height:30px; font-size:16px; flex-shrink: 0; z-index: 10; transform: rotate(45deg); margin-left: 5px;"><span>${card.cost ?? 0}</span></div>
                <div class="card-title" style="font-size:28px; position: absolute; left: 0; right: 0; top: 50%; transform: translateY(-50%); margin: 0; text-align: center; text-shadow: 0 0 5px black; z-index: 5;">${card.name || "未知卡片"}</div>
            </div>
            
            ${artHtml}
            
            <div class="card-category" style="font-size:16px; padding: 2px 5px; margin-bottom: 5px; text-align:center; color:#aaa;">${card.category || ""}</div>
            
            <div class="card-desc" style="font-size:18px; padding: 0 10px; line-height: 1.35; height: auto; flex-grow: 1; overflow: hidden; text-align: center; white-space: pre-wrap;">${formatDesc(card.description || "")}</div>
            
            ${statsHtml ? statsHtml.replace(/margin-top: auto;/, 'margin-top: auto; display: flex;') : ''}
        </div>
    `;
    preview.style.display = 'block';
}

function hidePreview() {
    document.getElementById('card-preview').style.display = 'none';
}

function createCardEl(card, index) {
    const el = document.createElement('div');
    const rarityClass = card.rarity ? card.rarity.toLowerCase() : 'common';
    el.className = `card rarity-${rarityClass} ${card.type === 'NEWS' ? 'news-card' : ''}`;
    el.dataset.id = card.id;
    el.dataset.type = card.type;
    el.dataset.category = card.category || '';
    el.dataset.cost = card.cost;
    el.dataset.attack = card.attack || 0;
    el.dataset.health = card.health || 0;

    const base = CARD_DATA.find(c => c.id === card.id) || card;
    let statsHtml = '';
    if (card.attack !== undefined && card.health !== undefined) {
        const atkClass = card.attack > base.attack ? 'stat-buffed' : (card.attack < base.attack ? 'stat-damaged' : '');
        const hpClass = (card.currentHealth !== undefined && card.currentHealth < card.health) ? 'stat-damaged' : (card.health > base.health ? 'stat-buffed' : '');
        const hpValue = card.currentHealth !== undefined ? card.currentHealth : card.health;

        statsHtml = `
        <div class="minion-stats">
            <span class="stat-atk ${atkClass}"><span>${card.attack}</span></span>
            <span class="stat-hp ${hpClass}">${hpValue}</span>
        </div>`;
    }

    const imageStyle = card.image ? `background: url('${card.image}') no-repeat center; background-size: cover; opacity: 0.5;` : '';
    // Use a background on the card itself or insert an element? 
    // Let's insert an element for better control, similar to minion but restricted by space.
    // Or set it as background of the card element?
    // Current .card has background color.

    // Let's try inserting a small art box under the title or behind text? 
    // Given the layout "Cost(TL), Title(Top), Category, Desc", space is tight.
    // Let's put it as a background for the whole card but darkened?

    // Simple approach: Add an art div.
    // Updated Card Layout logic
    // Structure: 
    // Top Row: Cost (Absolute TL), Title (Center/Right)
    // Middle: Image (Block)
    // Bottom: Category, Desc, Stats (Absolute Bottom)

    // We need to ensure .card is flex-col
    // But .card css is already flex-col.
    // Let's remove absolute image and use flow.

    el.style.justifyContent = 'flex-start'; // Align top
    el.style.padding = '2px';

    // Auto-center content in card if short
    // Actually, let's keep top alignment for consistency, but if image is small, the contain handles it.
    // Making background transparent so no "black bars" visible, just card background.
    const artHtml = card.image ?
        `<div class="card-art-box" style="width: 100%; height: 55px; background: url('${card.image}') no-repeat center; background-size: cover; border-radius: 4px; margin: 2px 0; border: 1px solid #444; flex-shrink: 0; background-color: transparent;"></div>` :
        `<div class="card-art-box placeholder" style="width: 100%; height: 40px; background: #222; margin: 5px 0; flex-shrink: 0;"></div>`;

    const baseCard = CARD_DATA.find(c => c.id === card.id) || card;
    const isReduced = card.cost < baseCard.cost || card.isReduced;
    const costClass = isReduced ? 'cost-reduced' : '';

    el.innerHTML = `
        <div class="card-cost ${costClass}"><span>${card.cost}</span></div>
        
        <!-- Header spacer for Cost bubble -->
        <div style="width: 100%; height: 10px;"></div>
        
        <div class="card-title" style="margin: 2px 0; font-size: 10px; z-index: 5; text-shadow: 0 1px 2px #000;">${card.name}</div>
        
        ${artHtml}
        
        <div class="card-category" style="margin: 2px 0; font-size: 7px;">${card.category || ""}</div>
        
        <div class="card-desc" style="font-size: 8px; line-height: 1.1; overflow: hidden; padding: 2px; flex-grow: 1; text-align: center; white-space: pre-wrap;">${formatDesc(card.description)}</div>
        
        <!-- Stats are absolute positioned in CSS usually, but let's check -->
        ${statsHtml}
    `;

    // Preview Interaction
    el.addEventListener('mouseenter', (e) => {
        const preview = document.getElementById('card-preview');
        const builderView = document.getElementById('deck-builder');

        if (builderView && builderView.style.display === 'flex') {
            // Builder Mode: Avoid overlap
            const screenWidth = window.innerWidth;
            // Reset conflict styles
            preview.style.top = 'auto';
            preview.style.transform = 'none';
            // Use CSS bottom positioning

            if (e.clientX < screenWidth / 2) {
                // Cursor Left -> Show Right
                preview.style.left = 'auto';
                preview.style.right = '40px';
            } else {
                // Cursor Right -> Show Left
                preview.style.right = 'auto';
                preview.style.left = '40px';
            }
        } else {
            // Battle Mode (Hand): Fixed Left Top
            preview.style.top = '20%';
            preview.style.left = '20px';
            preview.style.right = 'auto';
            preview.style.bottom = 'auto';
            preview.style.transform = 'none';
        }
        showPreview(card);
    });
    el.addEventListener('mouseleave', hidePreview);

    // Play Card Interaction (Now Drag instead of Click)
    if (index !== -1) { // Only add drag for cards in hand, not in deck builder
        el.addEventListener('mousedown', (e) => onDragStart(e, index, true));
    }

    return el;
}

function createMinionEl(minion, index, isPlayer) {
    const el = document.createElement('div');
    let dsClass = (minion.keywords && minion.keywords.divineShield) ? ' divine-shield' : '';
    let enrageClass = minion.isEnraged ? ' enraged' : '';
    el.className = `minion ${minion.keywords?.taunt ? 'taunt' : ''} ${minion.sleeping ? 'sleeping' : ''} ${minion.canAttack && isPlayer ? 'can-attack' : ''}${dsClass}${enrageClass}`;
    const imageStyle = minion.image ? `background: url('${minion.image}') no-repeat center; background-size: cover;` : '';
    const base = CARD_DATA.find(c => c.id === minion.id) || minion;
    const atkClass = minion.attack > base.attack ? 'stat-buffed' : (minion.attack < base.attack ? 'stat-damaged' : '');
    const hpClass = minion.currentHealth < minion.health ? 'stat-damaged' : (minion.health > base.health ? 'stat-buffed' : '');

    el.innerHTML = `
        <div class="minion-art" style="${imageStyle}"></div>
        <div class="card-title">${minion.name}</div>
        <div class="minion-stats">
            <span class="stat-atk ${atkClass}"><span>${minion.attack}</span></span>
            <span class="stat-hp ${hpClass}">${minion.currentHealth}</span>
        </div>
    `;

    // Preview Interaction
    el.addEventListener('mouseenter', () => showPreview(minion));
    el.addEventListener('mouseleave', hidePreview);

    // Attack Drag Start
    if (isPlayer && minion.canAttack && gameState.currentPlayerIdx === 0) {
        el.addEventListener('mousedown', (e) => onDragStart(e, index));
    }

    // Target Drop Data (Needed for both enemy attacks AND friendly buffs)
    el.dataset.type = 'MINION';
    el.dataset.index = index;
    el.dataset.category = minion.category; // Added for category-based targeting rules
    el.dataset.cost = minion.cost;
    el.dataset.attack = minion.attack;
    el.dataset.health = minion.health;

    return el;
}

let dragging = false;
let attackerIndex = null;
let draggingFromHand = false;
let draggedEl = null;
let isBattlecryTargeting = false;
let battlecrySourceIndex = -1;
let battlecrySourceType = 'MINION'; // 'MINION' or 'NEWS'
let battlecryTargetRule = null;
let draggingMode = 'DAMAGE'; // 'DAMAGE', 'HEAL', 'BUFF'
let currentInsertionIndex = -1;

const dragLine = document.getElementById('drag-line');

function onDragStart(e, index, fromHand = false) {
    if (gameState.currentPlayerIdx !== 0) return;
    if (isBattlecryTargeting) return; // Finish targeting first

    const card = gameState.currentPlayer.hand[index];
    if (fromHand && card && gameState.currentPlayer.mana.current < card.cost) {
        shakeManaContainer(true);
    }

    dragging = true;
    attackerIndex = index;
    draggingFromHand = fromHand;
    draggingMode = 'DAMAGE'; // Reset to default

    dragLine.classList.remove('battlecry-line', 'heal-line', 'buff-line', 'bounce-line');
    dragLine.setAttribute('x1', e.clientX);
    dragLine.setAttribute('y1', e.clientY);
    dragLine.setAttribute('x2', e.clientX);
    dragLine.setAttribute('y2', e.clientY);
    dragLine.style.display = 'block';

    if (fromHand) {
        hidePreview();
        // Visual feedback: clone the card to follow mouse
        const originalEl = document.getElementById('player-hand').children[index];
        draggedEl = originalEl.cloneNode(true);
        draggedEl.style.position = 'fixed';
        draggedEl.style.zIndex = '10000';
        draggedEl.style.pointerEvents = 'none';
        draggedEl.style.opacity = '0.8';
        draggedEl.style.transform = 'scale(0.8)';
        document.body.appendChild(draggedEl);
        updateDraggedElPosition(e.clientX, e.clientY);

        originalEl.style.opacity = '0.2';
    }
}

function updateDraggedElPosition(x, y) {
    if (!draggedEl) return;
    draggedEl.style.left = `${x - 60}px`;
    draggedEl.style.top = `${y - 85}px`;
}

function onDragMove(e) {
    if (!dragging && !isBattlecryTargeting) return;

    if (dragging) {
        dragLine.setAttribute('x2', e.clientX);
        dragLine.setAttribute('y2', e.clientY);

        if (draggingFromHand) {
            updateDraggedElPosition(e.clientX, e.clientY);

            // Get the card being dragged
            const card = gameState.currentPlayer.hand[attackerIndex];

            // Only show placement indicator for minions, not newss
            if (card && card.type === 'MINION') {
                const targetEl = document.elementFromPoint(e.clientX, e.clientY);
                const board = document.getElementById('player-board');
                const isPlayerArea = targetEl?.closest('.player-area.player') || targetEl?.id === 'player-board';

                if (isPlayerArea) {
                    board.classList.add('drop-highlight');

                    let indicator = board.querySelector('.placement-indicator');
                    if (!indicator) {
                        indicator = document.createElement('div');
                        indicator.className = 'placement-indicator';
                        board.appendChild(indicator);
                    }

                    const minions = Array.from(board.children).filter(m => m.classList.contains('minion'));

                    if (minions.length === 0) {
                        currentInsertionIndex = 0;
                        if (indicator.parentElement !== board) board.appendChild(indicator);
                    } else {
                        let found = false;
                        for (let i = 0; i < minions.length; i++) {
                            const rect = minions[i].getBoundingClientRect();
                            const centerX = rect.left + rect.width / 2;

                            if (e.clientX < centerX) {
                                currentInsertionIndex = i;
                                if (board.children[i] !== indicator) {
                                    board.insertBefore(indicator, minions[i]);
                                }
                                found = true;
                                break;
                            }
                        }
                        if (!found) {
                            currentInsertionIndex = minions.length;
                            if (board.lastElementChild !== indicator) {
                                board.appendChild(indicator);
                            }
                        }
                    }
                    indicator.classList.add('active');
                } else {
                    board.classList.remove('drop-highlight');
                    const indicator = board.querySelector('.placement-indicator');
                    if (indicator) {
                        indicator.classList.remove('active');
                    }
                    currentInsertionIndex = -1;
                }
            }
        }
    } else if (isBattlecryTargeting) {
        // Redraw green line from the "pending" card to mouse
        dragLine.setAttribute('x2', e.clientX);
        dragLine.setAttribute('y2', e.clientY);

        const targetEl = document.elementFromPoint(e.clientX, e.clientY);
        const unitEl = targetEl?.closest('[data-type]'); // Look for units (minions or heroes)

        if (unitEl) {
            const side = unitEl.id === 'player-hero' || unitEl.parentElement?.id === 'player-board' ? 'PLAYER' : 'OPPONENT';
            const type = unitEl.dataset.type;
            const idx = unitEl.dataset.index ? parseInt(unitEl.dataset.index) : -1;

            const targetInfo = {
                type: type,
                side: side,
                index: idx,
                category: unitEl.dataset.category || (type === 'HERO' ? '英雄' : ''),
                cost: parseInt(unitEl.dataset.cost) || 0,
                attack: parseInt(unitEl.dataset.attack) || 0,
                health: parseInt(unitEl.dataset.health) || 0
            };

            if (isTargetEligible(battlecryTargetRule, targetInfo)) {
                // Lock-in visual (snap)
                const rect = actualUnitEl.getBoundingClientRect();
                dragLine.setAttribute('x2', rect.left + rect.width / 2);
                dragLine.setAttribute('y2', rect.top + rect.height / 2);
                return;
            }
        }
    }
}

async function onDragEnd(e) {
    if (!dragging && !isBattlecryTargeting) return;

    const board = document.getElementById('player-board');
    board.classList.remove('drop-highlight');

    if (dragging) {
        dragging = false;
        dragLine.style.display = 'none'; // Ensure hide when dragging ends
        dragLine.setAttribute('x1', 0); // Reset coords
        dragLine.setAttribute('y1', 0);

        const indicator = board.querySelector('.placement-indicator');
        if (indicator) indicator.classList.remove('active');
        // Let it collapse naturally via CSS transition

        if (draggingFromHand) {
            // Cleanup visual ghost
            if (draggedEl) {
                draggedEl.remove();
                draggedEl = null;
            }
            const originalEl = document.getElementById('player-hand').children[attackerIndex];
            if (originalEl) originalEl.style.opacity = '1';

            // Temporarily hide ghost to see what's underneath
            if (draggedEl) draggedEl.style.display = 'none';
            const targetEl = document.elementFromPoint(e.clientX, e.clientY);
            if (draggedEl) draggedEl.style.display = 'block';

            const isHandArea = targetEl?.closest('#player-hand');
            const isBoardArea = targetEl?.closest('#player-board') || targetEl?.id === 'player-board';

            if (isHandArea || !isBoardArea) {
                // Return to hand visuals
                logMessage("Play cancelled");
                const originalEl = document.getElementById('player-hand').children[attackerIndex];
                if (originalEl) originalEl.style.opacity = '1';
                render();
                return;
            }

            if (isBoardArea) { // Validated landing on board
                const card = gameState.currentPlayer.hand[attackerIndex];

                if (gameState.currentPlayer.mana.current < card.cost) {
                    shakeManaContainer(true);
                    const originalEl = document.getElementById('player-hand').children[attackerIndex];
                    if (originalEl) originalEl.style.opacity = '1';
                    render();
                    return;
                }

                // Call preview with insertion target for smoke positioning
                const targetSlot = document.getElementById('player-board').children[currentInsertionIndex];
                showCardPlayPreview(card, false, targetSlot);

                if (card.type === 'MINION' && gameState.currentPlayer.board.length >= 7) {
                    logMessage("Board full!");
                    return;
                }

                // Targeted Battlecry check
                const battlecry = card.keywords?.battlecry;
                const isTargeted = battlecry && battlecry.target && typeof battlecry.target === 'object';

                // Show Preview before playing
                await showCardPlayPreview(card);
                // Extra delay for targeted cards so player sees the card land
                if (isTargeted) await new Promise(r => setTimeout(r, 300));

                if (isTargeted) {
                    const validTargets = getValidTargets(battlecry.target);
                    // Special rule: For newss, even if no minions exist, allow hero-targeting UI to trigger
                    // to avoid "dead" drag experience (user can still cancel or try to hit hero if rule allows)
                    if (validTargets.length === 0 && card.type !== 'NEWS') {
                        logMessage("無合法目標！");
                        render();
                        return;
                    }

                    try {
                        let mode = 'DAMAGE';
                        if (battlecry.type === 'HEAL') {
                            mode = 'HEAL';
                        } else if (battlecry.type === 'BUFF_STAT_TARGET' || battlecry.type === 'GIVE_DIVINE_SHIELD' || battlecry.type === 'BUFF_STAT_TARGET_TEMP') {
                            mode = 'BUFF';
                        } else if (battlecry.type === 'BOUNCE_TARGET' || battlecry.type === 'BOUNCE_CATEGORY') {
                            mode = 'BOUNCE';
                        } else if (battlecry.type === 'DAMAGE_NON_CATEGORY') {
                            mode = 'DAMAGE'; // Explicitly set DAMAGE for Hsieh
                        }

                        if (card.type === 'NEWS') {
                            battlecrySourceType = 'NEWS';
                            // Hide the card in hand to simulate it "becoming" the arrow
                            const handCardEl = document.getElementById('player-hand').children[attackerIndex];
                            if (handCardEl) handCardEl.style.opacity = '0';

                            // Arrow starts from hero for newss
                            const heroRect = document.getElementById('player-hero').getBoundingClientRect();
                            const startX = heroRect.left + heroRect.width / 2;
                            const startY = heroRect.top + heroRect.height / 2;

                            // Pass full battlecry object to support category checks
                            startBattlecryTargeting(attackerIndex, startX, startY, mode, battlecry, 'NEWS');
                        } else { // Minion with Battlecry
                            gameState.playCard(attackerIndex, 'PENDING', currentInsertionIndex);
                            render();

                            // The minion IS NOW ON THE BOARD at currentInsertionIndex
                            const rect = document.getElementById('player-board').children[currentInsertionIndex].getBoundingClientRect();
                            const startX = rect.left + rect.width / 2;
                            const startY = rect.top + rect.height / 2;

                            // Pass full battlecry object to support category checks
                            startBattlecryTargeting(currentInsertionIndex, startX, startY, mode, battlecry, 'MINION');
                        }
                    } catch (err) {
                        logMessage(err.message);
                        render();
                    }
                    return;
                }

                try {
                    // 1. Play Card but SKIP battlecry execution in engine
                    const { card: playedCard } = gameState.playCard(attackerIndex, null, currentInsertionIndex, true);

                    // 2. Render to show the minion LANDING on the board
                    render();

                    // 3. Trigger Dust at newly played minion
                    const boardEl = document.getElementById('player-board');
                    const newMinionEl = boardEl.children[currentInsertionIndex];
                    if (newMinionEl && playedCard.type === 'MINION') {
                        spawnDustEffect(newMinionEl, playedCard.cost >= 7 ? 2 : 1);
                    }

                    // 4. WAIT 0.5s (as requested)
                    await new Promise(r => setTimeout(r, 500));

                    // 5. Execute Battlecry manually to get the result/target
                    if (playedCard.keywords && playedCard.keywords.battlecry) {
                        const minionOnBoard = gameState.currentPlayer.board[currentInsertionIndex];
                        const result = gameState.resolveBattlecry(playedCard.keywords.battlecry, null, minionOnBoard);

                        if (result) {
                            // 6. Show Visual Effects based on result
                            if (result.type === 'DAMAGE' || result.type === 'HEAL' || result.type === 'BUFF') {
                                // Find the DOM element for the target
                                let targetEl = null;
                                if (result.target.type === 'HERO') {
                                    targetEl = result.target.side === 'OPPONENT' ? document.getElementById('opp-hero') : document.getElementById('player-hero');
                                } else {
                                    const boardId = result.target.side === 'OPPONENT' ? 'opp-board' : 'player-board';
                                    targetEl = document.getElementById(boardId).children[result.target.index];
                                }

                                if (targetEl) {
                                    // Use mandatory projectile for better visual feedback
                                    await animateAbility(newMinionEl, targetEl, result.type === 'HEAL' ? '#43e97b' : '#ff0000', true);
                                    triggerCombatEffect(targetEl, result.type === 'HEAL' ? 'HEAL' : 'DAMAGE');
                                }
                            } else if (result.type === 'EAT') {
                                // Find target
                                const boardId = result.target.side === 'OPPONENT' ? 'opp-board' : 'player-board';
                                const targetEl = document.getElementById(boardId).children[result.target.index];

                                if (targetEl) {
                                    await animateAbility(newMinionEl, targetEl, '#ff0000', true);
                                    triggerCombatEffect(targetEl, 'DAMAGE');
                                    // Visual delay before buffing self
                                    await new Promise(r => setTimeout(r, 200));
                                    triggerCombatEffect(newMinionEl, 'BUFF');
                                }
                            } else if (result.type === 'HEAL_ALL') {
                                // Trigger Full Board Visual Effect instead of granular ones
                                const isPlayer = result.affected[0]?.unit.side === 'PLAYER';
                                triggerFullBoardHealAnimation(isPlayer);
                            } else if (result.type === 'BOUNCE_ALL') {
                                // Tsai Ing-wen or Cabinet Resignation
                                if (result.bounced && result.bounced.length > 0) {
                                    const isOpponentBoard = result.bounced[0].side === 'OPPONENT';
                                    triggerFullBoardBounceAnimation(!isOpponentBoard);
                                } else {
                                    triggerFullBoardBounceAnimation(false);
                                }
                            } else if (result.type === 'DESTROY_ALL') {
                                // 921 Earthquake
                                triggerEarthquakeAnimation();
                            } else if (result.type === 'DISCARD' || result.type === 'DISCARD_DRAW') {
                                const handEl = document.getElementById('player-hand');
                                let discardEls = [];
                                if (result.indices) {
                                    discardEls = result.indices.map(idx => handEl.children[idx]).filter(el => el);
                                } else if (result.index !== undefined) {
                                    discardEls = [handEl.children[result.index]].filter(el => el);
                                } else {
                                    const count = result.count || 1;
                                    discardEls = Array.from(handEl.children).slice(-count);
                                }

                                // --- PERFECT: DO NOT TOUCH DISCARD_DRAW ANIMATION LOGIC ---
                                // Sequence: Discard -> Render Hand Gap -> Small Wait -> Draw Loop (Render after each)
                                if (discardEls.length > 0) {
                                    await Promise.all(discardEls.map(el => animateDiscard(el)));
                                    render(); // Close the gap in hand immediately
                                    await new Promise(r => setTimeout(r, 300));
                                }
                                if (result.type === 'DISCARD_DRAW' && result.drawCount) {
                                    for (let i = 0; i < result.drawCount; i++) {
                                        gameState.currentPlayer.drawCard();
                                        render();
                                        await new Promise(r => setTimeout(r, 600));
                                    }
                                }
                            } else if (result.type === 'BUFF_HAND') {
                                const handEl = document.getElementById('player-hand');
                                handEl.classList.add('hand-flash');
                                setTimeout(() => handEl.classList.remove('hand-flash'), 500);
                            }
                        }
                    }

                    // --- PERFECT: DO NOT TOUCH S001 ANIMATION LOGIC ---
                    if (playedCard.keywords?.battlecry?.type === 'DRAW') {
                        const drawCount = playedCard.keywords.battlecry.value || 1;
                        for (let i = 0; i < drawCount; i++) {
                            gameState.currentPlayer.drawCard();
                            render();
                            await new Promise(r => setTimeout(r, 600));
                        }
                    }

                    // Final Render to update all stats
                    render();
                    await resolveDeaths();

                } catch (err) {
                    logMessage(err.message);
                    render();
                }
            } else {
                // Return to hand visuals (already handled by cleaning up ghost)
                logMessage("Play cancelled");
                render(); // Ensure correct state
            }
            return;
        }

        // Standard Attack
        const targetEl = document.elementFromPoint(e.clientX, e.clientY);
        const targetData = targetEl?.closest('[data-type]');
        if (targetData) {
            const type = targetData.dataset.type;
            const index = parseInt(targetData.dataset.index);

            if (type === 'HERO' && targetData.id === 'opp-hero'
                || type === 'MINION' && targetEl.closest('#opp-board')) {

                try {
                    const sourceEl = document.getElementById('player-board').children[attackerIndex];
                    if (sourceEl && targetData) {
                        await animateAttack(sourceEl, targetData);
                    }
                    gameState.attack(attackerIndex, { type, index });
                    render();
                    await resolveDeaths();
                } catch (err) {
                    logMessage(err.message);
                }
            }
        }
    } else if (isBattlecryTargeting) {
        console.log("Battlecry Targeting Try Finish. SourceType:", battlecrySourceType);

        const targetEl = document.elementFromPoint(e.clientX, e.clientY);
        const unitEl = targetEl?.closest('[data-type]');
        console.log("Target Candidate Found:", unitEl?.id || unitEl?.className, unitEl?.dataset?.type);

        let target = null;
        if (unitEl) {
            const side = unitEl.id === 'player-hero' || unitEl.parentElement?.id === 'player-board' ? 'PLAYER' : 'OPPONENT';
            const type = unitEl.dataset.type;
            const idx = unitEl.dataset.index ? parseInt(unitEl.dataset.index) : -1;

            const targetInfo = {
                type: type,
                side: side,
                index: idx,
                category: unitEl.dataset.category || (type === 'HERO' ? '英雄' : ''),
                cost: parseInt(unitEl.dataset.cost) || 0,
                attack: parseInt(unitEl.dataset.attack) || 0,
                health: parseInt(unitEl.dataset.health) || 0
            };

            if (isTargetEligible(battlecryTargetRule, targetInfo)) {
                target = targetInfo;
            } else {
                logMessage("Invalid target!");
                // DO NOT clear targeting state, let user try again
                return;
            }
        } else {
            // Clicked background or non-unit -> Cancel
            cancelBattlecryTargeting();
            return;
        }

        // ONLY clear state if we have a valid target
        isBattlecryTargeting = false;
        dragLine.style.display = 'none'; // Critical: Hide line


        try {
            if (target) {
                // 1. Identify Source & Dest for Animation
                let sourceEl;
                if (battlecrySourceType === 'NEWS') {
                    // Source is Hand Card (it's hidden but element exists until render)
                    sourceEl = document.getElementById('player-hand').children[battlecrySourceIndex];
                } else {
                    // Source is Minion on Board (already placed)
                    sourceEl = document.getElementById('player-board').children[battlecrySourceIndex];
                }

                const destEl = target.type === 'HERO' ?
                    (target.side === 'OPPONENT' ? document.getElementById('opp-hero') : document.getElementById('player-hero')) :
                    (target.side === 'OPPONENT' ? document.getElementById('opp-board').children[target.index] : document.getElementById('player-board').children[target.index]);

                // 2. Animate BEFORE applying logic (so target is still alive)
                if (sourceEl && destEl) {
                    let color = '#ff0000'; // Default Damage Red
                    let effectType = 'DAMAGE';

                    // Determine color based on card/mode
                    if (draggingMode === 'HEAL') { color = '#43e97b'; effectType = 'HEAL'; }
                    else if (draggingMode === 'BUFF') { color = '#ffa500'; effectType = 'BUFF'; }
                    else if (draggingMode === 'BOUNCE') { color = '#a335ee'; effectType = 'BOUNCE'; }

                    await animateAbility(sourceEl, destEl, color, draggingMode !== 'HEAL');
                    triggerCombatEffect(destEl, effectType);

                    // Impact Delay (Reduced for efficiency)
                    await new Promise(r => setTimeout(r, 400));
                }

                // 3. Execute Game Logic (Phase 2)
                if (battlecrySourceType === 'NEWS') {
                    // For News: Now we play it
                    const card = gameState.currentPlayer.hand[battlecrySourceIndex];
                    gameState.playCard(battlecrySourceIndex, target);
                } else {
                    // For Minion: It's already pending on board, just resolve battlecry
                    const minionInfo = gameState.currentPlayer.board[battlecrySourceIndex];
                    if (minionInfo && minionInfo.keywords?.battlecry) {
                        gameState.resolveBattlecry(minionInfo.keywords.battlecry, target, minionInfo);
                    }
                }

                render();
                await resolveDeaths();

            } else {
                // Non-targeted logic (Fallback for Minions played without target if flow allows, or AOE)
                // Note: If battlecrySourceType is NEWS and target is null, we cancelled (handled in 'else' of outer block if exists, but here structure is try/catch)
                // Actually, earlier we checked 'if (target)'. If not target...
                // If it's a MINION with non-targeted battlecry (e.g. AOE), we should trigger it.

                if (battlecrySourceType === 'MINION') {
                    const minion = gameState.currentPlayer.board[battlecrySourceIndex];
                    if (minion && minion.keywords?.battlecry) {
                        gameState.resolveBattlecry(minion.keywords.battlecry, null);
                        render();
                        await resolveDeaths();

                        // Visuals for AOE
                        const bcType = minion.keywords.battlecry.type;
                        setTimeout(() => {
                            if (bcType === 'BUFF_ALL' || bcType === 'BUFF_CATEGORY') {
                                document.querySelectorAll('#player-board .minion').forEach(m => triggerCombatEffect(m, 'BUFF'));
                            } else if (bcType === 'HEAL_ALL_FRIENDLY') {
                                document.querySelectorAll('#player-board .minion').forEach(m => triggerCombatEffect(m, 'HEAL'));
                                triggerCombatEffect(document.getElementById('player-hero'), 'HEAL');
                            } else if (bcType === 'GIVE_DIVINE_SHIELD_ALL') {
                                document.querySelectorAll('#player-board .minion').forEach(m => triggerCombatEffect(m, 'BUFF'));
                            } else if (bcType === 'DAMAGE_RANDOM_FRIENDLY') {
                                document.querySelectorAll('#player-board .minion').forEach(m => triggerCombatEffect(m, 'DAMAGE'));
                            }
                        }, 100);
                    }
                }
                // If News and no target, we do nothing (cancel).
            }
        } catch (err) {
            logMessage(err.message);
            render(); // Reset UI
        }
    }
    currentInsertionIndex = -1;
}

// --- Targeting Helpers ---
function cancelBattlecryTargeting() {
    if (!isBattlecryTargeting) return;
    isBattlecryTargeting = false;
    dragLine.style.display = 'none';

    if (battlecrySourceType === 'MINION') {
        // Refund Minion: Remove from board, put back in hand
        const minion = gameState.currentPlayer.board.splice(battlecrySourceIndex, 1)[0];
        if (minion) {
            // Restore mana
            gameState.currentPlayer.mana.current += minion.cost;
            gameState.currentPlayer.hand.push(minion);
            logMessage("取消出牌 (隨從已退回)");
        }
    } else {
        // News: Mana wasn't spent yet, just show card again
        const handCardEl = document.getElementById('player-hand').children[battlecrySourceIndex];
        if (handCardEl) handCardEl.style.opacity = '1';
        logMessage("取消出牌");
    }
    render();
}
function isTargetEligible(rule, targetInfo) {
    if (!rule || !targetInfo) return false;

    // Support both simple target rules and full battlecry objects
    const actualRule = rule.target || rule;
    const categoryToExclude = rule.target_category;

    // Category Exclusion check (e.g. Hsieh Chang-ting)
    if (categoryToExclude && rule.type === 'DAMAGE_NON_CATEGORY' && targetInfo.category === categoryToExclude) return false;

    // Category Inclusion check (e.g. S003 Great Recall)
    // Note: target_category in GIVE_DIVINE_SHIELD_CATEGORY is strict match, handled by engine mostly, but for UI:
    if (rule.target_category_includes) {
        if (!targetInfo.category || !targetInfo.category.includes(rule.target_category_includes)) return false;
    }

    // Cost checks (if applicable)
    if (actualRule.min_cost !== undefined && targetInfo.cost < actualRule.min_cost) return false;
    if (actualRule.max_cost !== undefined && targetInfo.cost > actualRule.max_cost) return false;

    // Side check
    if (actualRule.side === 'ENEMY' && targetInfo.side !== 'OPPONENT') return false;
    if (actualRule.side === 'FRIENDLY' && targetInfo.side !== 'PLAYER') return false;

    // Type check
    if (!actualRule.type || actualRule.type === 'ANY' || actualRule.type === 'ALL') {
        return true;
    }

    if (actualRule.type === 'MINION' && targetInfo.type !== 'MINION') return false;
    if (actualRule.type === 'HERO' && targetInfo.type !== 'HERO') return false;

    return true;
}

function getValidTargets(rule) {
    if (!rule) return [];
    const targets = [];

    // Helper to format consistent target info for comparison
    const createTargetInfo = (unit, side, type, index) => ({
        type: type,
        side: side,
        index: index,
        category: unit.category || (type === 'HERO' ? '英雄' : ''),
        cost: unit.cost || 0,
        attack: unit.attack || 0,
        health: unit.health || 0
    });

    // Check Players
    const p1Hero = createTargetInfo(gameState.players[0].hero, 'PLAYER', 'HERO', -1);
    const p2Hero = createTargetInfo(gameState.players[1].hero, 'OPPONENT', 'HERO', -1);

    if (isTargetEligible(rule, p1Hero)) targets.push(p1Hero);
    if (isTargetEligible(rule, p2Hero)) targets.push(p2Hero);

    // Check Player Board
    gameState.players[0].board.forEach((m, i) => {
        const info = createTargetInfo(m, 'PLAYER', 'MINION', i);
        if (isTargetEligible(rule, info)) targets.push(info);
    });

    // Check Opponent Board
    gameState.players[1].board.forEach((m, i) => {
        const info = createTargetInfo(m, 'OPPONENT', 'MINION', i);
        if (isTargetEligible(rule, info)) targets.push(info);
    });

    return targets;
}

function startBattlecryTargeting(sourceIndex, x, y, mode = 'DAMAGE', targetRule = null, sourceType = 'MINION') {
    isBattlecryTargeting = true;
    battlecrySourceIndex = sourceIndex;
    battlecrySourceType = sourceType;
    draggingMode = mode;
    battlecryTargetRule = targetRule;

    dragLine.classList.add('battlecry-line');
    if (mode === 'HEAL') dragLine.classList.add('heal-line');
    if (mode === 'BUFF') dragLine.classList.add('buff-line');
    if (mode === 'BOUNCE') dragLine.classList.add('bounce-line');

    dragLine.setAttribute('x1', x);
    dragLine.setAttribute('y1', y);
    dragLine.setAttribute('x2', x);
    dragLine.setAttribute('y2', y);
    dragLine.style.display = 'block';

    logMessage("Choose a target for Battlecry!");
}

/**
 * Handles visual effects for battlecries (Now handled in onDragEnd)
 */
async function handleBattlecryVisuals(sourceEl, targetEl) {
    if (sourceEl && targetEl) {
        await animateAbility(sourceEl, targetEl, '#43e97b'); // Green arrow
    }
}

/**
 * Animates a projectile from start to end.
 */
function animateAbility(fromEl, toEl, color, shouldShake = true) {
    return new Promise(resolve => {
        const rectFrom = fromEl.getBoundingClientRect();
        const rectTo = toEl.getBoundingClientRect();

        const projectile = document.createElement('div');
        projectile.className = 'ability-projectile';
        // Set dynamic color for ::after element
        if (color) projectile.style.setProperty('--projectile-color', color);
        projectile.style.left = `${rectFrom.left + rectFrom.width / 2}px`;
        projectile.style.top = `${rectFrom.top + rectFrom.height / 2}px`;

        // Calculate Angle
        const dx = (rectTo.left + rectTo.width / 2) - (rectFrom.left + rectFrom.width / 2);
        const dy = (rectTo.top + rectTo.height / 2) - (rectFrom.top + rectFrom.height / 2);
        const angle = Math.atan2(dy, dx) * 180 / Math.PI;

        projectile.style.transform = `rotate(${angle}deg)`;

        document.body.appendChild(projectile);

        // Transition
        setTimeout(() => {
            projectile.style.transition = 'all 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
            projectile.style.left = `${rectTo.left + rectTo.width / 2}px`;
            projectile.style.top = `${rectTo.top + rectTo.height / 2}px`;
            projectile.style.opacity = '1';
        }, 10);

        setTimeout(() => {
            // Shake Target
            if (shouldShake) {
                toEl.classList.add('shaking');
                setTimeout(() => toEl.classList.remove('shaking'), 500);
            }

            projectile.remove();
            resolve();
        }, 550);
    });
}

/**
 * Animates a card being discarded (Thanos-style disintegration).
 */
async function animateDiscard(cardEl) {
    return new Promise(resolve => {
        const rect = cardEl.getBoundingClientRect();
        const clone = cardEl.cloneNode(true);
        clone.style.position = 'fixed';
        clone.style.top = rect.top + 'px';
        clone.style.left = rect.left + 'px';
        clone.style.width = rect.width + 'px';
        clone.style.height = rect.height + 'px';
        clone.style.zIndex = '10000';
        clone.style.margin = '0';
        clone.style.transition = 'opacity 0.8s ease-in';
        clone.style.pointerEvents = 'none';
        document.body.appendChild(clone);

        // Hide original card element
        cardEl.style.visibility = 'hidden';

        // Force reflow
        clone.offsetHeight;

        // Generate Particles
        const particleCount = 80; // Increased
        const colors = ['#a335ee', '#444444', '#888888', '#ffffff'];

        for (let i = 0; i < particleCount; i++) {
            const p = document.createElement('div');
            p.className = 'disintegrate-particle';

            // Random color from set
            p.style.background = colors[Math.floor(Math.random() * colors.length)];

            // Random start pos within card
            const startX = rect.left + Math.random() * rect.width;
            const startY = rect.top + Math.random() * rect.height;

            p.style.left = startX + 'px';
            p.style.top = startY + 'px';

            // Random size (some tiny, some larger)
            const size = 1 + Math.random() * 5;
            p.style.width = size + 'px';
            p.style.height = size + 'px';

            // Random trajectory (Expanding sphere + Floating UP)
            const angle = Math.random() * Math.PI * 2;
            const dist = 50 + Math.random() * 100;
            const dx = Math.cos(angle) * dist + (Math.random() - 0.5) * 100;
            const dy = Math.sin(angle) * dist - (200 + Math.random() * 300); // Heavy UP bias
            const dr = (Math.random() - 0.5) * 720;

            p.style.setProperty('--dx', dx + 'px');
            p.style.setProperty('--dy', dy + 'px');
            p.style.setProperty('--dr', dr + 'deg');

            // Staggered delay for "crumbling" look
            p.style.animationDelay = (Math.random() * 0.6) + 's';

            document.body.appendChild(p);

            // Remove after animation
            setTimeout(() => p.remove(), 2100);
        }

        // Fade out the main card body slightly slower than animation start
        setTimeout(() => {
            clone.style.opacity = '0';
        }, 100);

        setTimeout(() => {
            clone.remove();
            resolve();
        }, 1500);
    });
}

/**
 * Animates a card flying from start element to end element and slamming.
 * @param {HTMLElement} fromEl 
 * @param {HTMLElement} toEl 
 */
function animateAttack(fromEl, toEl) {
    return new Promise(resolve => {
        const rectFrom = fromEl.getBoundingClientRect();
        const rectTo = toEl.getBoundingClientRect();

        // Create Clone
        const clone = fromEl.cloneNode(true);
        clone.classList.add('animating-attack');

        // Remove specific styles that might interfere with attack visual
        clone.classList.remove('taunt');
        clone.classList.remove('sleeping');
        clone.classList.remove('can-attack');
        clone.classList.remove('divine-shield'); // Fix: Remove shield visual during flight
        clone.style.borderRadius = '12px'; // Standard shape for attack flight

        // Initial Position
        clone.style.top = `${rectFrom.top}px`;
        clone.style.left = `${rectFrom.left}px`;
        clone.style.width = `${rectFrom.width}px`;
        clone.style.height = `${rectFrom.height}px`;
        clone.style.margin = '0'; // Clear margins

        document.body.appendChild(clone);

        // Force Reflow
        void clone.offsetWidth;

        // Target Position
        // Center to Center
        const centerX = rectTo.left + rectTo.width / 2 - rectFrom.width / 2;
        const centerY = rectTo.top + rectTo.height / 2 - rectFrom.height / 2;

        clone.style.top = `${centerY}px`;
        clone.style.left = `${centerX}px`;
        clone.style.transform = "scale(1.2)"; // Bigger on impact

        // On Transition End (Impact)
        setTimeout(() => {
            // Shake Target
            toEl.classList.add('shaking');
            setTimeout(() => toEl.classList.remove('shaking'), 500);

            // Trigger Combat Effect (Slash)
            triggerCombatEffect(toEl, 'DAMAGE');
            spawnDustEffect(toEl, 0.5); // Minor impact dust

            // Cleanup Clone
            setTimeout(() => {
                clone.remove();
                resolve();
            }, 100);
        }, 450); // Slightly longer than CSS to ensure completion
    });
}

function logMessage(msg) {
    const log = document.getElementById('message-log');
    const line = document.createElement('div');
    line.innerText = msg;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
}

/**
 * --- GOLD STANDARD DRAW ANIMATION ---
 * This function handles the "fly from deck to hand" visuals.
 * DO NOT change the timing or bezier curve without explicit request.
 * Reference for S001 (Perfect Animation).
 * @param {HTMLElement} cardEl The final destination element in hand
 */
function animateCardFromDeck(cardEl) {
    const deckEl = document.getElementById('player-deck');
    if (!deckEl || !cardEl) return;

    cardEl.style.opacity = '0';

    requestAnimationFrame(() => {
        const deckRect = deckEl.getBoundingClientRect();
        const cardRect = cardEl.getBoundingClientRect();

        const clone = cardEl.cloneNode(true);
        clone.style.position = 'fixed';
        clone.style.left = '0';
        clone.style.top = '0';
        clone.style.width = `${cardEl.offsetWidth || 100}px`;
        clone.style.height = `${cardEl.offsetHeight || 140}px`;
        clone.style.zIndex = '9999';
        clone.style.margin = '0';

        // Use transform for hardware acceleration
        const startX = deckRect.left;
        const startY = deckRect.top;
        const endX = cardRect.left;
        const endY = cardRect.top;

        clone.style.transform = `translate(${startX}px, ${startY}px) scale(0.5)`;
        clone.style.transition = 'none'; // Initial position without transition
        clone.style.pointerEvents = 'none';
        clone.style.opacity = '1';
        clone.className = cardEl.className;

        document.body.appendChild(clone);

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                clone.style.transition = 'transform 0.6s cubic-bezier(0.18, 0.89, 0.32, 1.15), opacity 0.3s ease';
                clone.style.transform = `translate(${endX}px, ${endY}px) scale(1)`;
            });
        });

        clone.addEventListener('transitionend', (e) => {
            if (e.propertyName === 'transform') {
                clone.remove();
                cardEl.style.opacity = '1';
            }
        });
    });
}

/**
 * Shows a large 3D preview of the card in the center before it hits the board.
 */
async function showCardPlayPreview(card, isAI = false, targetEl = null) {
    const overlay = document.getElementById('play-preview-overlay');
    overlay.innerHTML = '';
    overlay.style.display = 'flex';

    // Create a big version of the card manually to ensure perfect scaling
    const rarityClass = card.rarity ? card.rarity.toLowerCase() : 'common';
    const cardEl = document.createElement('div');
    cardEl.className = `card rarity-${rarityClass} preview-card-3d ${card.type === 'NEWS' ? 'news-card' : ''}`;

    // We override styles for the 3D preview
    cardEl.style.width = '280px';
    cardEl.style.height = '410px';
    cardEl.style.fontSize = '20px'; // Adjusted

    const base = CARD_DATA.find(c => c.id === card.id) || card;
    let statsHtml = '';
    if (card.attack !== undefined && card.health !== undefined) {
        const atkClass = card.attack > base.attack ? 'stat-buffed' : (card.attack < base.attack ? 'stat-damaged' : '');
        const hpClass = (card.currentHealth !== undefined && card.currentHealth < card.health) ? 'stat-damaged' : (card.health > base.health ? 'stat-buffed' : '');
        const hpValue = card.currentHealth !== undefined ? card.currentHealth : card.health;

        // 屬性在最下方 (Stats at bottom) - Revised padding for more description space
        statsHtml = `
        <div class="minion-stats" style="margin-top: auto; padding: 5px 15px 10px 15px; display: flex; justify-content: space-between; width: 100%;">
            <span class="stat-atk ${atkClass}" style="width: 60px; height: 60px; font-size: 28px;"><span>${card.attack}</span></span>
            <span class="stat-hp ${hpClass}" style="width: 60px; height: 60px; font-size: 28px;">${hpValue}</span>
        </div>`;
    }

    cardEl.style.padding = '8px'; // Slightly tighter padding
    cardEl.style.justifyContent = 'flex-start'; // Ensure content starts at top

    // Define Art HTML inline to ensure custom margin applies
    const customArtHtml = card.image ?
        `<div class="card-art" style="width: 100%; height: 150px; background: url('${card.image}') no-repeat center; background-size: cover; border-radius: 4px; margin: 10px auto 5px auto; border: 1px solid rgba(255,255,255,0.2);"></div>` :
        `<div class="card-art" style="width: 100%; height: 100px; background: #333; margin: 10px auto 5px auto; border-radius: 4px;"></div>`;

    cardEl.innerHTML = `
        <div style="position: relative; display: flex; align-items: center; width: 100%; margin-bottom: 5px; height: 40px;">
            <div class="card-cost" style="position: relative; width:30px; height:30px; font-size:16px; flex-shrink: 0; z-index: 10; transform: rotate(45deg); margin-left: 5px;"><span>${card.cost}</span></div>
            <div class="card-title" style="font-size:28px; position: absolute; left: 0; right: 0; top: 50%; transform: translateY(-50%); margin: 0; text-align: center; text-shadow: 0 0 5px black; z-index: 5;">${card.name}</div>
        </div>
        ${customArtHtml}
        <div class="card-category" style="font-size:16px; padding: 2px 10px; margin-bottom: 5px; flex-shrink: 0; text-align: center; color: #aaa;">${card.category || ""}</div>
        <div class="card-desc" style="font-size:18px; padding: 0 10px; line-height: 1.35; height: auto; flex-grow: 1; overflow: hidden; text-align: center; white-space: pre-wrap;">${formatDesc(card.description)}</div>
        ${statsHtml}
    `;

    overlay.appendChild(cardEl);

    // AI cards might need a slight delay to be noticed
    await new Promise(r => setTimeout(r, 800));

    // Slam phase
    cardEl.classList.add('slamming');

    // Board shake and dust - ONLY for minions
    if (card.type === 'MINION') {
        const boardId = isAI ? 'opp-board' : 'player-board';
        const boardEl = document.getElementById(boardId);
        if (boardEl) {
            setTimeout(() => {
                boardEl.classList.remove('board-slam');
                void boardEl.offsetWidth;
                boardEl.classList.add('board-slam');

                // Intensify dust for high cost cards - spawn at PREVIEW CARD or TARGET SLOT
                const intensity = card.cost >= 7 ? 2.5 : 1;
                const smokeAnchor = targetEl || boardEl || cardEl;
                spawnDustEffect(smokeAnchor, intensity);
                setTimeout(() => boardEl.classList.remove('board-slam'), 500);
            }, 300); // Wait for card to hit the board
        }
    }

    await new Promise(r => setTimeout(r, 400));

    overlay.style.display = 'none';
    overlay.innerHTML = '';
}

/**
 * Spawns dust particles on a target element (board).
 */
function spawnDustEffect(targetEl, intensity = 1) {
    const rect = targetEl.getBoundingClientRect();
    const cloud = document.createElement('div');
    cloud.className = 'dust-cloud';
    cloud.style.left = `${rect.left + rect.width / 2}px`;
    cloud.style.top = `${rect.top + rect.height * 0.8}px`; // Bottom of element
    cloud.style.zIndex = "45000"; // Below preview card
    document.body.appendChild(cloud);

    const count = Math.floor(15 * intensity);
    for (let i = 0; i < count; i++) {
        const p = document.createElement('div');
        p.className = 'dust-particle';
        const angle = Math.random() * Math.PI * 2;
        const dist = (60 + Math.random() * 100) * (intensity > 1 ? 1.8 : 1);
        p.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
        p.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
        const size = (15 + Math.random() * 25) * (intensity > 1 ? 1.6 : 1);
        p.style.width = p.style.height = `${size}px`;
        p.style.backgroundColor = 'rgba(200, 200, 200, 0.4)';
        cloud.appendChild(p);
    }
    setTimeout(() => cloud.remove(), 1000);
}

/**
 * Shatters a minion element into fragments.
 */
function animateShatter(el) {
    return new Promise(async resolve => {
        el.classList.add('dying');
        await new Promise(r => setTimeout(r, 400));

        const rect = el.getBoundingClientRect();
        const container = document.createElement('div');
        container.style.position = 'fixed';
        container.style.left = `${rect.left}px`;
        container.style.top = `${rect.top}px`;
        container.style.width = `${rect.width}px`;
        container.style.height = `${rect.height}px`;
        container.style.pointerEvents = 'none';
        container.style.zIndex = '2000';
        document.body.appendChild(container);

        el.style.visibility = 'hidden';

        const cols = 4, rows = 5;
        const fragW = rect.width / cols;
        const fragH = rect.height / rows;
        const artEl = el.querySelector('.minion-art');
        const bgImg = artEl ? artEl.style.backgroundImage : null;

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const frag = document.createElement('div');
                frag.className = 'shatter-fragment';
                frag.style.width = `${fragW}px`;
                frag.style.height = `${fragH}px`;
                frag.style.left = `${c * fragW}px`;
                frag.style.top = `${r * fragH}px`;

                if (bgImg) {
                    frag.style.backgroundImage = bgImg;
                    frag.style.backgroundSize = `${rect.width}px ${rect.height}px`;
                    frag.style.backgroundPosition = `-${c * fragW}px -${r * fragH}px`;
                } else {
                    frag.style.backgroundColor = '#333';
                    frag.style.backgroundImage = 'linear-gradient(135deg, #444, #111)';
                }

                const angle = Math.random() * Math.PI * 2;
                const dist = 50 + Math.random() * 150;
                frag.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
                frag.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
                frag.style.setProperty('--dr', `${(Math.random() - 0.5) * 600}deg`);

                container.appendChild(frag);
            }
        }

        setTimeout(() => {
            container.remove();
            resolve();
        }, 800);
    });
}

/**
 * Spawns a floating combat effect on a unit.
 * @param {HTMLElement} el The target element
 * @param {string} type 'DAMAGE', 'HEAL', or 'BUFF'
 */
function triggerCombatEffect(el, type) {
    if (!el) return;
    const container = document.createElement('div');
    container.className = 'combat-effect';

    if (type === 'DAMAGE') {
        const slash = document.createElement('div');
        slash.className = 'slash-effect';
        container.appendChild(slash);
    } else if (type === 'HEAL') {
        const count = 6;
        for (let i = 0; i < count; i++) {
            const p = document.createElement('div');
            p.className = 'heal-particle';
            p.innerText = '+';
            p.style.left = `${Math.random() * 60 + 20}%`;
            p.style.top = `${Math.random() * 60 + 20}%`;
            p.style.fontSize = `${16 + Math.random() * 14}px`;
            p.style.animationDelay = `${Math.random() * 0.4}s`;
            container.appendChild(p);
        }
    } else if (type === 'BUFF') {
        const count = 5;
        for (let i = 0; i < count; i++) {
            const p = document.createElement('div');
            p.className = 'buff-particle';
            p.innerText = '↑';
            p.style.left = `${Math.random() * 60 + 20}%`;
            p.style.top = `${Math.random() * 60 + 20}%`;
            p.style.fontSize = `${18 + Math.random() * 12}px`;
            p.style.animationDelay = `${Math.random() * 0.4}s`;
            container.appendChild(p);
        }
    } else if (type === 'BOUNCE') {
        const count = 3;
        for (let i = 0; i < count; i++) {
            const p = document.createElement('div');
            p.className = 'buff-particle'; // Re-use class for basic float, but override color/text
            p.innerText = '↩';
            p.style.color = '#a335ee';
            p.style.textShadow = '0 0 5px #a335ee';
            p.style.left = `${Math.random() * 60 + 20}%`;
            p.style.top = `${Math.random() * 60 + 20}%`;
            p.style.fontSize = `${20 + Math.random() * 12}px`;
            p.style.animationDelay = `${Math.random() * 0.4}s`;
            container.appendChild(p);
        }
    }

    el.appendChild(container);
    // Ensure visibility
    container.style.display = 'flex';
    setTimeout(() => {
        container.remove();
    }, 1000);
}

// Global listeners
window.addEventListener('contextmenu', (e) => {
    if (isBattlecryTargeting) {
        e.preventDefault();
        cancelBattlecryTargeting();
    }
});

// Start
init();

function showToast(message) {
    let toast = document.getElementById('toast-notification');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast-notification';
        toast.className = 'toast';
        document.body.appendChild(toast);
    }
    toast.innerText = message;
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 2000);
}

function showTurnAnnouncement(text) {
    const overlay = document.getElementById('turn-announcement-overlay');
    const textEl = overlay.querySelector('.turn-text');
    if (!textEl) return;

    textEl.innerText = text;

    overlay.style.display = 'flex';
    // Force reflow
    void overlay.offsetWidth;
    overlay.classList.add('active');

    setTimeout(() => {
        overlay.classList.remove('active');
        setTimeout(() => {
            overlay.style.display = 'none';
        }, 300); // Match transition duration
    }, 1500); // Show for 1.5s
}

function showCustomAlert(message) {
    return new Promise(resolve => {
        const modal = document.getElementById('custom-modal');
        const msgEl = document.getElementById('custom-modal-message');
        const confirmBtn = document.getElementById('btn-custom-confirm');
        const cancelBtn = document.getElementById('btn-custom-cancel');

        msgEl.innerText = message;
        cancelBtn.style.display = 'none'; // Alert only has OK
        modal.style.display = 'flex';

        confirmBtn.onclick = () => {
            modal.style.display = 'none';
            resolve();
        };
    });
}

function showCustomConfirm(message) {
    return new Promise(resolve => {
        const modal = document.getElementById('custom-modal');
        const msgEl = document.getElementById('custom-modal-message');
        const confirmBtn = document.getElementById('btn-custom-confirm');
        const cancelBtn = document.getElementById('btn-custom-cancel');

        msgEl.innerText = message;
        cancelBtn.style.display = 'inline-block'; // Confirm has Cancel
        modal.style.display = 'flex';

        confirmBtn.onclick = () => {
            modal.style.display = 'none';
            resolve(true);
        };

        cancelBtn.onclick = () => {
            modal.style.display = 'none';
            resolve(false);
        };
    });
}

/**
 * Triggers a full-board healing animation.
 * @param {boolean} isPlayer Whether to heal player board or opponent board
 */
async function triggerFullBoardHealAnimation(isPlayer) {
    const boardId = isPlayer ? 'player-board' : 'opp-board';
    const boardEl = document.getElementById(boardId);
    if (!boardEl) return;

    // 1. Board Flash
    boardEl.classList.remove('board-heal-flash');
    void boardEl.offsetWidth; // Force reflow
    boardEl.classList.add('board-heal-flash');
    setTimeout(() => boardEl.classList.remove('board-heal-flash'), 1500);

    // 2. Background Particles爆炸
    const rect = boardEl.getBoundingClientRect();
    const particleCount = 20;
    for (let i = 0; i < particleCount; i++) {
        const p = document.createElement('div');
        p.className = 'bg-heal-particle';
        p.innerText = '+';

        // Random position within the board area
        const x = rect.left + Math.random() * rect.width;
        const y = rect.top + Math.random() * rect.height;

        p.style.left = `${x}px`;
        p.style.top = `${y}px`;

        // Random size and delay
        p.style.fontSize = `${20 + Math.random() * 20}px`;
        p.style.animationDelay = `${Math.random() * 0.5}s`;

        document.body.appendChild(p);
        setTimeout(() => p.remove(), 2500);
    }
}

/**
 * Triggers a full-board bounce animation (Return to hand).
 * @param {boolean} isPlayer Whether to bounce player board or opponent board
 */
async function triggerFullBoardBounceAnimation(isPlayer) {
    const boardId = isPlayer ? 'player-board' : 'opp-board';
    const boardEl = document.getElementById(boardId);
    if (!boardEl) return;

    // 1. Board Flash (Purple Neon)
    boardEl.classList.remove('board-purple-flash');
    void boardEl.offsetWidth; // Force reflow
    boardEl.classList.add('board-purple-flash');
    setTimeout(() => boardEl.classList.remove('board-purple-flash'), 1500);

    // 2. Background Particles (Rotation Arrows)
    const rect = boardEl.getBoundingClientRect();
    const particleCount = 20;
    const arrowChars = ['↻', '↺', '↩'];
    for (let i = 0; i < particleCount; i++) {
        const p = document.createElement('div');
        p.className = 'bg-bounce-particle';
        p.innerText = arrowChars[Math.floor(Math.random() * arrowChars.length)];

        // Random position within the board area
        const x = rect.left + Math.random() * rect.width;
        const y = rect.top + Math.random() * rect.height;

        p.style.left = `${x}px`;
        p.style.top = `${y}px`;

        // Random size and delay
        p.style.fontSize = `${24 + Math.random() * 24}px`;
        p.style.animationDelay = `${Math.random() * 0.6}s`;

        document.body.appendChild(p);
        setTimeout(() => p.remove(), 2500);
    }
}

/**
 * Triggers the 921 Earthquake animation.
 */
async function triggerEarthquakeAnimation() {
    const playerBoard = document.getElementById('player-board');
    const oppBoard = document.getElementById('opp-board');
    const boards = [playerBoard, oppBoard].filter(b => b);
    const gameContainer = document.getElementById('game-container');

    // 1. Screen Shake
    gameContainer.classList.add('screen-quake');
    setTimeout(() => gameContainer.classList.remove('screen-quake'), 2000);

    // 2. Board Flash & Fracture
    boards.forEach(boardEl => {
        boardEl.classList.remove('board-red-flash');
        void boardEl.offsetWidth; // Force reflow
        boardEl.classList.add('board-red-flash');
        setTimeout(() => boardEl.classList.remove('board-red-flash'), 1500);

        // Fracture Overlay
        let fracture = boardEl.querySelector('.fracture-overlay');
        if (!fracture) {
            fracture = document.createElement('div');
            fracture.className = 'fracture-overlay';
            boardEl.appendChild(fracture);
        }

        void fracture.offsetWidth;
        fracture.classList.add('active');
        setTimeout(() => fracture.classList.remove('active'), 2500);
    });

    // 3. Dust Particles
    const rect = gameContainer.getBoundingClientRect();
    const particleCount = 30;
    for (let i = 0; i < particleCount; i++) {
        const p = document.createElement('div');
        p.className = 'bg-bounce-particle'; // Reuse particle style
        p.innerText = '•'; // Dust/Debris
        p.style.color = '#555';
        p.style.textShadow = 'none';

        const x = rect.left + Math.random() * rect.width;
        const y = rect.top + Math.random() * rect.height;

        p.style.left = `${x}px`;
        p.style.top = `${y}px`;
        p.style.fontSize = `${10 + Math.random() * 20}px`;
        p.style.animation = `arrow-swirl-rise ${1 + Math.random()}s ease-in forwards`;
        p.style.animationDelay = `${Math.random() * 0.5}s`;

        document.body.appendChild(p);
        setTimeout(() => p.remove(), 2000);
    }
}


