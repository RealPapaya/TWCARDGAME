# 寶島保護戰 (Treasure Island Duel) - 開發指南

## 如何新增卡牌

新增卡牌需要修改 `app.js` 中的 `CARD_DATA` 陣列，並將圖片放入 `img/` 資料夾。

### 1. 準備圖片
- 格式：建議使用 `.png` 或 `.jpg`
- 命名：遵循 `twXXX.png` (例如 `tw017.png`)
- 路徑：`d:\Google AI\TWCARDGAME\img\`

### 2. 在 `app.js` 中新增資料
將以下模板複製到 `CARD_DATA` 陣列的最尾端：

#### 隨從卡 (Minion) 模板
```javascript
{ 
    "id": "", 
    "name": "", 
    "category": "COMMON/RARE/EPIC/LEGENDARY", 
    "cost": , 
    "attack": , 
    "health": , 
    "type": "MINION", 
    "rarity": "",
    "keywords": {}, 
    "description": "", 
    "image": "" 
}
```

#### 法術卡 (Spell) 模板
```javascript
{ 
    "id": "twXXX", 
    "name": "", 
    "category": "法術", 
    "cost": , 
    "type": "SPELL", 
    "rarity": "COMMON/RARE/EPIC/LEGENDARY", 
    "keywords": {}
    "description": "", 
    "image": "" 
}
```

### 3. 常見關鍵字與效果類型
- **Keywords**:
    - `taunt`: 嘲諷（敵人必須先攻擊此單位）
    - `charge`: 衝鋒（下場即可攻擊）
    - `battlecry`: 戰吼（下場立即執行的效果）
- **Effect Types (`battlecry.type`)**:
    - `DAMAGE`: 造成傷害
    - `HEAL`: 回復生命
    - `BUFF_ALL`: 強化全場我方單位
    - `DRAW`: 抽牌
    - `DESTROY`: 直接摧毀單位
    - `BOUNCE_ALL_ENEMY`: 將對手全場單位回傳手牌
    - `DAMAGE_NON_CATEGORY`: 對非指定類別的單位造成傷害
    - `BUFF_CATEGORY`: 強化指定類別的單位
