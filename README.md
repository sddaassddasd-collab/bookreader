# 語言學習閱讀器

單頁、純前端的語言學習閱讀器，支援英語、德語、法語。內建五格書架（本機存文 + 捲動進度）、生字本、字典卡、句子解析、TTS、沉浸模式，以及可選的跨裝置同步。

## 快速開始
1. 直接開啟 `index.html`。
2. 需要 AI 功能時，在右側填入 OpenAI 或 Grok API Key（僅存本機 localStorage）。
3. 若要啟用跨裝置同步或 Google Sheet，上線前依下方設定 `API_BASE` / `WEB_APP_URL`。

## 功能概覽
- 五格書架: 每格存文章、標題與捲動進度。
- 閱讀區: 分詞渲染，點字查詢與統計; 雙擊扣 2 並標紅。
- 生字本: 依語言分庫，搜尋、匯入/匯出 CSV/JSON。
- 高頻標示: 前 15 藍框、16-50 綠框; 扣分字停止高頻統計。
- AI 協助: 單字字典卡、文章生成、句子解析與追問。
- TTS: OpenAI `audio/speech` 產生段落語音，支援男女聲與語速。
- 沉浸模式: 全螢幕閱讀。
- 遠端同步: Cloud Run proxy -> GAS Web App。

## 專案結構
- `index.html`: UI。
- `styles.css`: 樣式。
- `src/main.js`: 主要邏輯與事件綁定。
- `src/storage.js`: localStorage 與書格資料。
- `src/reader.js`: 早期文字渲染工具（主流程已移至 `src/main.js`）。
- `gas-proxy/`: Cloud Run Proxy。

## 使用流程（重點）
- 貼上文章 -> 產生可點文字 -> 點字加入生字本，顯示字典卡。
- 生成內容: 依程度/語言/類型產文; 優先使用生字本前 15 個。
- 框選句子 -> 翻譯與文法。
- 生成語音 -> 段落播放鍵 + 朗讀全部。
- 進度自動存書格，也可按「讀取進度」還原。

## 本機儲存（localStorage）
- 書格: `local-text-reader.slots.v1`
- 目前書格: `local-text-reader.activeSlot.v1`
- 捲動進度 map: `local-text-reader.progress.v1`
- 生字本: `word-noter.en.v1` / `word-noter.de.v1` / `word-noter.fr.v1`
- 生字本佇列: `word-noter.queue.{en|de|fr}.v1`
- 字典開關: `word-noter.dict.off`
- 金鑰: `word-noter.openai.key` / `word-noter.grok.key`
- 遠端同步 ID: `local-text-reader.remote.id`

## 遠端同步（Cloud Run Proxy）
- `src/main.js` 的 `API_BASE` 指向你的 Proxy。
- 同步 ID 會對 `GET/POST ${API_BASE}/api/state?id=<ID>` 讀寫 JSON。
- `AUTO_REMOTE_SYNC_ENABLED=false`，只在手動按閱讀區「儲存」時上傳; 「立即同步」只拉取遠端。
- 同步內容: `slots`、`activeSlotId`、當前語言的 `words`。

## gas-proxy（Node / Cloud Run）
- 用途: 隱藏 GAS token，並提供跨網域同步入口。
- 設定:
  - `gas-proxy/server.js` 更新 `GAS_BASE`。
  - 環境變數: `GAS_TOKEN`（必填）、`ALLOW_ORIGIN`（建議 GitHub Pages 網域）、`PORT`（可選）。
- 本機啟動:
  ```bash
  cd gas-proxy
  npm install
  npm start
  ```

## GAS Web App 範本（同步用）
建立 Apps Script Web App 後，將 `TOKEN` 與 `FOLDER_ID` 改成自己的設定。

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

## Google Sheet 背景上傳（單字）
- `src/main.js` 的 `WEB_APP_URL` 指向你的 Apps Script Web App。
- 英語查字成功時會以 `mode: 'no-cors'` 背景上傳; 失敗會進佇列並在 `online` 事件重送。

## 外部 API
- Chat: OpenAI `https://api.openai.com/v1/chat/completions`（預設 `gpt-4o-mini`）/ Grok `https://api.x.ai/v1/chat/completions`（預設 `grok-4`）。
- TTS: OpenAI `https://api.openai.com/v1/audio/speech`（model `gpt-4o-mini-tts`）。

## 開發備註
- 書格數量: `src/storage.js` 的 `MAX_SLOTS`。
- 若要模組化, `src/main.js` 已以功能區塊分段，可拆成多個 ES module。
