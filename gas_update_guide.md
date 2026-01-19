# GAS 後端更新指南 (v1.6 - 頭像與稱號系統)

您的腳本邏輯寫得很棒，`login` 與 `update` 已經是動態處理 Headers 的了！您只需要針對 `register` 進行微調，並在試算台中增加欄位即可。

## 1. Google 試算表欄位更新
請在您的 Google 試算表 `Users` 分頁中，於最後方**新增三個欄位**（請務必使用小寫）：

1.  **vouchers** (儲存消費券)
2.  **ownedavatars** (儲存已擁有頭像)
3.  **ownedtitles** (儲存已擁有稱號)

> [!TIP]
> 欄位順序不影響功能，只要 Header 名稱正確即可。

## 2. 完整更新後的 GAS 程式碼
請將您的 GAS 內容替換為以下版本（已為您整合 `register` 的初始賦值）：

```javascript
/* 寶島遊戲王 後端 v1.6 - 支援頭像稱號與消費券 */
function doGet(e) {
  var action = e.parameter.action;
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data = sheet.getDataRange().getValues();
  var headers = data[0].map(function(h) { return h.toString().toLowerCase().trim(); });
  
  var JSONResponse = function(obj) {
    return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
  };

  if (action === 'register') {
    var username = e.parameter.username;
    var password = e.parameter.password;
    for (var i = 1; i < data.length; i++) {
        if (data[i][0] == username) return JSONResponse({ success: false, message: "帳號已被使用" });
    }
    var newRow = new Array(headers.length).fill("");
    var setVal = function(name, val) {
      var idx = headers.indexOf(name.toLowerCase());
      if (idx !== -1) newRow[idx] = val;
    };
    
    // 初始資料賦值
    setVal("username", username);
    setVal("password", password);
    setVal("level", 1);
    setVal("gold", 100);
    setVal("vouchers", 0);                   // [新增]
    setVal("deck_data", "[]");
    setVal("selectedavatar", "avatar1");
    setVal("selectedtitle", "beginner");     // [修改] 預設為菜鳥 (ID)
    setVal("ownedavatars", '["avatar1"]');   // [新增] 初始擁有頭像 1
    setVal("ownedtitles", '["beginner"]');   // [新增] 初始擁有稱號：菜鳥
    setVal("ownedcards", "{}");
    setVal("stats", "{}");
    setVal("lastsaved", Date.now()); 
    
    sheet.appendRow(newRow);
    SpreadsheetApp.flush();
    return JSONResponse({ success: true, message: "註冊成功" });
  }

  if (action === 'login') {
    var username = e.parameter.username;
    var password = e.parameter.password;
    for (var i = 1; i < data.length; i++) {
        if (data[i][0] == username && data[i][1] == password) {
            var user = {};
            for (var j = 0; j < headers.length; j++) {
                user[headers[j]] = data[i][j];
            }
            return JSONResponse({ success: true, data: user });
        }
    }
    return JSONResponse({ success: false, message: "帳號或密碼錯誤" });
  }
  return JSONResponse({ success: false, message: "無效請求" });
}

function doPost(e) {
  var params = JSON.parse(e.postData.contents);
  var action = params.action;
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data = sheet.getDataRange().getValues();
  var headers = data[0].map(function(h) { return h.toString().toLowerCase().trim(); });

  if (action === 'update') {
    var username = params.username;
    var lastSavedIdx = headers.indexOf("lastsaved");
    
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] == username) {
        if (lastSavedIdx !== -1) {
          var existingT = parseInt(data[i][lastSavedIdx] || 0);
          var incomingT = parseInt(params.lastsaved || 0);
          if (incomingT <= existingT) return ContentService.createTextOutput("Ignored: Stale Data");
        }

        // 動態更新所有傳入的欄位
        for (var key in params) {
          var colIndex = headers.indexOf(key.toLowerCase().trim());
          if (colIndex !== -1) {
            sheet.getRange(i + 1, colIndex + 1).setValue(params[key]);
          }
        }
        SpreadsheetApp.flush(); 
        return ContentService.createTextOutput("Success");
      }
    }
  }
}
```

## 3. 部署步驟
1. 貼上代碼後，點選右上角 **「部署」** -> **「管理部署」**。
2. 點選鉛筆圖示編輯，將版本選擇為 **「新版本」**。
3. 點選 **「部署」** 即可生效。
