# AI 開發導讀：本地閱讀器

單頁、純前端的語言學習閱讀器。重點是讓後續 AI 生程式碼時先讀懂架構：五格書架（本機存文＋進度）、生字本、字典生成、句子解析、TTS，全在瀏覽器端執行。

**啟動**
- 直接開 `index.html`，無編譯或伺服器需求。
- 僅用原生 ES Modules，無外部套件。
- 主要邏輯集中在 `src/main.js`；`src/storage.js` 處理 localStorage；`styles.css` 為深色主題。

**檔案地圖**
- `index.html`: DOM 骨架（五格書架、左側編輯器、閱讀區、右側生字本、解析卡、TTS 抽屜）。
- `styles.css`: 顏色、按鈕、書格卡、單字高亮（`.hf15/.hf50/.deducted`）、解析卡、TTS 抽屜樣式。
- `src/storage.js`: 書格資料的預設值、形狀校正、`loadSlots` / `updateSlot` / `resetSlot` 及 `loadActiveSlotId`。
- `src/main.js`: 事件綁定與全部功能（書格切換＋進度、文章分詞渲染、點字查詢與生字本、生成內容、句子解析、TTS、Google Sheet 背景上傳）。
- `src/reader.js`: 早期封裝的文字渲染／卷軸工具，現在主要邏輯改在 `main.js`，保留作為輔助。

**頁面/DOM 索引**
- 書格板：`#slotBoard`、`#saveSlot`、`#resetAllSlots`；標題輸入 `#slotTitle`；進度顯示 `#progressLabel/#progressFill`。
- 編輯區：文本輸入 `#src`；產生按鈕 `#compile`；貼範例 `#sample`；清空 `#clearAll`；語音生成 `#buildTTS` + 聲線選擇 `#voicePref`。
- 閱讀區：容器 `#reader`（內含 `.seg[data-i]` 段落，每字 `.word[data-w]`）；底部選取工具列 `#bottomBar` + `#doExplain`；沉浸模式切換 `#openImmersive`，覆蓋層 `#immersiveLayer/#immersiveHost`，退出鍵 `#exitImmersive`。
- 生字本側欄：列表 `#wordList`，搜尋 `#q`，匯入匯出按鈕，`#toggleDict` 開關字典卡；金鑰與模型選擇 `#openaiKey/#grokKey/#providerSelect/#modelSelect/#modelCustom`。
- 卡片與抽屜：字典卡 `#card`（針對單字），句子解析卡 `#analysisCard`，TTS 抽屜 `#ttsDrawer`（全篇播放 `#ttsPlayAll`、停止 `#ttsStop`、語速 `#rateRange`）。

**狀態與持久化**
- 書格：`local-text-reader.slots.v1` 儲存 5 格 `{ id,title,content,createdAt,updatedAt,progress }`；`local-text-reader.activeSlot.v1` 保存目前使用的格。
- 生字本：依語言分 `word-noter.en.v1` / `word-noter.de.v1` / `word-noter.fr.v1`（欄位 `{ word, display, count, pos, phon, defs, note, firstSeen, lastSeen }`）；搜尋用 `#q`，列表按 `lastSeen` 反向排序。
- 其他 key：`word-noter.queue.{en|de|fr}.v1`（Google Sheet 備援佇列）、`word-noter.dict.off`（是否關閉字典卡）、`word-noter.openai.key` / `word-noter.grok.key`（僅存在本機）。
- 執行期狀態：`slots`、`activeSlotId`、`segAudios`（Map: seg idx → {url, voice}）、`ttsGenerated`、`playQueue`、`lastSelectionText` 等。

**核心流程**
- 書格管理：`renderSlotBoard` 產出卡片；`saveActiveSlot` 寫入文字＋標題＋當下卷軸進度；`onReaderScroll` 以 240ms 節流自動更新 `progress`；`resetSlot`/`resetProgressBtn` 清空單格或進度。
- 文章渲染：`compile` 將 `#src` 逐行裁切為 `.seg`，每個單字包 `<span class="word" data-w>`（語言由 `#langSelect` 決定 regex，德/法使用 Unicode 單字匹配）；重建時會移除 TTS 緩存並重新綁定點擊事件與播放按鈕監聽。
- 點字 / 生字本：單擊 `processSingleClick` → 新增/累計生字、若字典開啟則呼叫 `lookupDefinition`（英/德/法分流，透過 `generateEnglishEntry`/`generateGermanEntry`/`generateFrenchEntry`）並更新 `#card`；雙擊 `processDoubleClick` → `adjustWordCount(-2)` 並為該字加 `.deducted`（停用高頻框）。高頻標示：`applyHFClassesToReader` 依 `count` 前 15/50 套 `.hf15/.hf50`。
- 生成內容：`#genContent` 觸發 `generateContentWithOpenAI`（供應商來自 `#providerSelect`，模型 `#modelSelect` 或 `#modelCustom`，詞彙優先取生字本前 15；依 `#langSelect` 在英/德/法之間切換提示）；若缺字則 `reviseContentToInclude` 再修稿。產出寫入 `#src`，自動 `compile`。
- 句子解析：`bindSelectionWatcher` 監看選取範圍僅限 `#reader`；`#doExplain` 呼叫 `explainSelectionWithOpenAI`，依固定模板回傳翻譯、文法、片語與例句，再渲染到 `#analysisCard`；`#extraQBtn` 可針對解析結果追問。
- TTS：`buildTTSForCurrent` 讀取 `.seg` 文字，呼叫 OpenAI `audio/speech` 生成 blob URL，依 `genre` 決定是否男女聲交替；生成後在段落前插入 `.playseg` 按鈕；`ttsPlaySegmentsAll` 依 seg 順序播放並加上 `.playing` 樣式。
- 沉浸模式：`enterImmersive` 將 `.reader-wrap` 搬入 `#immersiveHost` 並嘗試 `requestFullscreen`；按背景、Esc、或 `#exitImmersive` 觸發 `exitImmersive`，把節點放回原位並退出全螢幕。
- Google Sheet 上傳：`WEB_APP_URL`（`main.js` 內常數）若為 https 會在查字成功時 `postToSheet`（英語限定）附帶詞性/音標/備註/裝置資訊，離線時寫入 `word-noter.queue.*`，`flushQueue` 於 `online` 事件與 8s interval 嘗試重送。

**外部服務 / 參數**
- Chat：OpenAI `https://api.openai.com/v1/chat/completions`（預設 `gpt-4o-mini`）與 xAI `https://api.x.ai/v1/chat/completions`（預設 `grok-4`）；訊息溫度依用途 0.3–0.9。
- TTS：OpenAI `https://api.openai.com/v1/audio/speech`，使用 `gpt-4o-mini-tts`，聲線 `verse`（男）/`alloy`（女），支援語速 `#rateRange`。
- Google Sheet：需自行替換 `WEB_APP_URL` 為 Apps Script Web App；使用 `mode:'no-cors'`，失敗時入佇列。

**跨裝置同步（GAS Web App）**
- 在 Google Apps Script 建立專案，貼上以下範本，替換 `TOKEN` 為亂碼、`FOLDER_ID` 為雲端硬碟資料夾 ID，部署為 Web App（建議權限 Anyone）：  
  ```js
  const TOKEN = '換成亂碼';
  const FOLDER_ID = '你的資料夾ID';
  function doGet(e){ const id=safeId(e.parameter.id); if(e.parameter.token!==TOKEN)return forbidden();
    const f=findFile(id); const t=f?f.getBlob().getDataAsString():'{}'; return json(t); }
  function doPost(e){ const id=safeId(e.parameter.id); if(e.parameter.token!==TOKEN)return forbidden();
    const body=e.postData?.contents||'{}'; const f=findFile(id)||createFile(id); f.setContent(body||'{}'); return text('ok'); }
  function folder(){ return DriveApp.getFolderById(FOLDER_ID); }
  function safeId(raw=''){ return String(raw||'').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,64)||'default'; }
  function findFile(id){ const it=folder().getFilesByName(`${id}.json`); return it.hasNext()?it.next():null; }
  function createFile(id){ return folder().createFile(`${id}.json`,'{}','application/json'); }
  function json(str){ return ContentService.createTextOutput(str).setMimeType(ContentService.MimeType.JSON); }
  function text(str){ return ContentService.createTextOutput(str); }
  function forbidden(){ return ContentService.createTextOutput('forbidden').setResponseCode(403); }
  ```
- 前端左上新增「跨裝置同步」區：填入 Web App URL、同步 Token、自訂同步 ID（雲端檔名 `<id>.json`），按「儲存設定」即可寫入 localStorage；按「立即同步」會先拉遠端再寫回。
- 自動推送：儲存書格 (`儲存到書格`)、生字本寫入/匯入/扣分/備註等都會 debounce 後推送遠端。頁面載入時若已有同步 ID＋URL＋Token 會先嘗試拉取；失敗則維持本機資料。
- 同步內容：`slots`、`activeSlotId`、以及當前語言的 `words`（同 `loadWords()`，payload 會附上 `lang` 與 `updatedAt`）。遠端檔案不存在時會自動建立。
- 離線/失敗保護：所有資料仍保留在 localStorage，遠端錯誤只會顯示狀態，不會阻擋本機存取；按「停用遠端」可清除設定回純本機。

**樣式與互動提示**
- 高頻框色：`.hf15` 藍、`.hf50` 綠；雙擊扣分的 `.deducted` 標紅並停止高頻計算；點擊時 `.tapping` 產生縮放。
- 進度條：`progressFill` 寬度依 `getScrollProgress` 計算；重建 `reader` 後記得重設進度或保存。
- 段落播放：`.seg.playing` 會高亮，目前索引保存在 `currentSegIdx`。
- 沉浸模式：遮罩 `#immersiveLayer` 使用漸層＋模糊背景，`body.immersive-on` 停止滾動；全螢幕關閉時（`fullscreenchange` 或 Esc）會自動還原。沉浸模式下仍可看到字典卡、解析卡與底部「翻譯與文法」工具列（z-index 已抬高，且全屏優先鎖定整個 document）。

**修改建議（給未來 AI）**
- 調整書格數量：改 `src/storage.js` 的 `MAX_SLOTS`，並同步 UI 文案。
- 擴充新服務：沿用 `doChat` 或 `fetchTTSUrl` 的封裝，統一從 `#providerSelect/#model*` 或新下拉取得設定。
- 增加生字欄位或排序：修改 `upsertWord` 資料形狀與 `renderWordList` 排序/模板，並同步匯入匯出（`exportJSON`/`exportCSV`、`importJSONText`/`importCSVText`）。
- 若要抽離功能模組，`main.js` 已分區塊（書格/渲染/字典/生成/解析/TTS）；可搬運到多個 ES module 後在 `index.html` 以 `<script type="module">` 匯入。
