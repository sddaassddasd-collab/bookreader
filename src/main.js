import {
  loadSlots,
  updateSlot,
  resetSlot,
  loadActiveSlotId,
  saveActiveSlotId,
  saveSlots,
  loadProgressMap,
  saveProgressMap,
  MAX_SLOTS,
} from './storage.js';

/* ========= ✅ 換成你的 Apps Script Web App URL ========= */
const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbyo3LWQPC-XOdEmslQoIbFrrF4vbZ1egyAKMmUixVgsRP7RQ8ebnRn2WqL6h7cubQwJyQ/exec';

/* ========= 遠端同步（Cloud Run Proxy） ========= */
const API_BASE = 'https://gas-proxy-678824560367.asia-east1.run.app';
const REMOTE_ENDPOINT = `${API_BASE}/api/state`;
const REMOTE_ID_KEY = 'local-text-reader.remote.id';
const LEGACY_REMOTE_EXEC_KEY = 'local-text-reader.remote.exec';
const LEGACY_REMOTE_TOKEN_KEY = 'local-text-reader.remote.token';
const AUTO_REMOTE_SYNC_ENABLED = false; // 僅手動按「儲存」時才上傳
const REMOTE_DEBOUNCE_MS = 1000;

/* ========= 字典開關（存本機 localStorage） ========= */
const DICT_OFF_KEY = 'word-noter.dict.off'; // '1' 表關、'0' 或缺值表開
const STORE_KEYS = { en: 'word-noter.en.v1', de: 'word-noter.de.v1', fr: 'word-noter.fr.v1' };
const QUEUE_KEYS = { en: 'word-noter.queue.en.v1', de: 'word-noter.queue.de.v1', fr: 'word-noter.queue.fr.v1' };
const OPENAI_KEY_STORAGE = 'word-noter.openai.key';
const GROK_KEY_STORAGE = 'word-noter.grok.key';
const VOICE_MALE = 'verse';
const VOICE_FEMALE = 'alloy';

/* ========= DOM ========= */
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const reader = $('#reader');
const readerWrap = document.querySelector('.reader-wrap');
const slotBoard = $('#slotBoard');
const slotTitleInput = $('#slotTitle');
const activeSlotLabel = $('#activeSlotLabel');
const progressLabel = $('#progressLabel');
const progressFill = $('#progressFill');
const statusEl = $('#status');

const card = $('#card');
const defsBox = $('#defs');
const cardMeta = $('#cardMeta');
const cardTitle = $('#cardTitle');
const noteInput = $('#noteInput');
const offlineTip = $('#offlineTip');

const analysisCard = $('#analysisCard');
const anaSrc = $('#anaSrc');
const anaZh = $('#anaZh');
const anaGram = $('#anaGram');
const selPreview = $('#selPreview');
const bottomBar = $('#bottomBar');
const doExplainBtn = $('#doExplain');
const selStatus = $('#selStatus');

const ttsDrawer = $('#ttsDrawer');
const rateRange = $('#rateRange');
const rateLabel = $('#rateLabel');
const immersiveLayer = $('#immersiveLayer');
const immersiveHost = $('#immersiveHost');
const openImmersiveBtn = $('#openImmersive');
const exitImmersiveBtn = $('#exitImmersive');

/* ========= 狀態 ========= */
let slots = loadSlots();
let progressMap = loadProgressMap();
let activeSlotId = clampId(loadActiveSlotId());
let lastSelectionText = '';
let isImmersive = false;
let readerHome = null;

let remoteId = loadRemoteId();
let remotePushTimer = null;
let progressSaveHandle = null;
let progressSaveTimer = null;

// 新增：在還原期間暫時忽略 scroll 事件的寫入
let isRestoringScroll = false;

let currentAudio = null;
let playQueue = [];
let ttsGenerated = false;
const segAudios = new Map(); // idx -> { url, voice }
let currentSegIdx = null;

const WORD_SAVE_DEBOUNCE_MS = 120;
let wordsCache = null;
let wordsCacheKey = null;
let wordsSaveTimer = null;
let wordsSavePayload = null;
let wordUiRenderScheduled = false;

const INITIAL_SEGMENTS = 32;
const MAX_RENDERED_SEGMENTS = 140;
const VIRTUAL_BUFFER = 24;
const VIRTUAL_THRESHOLD = 40;
let compiledSegments = [];
let useVirtualScroll = false;
let virtualDom = { viewport: null, padBefore: null, padAfter: null, start: 0, end: 0, avgHeight: 32 };
const wordNodeMap = new Map(); // key -> Set<HTMLElement>
const deductedWords = new Set();
const segmentHeights = [];
let hfState = { top15: new Set(), top50: new Set() };
let hfRecalcTimer = null;
const HF_RECALC_MS = 650;

function captureLLMAndLangPrefs(){
  return {
    provider: getSelectedProvider(),
    modelSelect: (document.getElementById('modelSelect')?.value || '').trim(),
    modelCustom: (document.getElementById('modelCustom')?.value || '').trim(),
    level: (document.getElementById('levelSelect')?.value || 'B1'),
    lang: getLang(),
    genre: (document.getElementById('genreSelect')?.value || 'fairy_tale'),
    customTopic: getCustomTopic(),
    length: getTargetLen(),
    voicePref: (document.getElementById('voicePref')?.value || 'male')
  };
}

/* ========= 初始化 ========= */
init();

async function init() {
  bindSlotUI();
  bindGeneralUI();
  bindRemoteUI();
  bindStoryUI();
  bindTTSUI();
  bindImmersiveMode();
  bindWordCardQA();
  bindExtraQuestionUI();
  bindSelectionWatcher();
  bindReaderDelegates();

  let syncedFromRemote = false;
  if(hasRemoteConfig()){
    try{
      await pullRemoteState(remoteId);
      setStatus(`已從雲端同步（ID：${remoteId}）`);
      syncedFromRemote = true;
    }catch(err){
      console.error(err);
      setStatus('遠端同步失敗，改用本機資料：' + err.message);
    }
  }

  if(!syncedFromRemote){
    renderSlotBoard();
    setActiveSlot(activeSlotId);
  }
  flushQueue();
  updateDictToggleUI();
  updateUILang();
  updateBottomBar();
}

/* ========= 書格（5 本） ========= */
function bindSlotUI() {
  $('#saveSlot')?.addEventListener('click', saveActiveSlot);
  $('#resetAllSlots')?.addEventListener('click', () => {
    if (!confirm('確定要清空五個書格的內容與進度嗎？此動作無法復原。')) return;
    for (let i = 1; i <= MAX_SLOTS; i += 1) {
      slots = resetSlot(slots, i);
    }
    resetAllProgressInMap();
    setActiveSlot(1);
    renderSlotBoard();
    setStatus('已清空全部書格');
    scheduleRemotePush();
  });
  $('#resetProgressBtn')?.addEventListener('click', () => {
    applyScrollProgress(reader, 0);
    setSlotProgressInMap(activeSlotId, 0);
    slots = updateSlot(slots, activeSlotId, { progress: 0 });
    renderSlotBoard();
    updateProgressUI(0);
    setStatus('已重置進度為 0%');
    scheduleRemotePush();
  });
  reader?.addEventListener('scroll', onReaderScroll, { passive: true });
}

function onReaderScroll() {
  // 如果正在還原，避免把初始 0% 覆蓋回 storage
  if (isRestoringScroll) {
    // 仍更新 progress bar 以免 UI 卡住，但不要寫入 map/storage
    const ratio = getScrollProgress(reader);
    updateProgressUI(ratio);
    return;
  }

  handleVirtualScroll();
  const ratio = getScrollProgress(reader);
  updateProgressUI(ratio);
  setSlotProgressInMap(activeSlotId, ratio);
}

function renderSlotBoard() {
  slotBoard.innerHTML = '';
  slots.forEach((slot) => {
    const cardEl = document.createElement('div');
    cardEl.className = 'slot';
    if (slot.id === activeSlotId) cardEl.classList.add('active');

    const head = document.createElement('div');
    head.className = 'slot-head';
    const name = document.createElement('div');
    name.className = 'slot-name';
    name.textContent = `書格 ${slot.id} · ${slot.title || '未命名'}`;
    const pill = document.createElement('div');
    pill.className = 'pill';
    pill.textContent = slot.id === activeSlotId ? '使用中' : '點擊切換';
    head.append(name, pill);

    const meta = document.createElement('div');
    meta.className = 'slot-meta';
    const updated = slot.updatedAt ? `更新 ${formatTime(slot.updatedAt)}` : '尚未儲存';
    const words = slot.content ? `${countWords(slot.content)} 字` : '無內容';
    meta.textContent = `${updated} · ${words}`;
    const progressVal = (() => {
      const v = getSlotProgressFromMap(slot.id);
      return v !== null ? v : (slot.progress || 0);
    })();

    const prog = document.createElement('div');
    prog.className = 'slot-progress';
    const bar = document.createElement('div');
    bar.className = 'bar';
    const barFill = document.createElement('span');
    barFill.style.width = `${Math.round((progressVal || 0) * 100)}%`;
    bar.append(barFill);
    const progText = document.createElement('div');
    progText.className = 'small';
    progText.textContent = `進度 ${Math.round((progressVal || 0) * 100)}%`;
    prog.append(bar, progText);

    const actions = document.createElement('div');
    actions.className = 'slot-actions';
    const useBtn = document.createElement('button');
    useBtn.className = 'secondary';
    useBtn.textContent = '載入 / 切換';
    useBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      setActiveSlot(slot.id);
    });
    const delBtn = document.createElement('button');
    delBtn.className = 'danger';
    delBtn.textContent = '刪除';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!confirm(`確定刪除書格 ${slot.id} 的內容與進度？`)) return;
      slots = resetSlot(slots, slot.id);
      resetProgressInMap(slot.id);
      if (activeSlotId === slot.id) setActiveSlot(slot.id);
      renderSlotBoard();
      setStatus(`已清空書格 ${slot.id}`);
      scheduleRemotePush();
    });
    actions.append(useBtn, delBtn);

    cardEl.append(head, meta, prog, actions);
    cardEl.addEventListener('click', () => setActiveSlot(slot.id));
    slotBoard.appendChild(cardEl);
  });
}

function setActiveSlot(id) {
  const slot = findSlot(id) || findSlot(1);
  activeSlotId = slot.id;
  saveActiveSlotId(activeSlotId);
  const savedProgress = getSlotProgressFromMap(slot.id);
  const progress = savedProgress !== null ? savedProgress : (slot.progress || 0);
  if(savedProgress === null){
    setSlotProgressInMap(slot.id, progress);
  }

  activeSlotLabel.textContent = `書格 ${slot.id}`;
  slotTitleInput.value = slot.title || `書本 ${slot.id}`;
  $('#src').value = slot.content || '';

// 新增：在 compile 前鎖定，避免 compile 內的 onReaderScroll 覆蓋進度
  isRestoringScroll = true;

compile();

  // Try to restore by anchor (seg index + offset). If none, fallback to ratio.
  const anchor = getAnchorForSlot(slot.id);
  if (anchor) {
    // restoreAnchorForSlot 內會在完成時解除鎖定並更新 progressMap/UI
    restoreAnchorForSlot(slot.id, anchor);
  } else {
    // 沒有 anchor 時立刻還原比例並確保不會被誤覆蓋
    applyScrollProgress(reader, progress);
    // 小延遲後解除鎖定並同步實際進度
    setTimeout(()=>{
      const actual = getScrollProgress(reader);
      updateProgressUI(actual);
      setSlotProgressInMap(slot.id, actual);
      isRestoringScroll = false;
    }, 160);
  }

  updateProgressUI(progress);
  renderSlotBoard();
  setStatus(`已切換到書格 ${slot.id}`);
}

function saveActiveSlot() {
  const content = $('#src').value;
  const title = slotTitleInput.value.trim() || `書本 ${activeSlotId}`;
  const progress = getScrollProgress(reader);

  // capture and persist anchor (seg index + offset) for more robust restore
  saveScrollAnchor(activeSlotId);

  setSlotProgressInMap(activeSlotId, progress);
  slots = updateSlot(slots, activeSlotId, { content, title, progress });
  renderSlotBoard();
  setStatus(`已儲存到書格 ${activeSlotId}`);
  scheduleRemotePush();
}

function findSlot(id) {
  return slots.find((s) => s.id === clampId(id));
}

/* ========= 捲軸錨點（segment anchor） ========= */
const ANCHOR_KEY = 'local-text-reader.anchor.v1';

function loadAnchorMap(){
  try{ return JSON.parse(localStorage.getItem(ANCHOR_KEY)) || {}; }catch{ return {}; }
}
function saveAnchorMap(m){
  try{ localStorage.setItem(ANCHOR_KEY, JSON.stringify(m || {})); }catch{}
}
function getAnchorForSlot(id){
  const map = loadAnchorMap();
  return map[String(clampId(id))] || null;
}
function setAnchorForSlot(id, anchor){
  const map = loadAnchorMap();
  map[String(clampId(id))] = anchor;
  saveAnchorMap(map);
}
function removeAnchorForSlot(id){
  const map = loadAnchorMap();
  delete map[String(clampId(id))];
  saveAnchorMap(map);
}

// Capture first visible .seg and offset within it, then persist.
function saveScrollAnchor(slotId){
  if(!reader) return;
  const segs = Array.from(reader.querySelectorAll('.seg'));
  const top = reader.scrollTop;
  let found = null;
  for(const s of segs){
    const off = s.offsetTop;
    const h = s.offsetHeight || 1;
    if(off + h > top){
      found = { i: Number(s.dataset.i || 0), offset: Math.max(0, top - off) };
      break;
    }
  }
  // fallback: if no segs (empty), clear anchor
  if(!found) {
    removeAnchorForSlot(slotId);
    return;
  }
  setAnchorForSlot(slotId, found);
}

// Try to restore an anchor; retry a few times while content is rendering.
// anchor: { i: number, offset: number }
function restoreAnchorForSlot(slotId, anchor){
  if(!reader || !anchor) return;
  let attempts = 0;
  const maxAttempts = 20;
  const interval = 80;
  const tryOnce = () => {
    attempts++;
    // If using virtual scroll, compute approx top
    if(useVirtualScroll && virtualDom && virtualDom.avgHeight){
      const approxTop = Math.max(0, (anchor.i * virtualDom.avgHeight) + (anchor.offset || 0));
      reader.scrollTo({ top: approxTop, behavior: 'auto' });
      renderAroundIndex(anchor.i);
      return true;
    }
    // non-virtual: find the segment element
    const seg = reader.querySelector(`.seg[data-i="${anchor.i}"]`);
    if(seg){
      const targetTop = seg.offsetTop + (anchor.offset || 0);
      reader.scrollTo({ top: targetTop, behavior: 'auto' });
      return true;
    }
    return false;
  };

  const id = setInterval(()=>{
    const ok = tryOnce();
    if(ok || attempts >= maxAttempts){
      clearInterval(id);
      // after attempting, refresh progress UI to match actual
      requestAnimationFrame(()=>{
        const actual = getScrollProgress(reader);
        updateProgressUI(actual);
        setSlotProgressInMap(clampId(slotId), actual);
        // 解除還原鎖定，允許後續的捲動事件寫入進度
        isRestoringScroll = false;
      });
    }
  }, interval);
}

/* ========= 小工具 ========= */
function setStatus(msg) { statusEl.textContent = msg; }
function nowISO() { return new Date().toISOString(); }
function toLowerAlpha(word){ return (word||'').toLowerCase(); }
function escapeRegExp(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function countWords(str){ const matches = (str || '').trim().match(/\S+/g); return matches ? matches.length : 0; }
function formatTime(iso){ try{ const d=new Date(iso); return d.toLocaleString('zh-TW',{hour12:false}); }catch{ return ''; } }
function clampId(id){ const num = Number.isFinite(id)?id:1; return Math.min(Math.max(Math.floor(num),1),MAX_SLOTS); }
function getLang(){ const el = document.getElementById('langSelect'); return el ? el.value : 'en'; }
function _curStoreKey(){ return STORE_KEYS[getLang()] || STORE_KEYS.en; }
function _curQueueKey(){ return QUEUE_KEYS[getLang()] || QUEUE_KEYS.en; }

function scheduleProgressSave(){
  if(typeof requestIdleCallback === 'function'){
    if(progressSaveHandle && typeof cancelIdleCallback === 'function'){
      cancelIdleCallback(progressSaveHandle);
    }
    progressSaveHandle = requestIdleCallback(()=>{
      progressSaveHandle = null;
      saveProgressMap(progressMap);
    }, { timeout: 1200 });
  }else{
    clearTimeout(progressSaveTimer);
    progressSaveTimer = setTimeout(()=>{
      progressSaveTimer = null;
      saveProgressMap(progressMap);
    }, 1000);
  }
}
function getSlotProgressFromMap(id){
  const key = clampId(id);
  const v = progressMap ? progressMap[key] : undefined;
  return Number.isFinite(v) ? Math.min(Math.max(v,0),1) : null;
}
function setSlotProgressInMap(id, ratio){
  const key = clampId(id);
  const next = Math.min(Math.max(Number(ratio) || 0, 0), 1);
  if(progressMap && progressMap[key] === next) return;
  progressMap = { ...(progressMap || {}), [key]: next };
  scheduleProgressSave();
}
function resetProgressInMap(id){
  const key = clampId(id);
  if(!progressMap || progressMap[key] === 0) return;
  progressMap = { ...(progressMap || {}), [key]: 0 };
  scheduleProgressSave();
}
function resetAllProgressInMap(){
  progressMap = {};
  scheduleProgressSave();
}

function clearWordNodeMap(){
  wordNodeMap.clear();
}
function applyHFClassToNode(node, key){
  if(!node) return;
  node.classList.remove('hf15','hf50');
  if(node.classList.contains('deducted')) return;
  if(hfState.top15.has(key)) node.classList.add('hf15');
  else if(hfState.top50.has(key)) node.classList.add('hf50');
}
function registerWordNode(node){
  if(!node || !node.dataset) return;
  const key = toLowerAlpha(node.dataset.w);
  if(!key) return;
  let bucket = wordNodeMap.get(key);
  if(!bucket){ bucket = new Set(); wordNodeMap.set(key, bucket); }
  bucket.add(node);
  if(deductedWords.has(key)) node.classList.add('deducted');
  applyHFClassToNode(node, key);
}
function unregisterWordNode(node){
  if(!node || !node.dataset) return;
  const key = toLowerAlpha(node.dataset.w);
  const bucket = wordNodeMap.get(key);
  if(!bucket) return;
  bucket.delete(node);
  if(bucket.size === 0) wordNodeMap.delete(key);
}
function registerSegmentWords(segEl){
  segEl?.querySelectorAll('.word').forEach(registerWordNode);
}
function unregisterSegmentWords(segEl){
  segEl?.querySelectorAll('.word').forEach(unregisterWordNode);
}
function setsEqual(a, b){
  if(a.size !== b.size) return false;
  for(const v of a){ if(!b.has(v)) return false; }
  return true;
}
function updateHFClassesForWord(word){
  const nodes = wordNodeMap.get(word);
  if(!nodes) return;
  nodes.forEach(node => applyHFClassToNode(node, word));
}
function recomputeHFClasses(force=false){
  const nextTop15 = new Set(getTopNWordKeys(15));
  const nextTop50 = new Set(getTopNWordKeys(50));
  const changed = new Set();
  if(force || !setsEqual(hfState.top15, nextTop15) || !setsEqual(hfState.top50, nextTop50)){
    nextTop15.forEach(w => { if(!hfState.top15.has(w)) changed.add(w); });
    hfState.top15.forEach(w => { if(!nextTop15.has(w)) changed.add(w); });
    nextTop50.forEach(w => { if(!hfState.top50.has(w)) changed.add(w); });
    hfState.top50.forEach(w => { if(!nextTop50.has(w)) changed.add(w); });
  }
  hfState = { top15: nextTop15, top50: nextTop50 };
  changed.forEach(updateHFClassesForWord);
}
function scheduleHFRecalc(force=false){
  if(force){ recomputeHFClasses(true); return; }
  clearTimeout(hfRecalcTimer);
  hfRecalcTimer = setTimeout(()=>{
    hfRecalcTimer = null;
    recomputeHFClasses(false);
  }, HF_RECALC_MS);
}

function loadRemoteId(){ try{ return (localStorage.getItem(REMOTE_ID_KEY) || '').trim(); }catch{ return ''; } }
function saveRemoteId(id){
  remoteId = (id || '').trim();
  try{ localStorage.setItem(REMOTE_ID_KEY, remoteId); }catch{}
  return remoteId;
}
function hasRemoteConfig(){ return Boolean((remoteId || '').trim()); }
function buildRemoteUrl(id){
  const target = (id || remoteId || '').trim();
  const url = new URL(REMOTE_ENDPOINT);
  url.searchParams.set('id', target);
  return url.toString();
}
async function pullRemoteState(id = remoteId){
  const targetId = (id || remoteId || '').trim();
  if(!targetId) throw new Error('請填同步 ID（不用填同步網址或 Token）');

  const resp = await fetch(buildRemoteUrl(targetId), { method:'GET' });
  if(!resp.ok){
    const txt = await resp.text().catch(()=>resp.status);
    throw new Error(txt || `HTTP ${resp.status}`);
  }
  let data = {};
  try{ data = await resp.json(); }catch{ data = {}; }
  if(!data || typeof data !== 'object') data = {};
  const hasPayload = Array.isArray(data.slots) || typeof data.activeSlotId !== 'undefined' || Array.isArray(data.words);
  if(!hasPayload){
    renderSlotBoard();
    setActiveSlot(activeSlotId);
    renderWordList();
    applyHFClassesToReader({ force:true });
    return {};
  }

  if(typeof data.lang === 'string'){
    const langEl = document.getElementById('langSelect');
    if(langEl) langEl.value = data.lang;
  }
  if(typeof data.level === 'string'){
    const levelEl = document.getElementById('levelSelect');
    if(levelEl) levelEl.value = data.level;
  }
  if(typeof data.genre === 'string'){
    const genreEl = document.getElementById('genreSelect');
    if(genreEl) genreEl.value = data.genre;
  }
  if(typeof data.length !== 'undefined' && data.length !== null){
    const lenEl = document.getElementById('lengthInput');
    if(lenEl) lenEl.value = data.length;
  }
  if(data.llm && typeof data.llm === 'object'){
    applyRemoteLLMConfig(data.llm);
  }
  if(Array.isArray(data.slots)){
    saveSlots(data.slots);
    slots = loadSlots();
    const nextProgress = {};
    slots.forEach(s=>{
      const key = clampId(s.id);
      nextProgress[key] = Math.min(Math.max(Number(s.progress) || 0, 0), 1);
    });
    progressMap = nextProgress;
    saveProgressMap(progressMap);
  }
  if(typeof data.activeSlotId !== 'undefined'){
    activeSlotId = clampId(data.activeSlotId);
    saveActiveSlotId(activeSlotId);
  }
  if(Array.isArray(data.words)){
    saveWords(data.words, { skipRemote: true });
  }

  updateUILang();
  renderSlotBoard();
  setActiveSlot(activeSlotId);
  renderWordList();
  applyHFClassesToReader({ force:true });
  return data;
}
async function pushRemoteState(id = remoteId){
  const targetId = (id || remoteId || '').trim();
  if(!targetId) throw new Error('請填同步 ID（不用填同步網址或 Token）');

  const llmPref = captureLLMAndLangPrefs();
  const payload = {
    slots,
    activeSlotId,
    words: loadWords(),
    lang: llmPref.lang,
    level: llmPref.level,
    genre: llmPref.genre,
    length: llmPref.length,
    llm: llmPref,
    updatedAt: nowISO()
  };
  const resp = await fetch(buildRemoteUrl(targetId), {
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body: JSON.stringify(payload)
  });
  if(!resp.ok){
    const txt = await resp.text().catch(()=>resp.status);
    throw new Error(txt || `HTTP ${resp.status}`);
  }
  return true;
}
function scheduleRemotePush(){
  if(!AUTO_REMOTE_SYNC_ENABLED) return;
  if(!hasRemoteConfig()) return;
  clearTimeout(remotePushTimer);
  remotePushTimer = setTimeout(async ()=>{
    if(!hasRemoteConfig()) return;
    try{
      await pushRemoteState(remoteId);
      setStatus(`已同步到雲端（ID：${remoteId}）`);
    }catch(err){
      console.error(err);
      setStatus('遠端同步失敗（本機仍已儲存）：' + err.message);
    }
  }, REMOTE_DEBOUNCE_MS);
}
function clearRemoteConfig(){
  remoteId = '';
  try{
    localStorage.removeItem(REMOTE_ID_KEY);
    localStorage.removeItem(LEGACY_REMOTE_EXEC_KEY);
    localStorage.removeItem(LEGACY_REMOTE_TOKEN_KEY);
  }catch{}
  clearTimeout(remotePushTimer);
}

function applyRemoteLLMConfig(pref = {}){
  const providerSelect = document.getElementById('providerSelect');
  if(providerSelect && pref.provider) providerSelect.value = pref.provider;
  const modelSelect = document.getElementById('modelSelect');
  if(modelSelect && pref.modelSelect) modelSelect.value = pref.modelSelect;
  const modelCustom = document.getElementById('modelCustom');
  if(modelCustom && typeof pref.modelCustom === 'string') modelCustom.value = pref.modelCustom;
  const levelSelect = document.getElementById('levelSelect');
  if(levelSelect && pref.level) levelSelect.value = pref.level;
  const genreSelect = document.getElementById('genreSelect');
  if(genreSelect && pref.genre) genreSelect.value = pref.genre;
  const customTopic = document.getElementById('customTopic');
  if(customTopic && typeof pref.customTopic === 'string') customTopic.value = pref.customTopic;
  const lengthInput = document.getElementById('lengthInput');
  if(lengthInput && pref.length) lengthInput.value = pref.length;
  const voicePref = document.getElementById('voicePref');
  if(voicePref && pref.voicePref) voicePref.value = pref.voicePref;
  const langSelect = document.getElementById('langSelect');
  if(langSelect && pref.lang) langSelect.value = pref.lang;
}

/* ========= 遠端同步 UI ========= */
function bindRemoteUI(){
  const idInput = document.getElementById('remoteIdInput');
  const saveBtn = document.getElementById('saveRemote');
  const syncBtn = document.getElementById('syncNow');
  const clearBtn = document.getElementById('clearRemote');
  const pushBtn = document.getElementById('pushRemote');

  if(idInput) idInput.value = remoteId;

  const persistInputs = ()=>{
    if(idInput) saveRemoteId(idInput.value);
  };

  saveBtn?.addEventListener('click', ()=>{
    persistInputs();
    setStatus(hasRemoteConfig()
      ? `已儲存同步設定（ID：${remoteId}，上傳請用閱讀區「儲存」）`
      : '已停用遠端同步（僅用本機）');
  });

  syncBtn?.addEventListener('click', async ()=>{
    persistInputs();
    if(!hasRemoteConfig()){
      alert('請填同步 ID（新版不用填同步網址或 Token）');
      return;
    }
    try{
      await pullRemoteState(remoteId);
      setStatus(`已從雲端讀取最新狀態（ID：${remoteId}）`);
    }catch(err){
      console.error(err);
      setStatus('讀取雲端失敗：' + err.message);
      alert('讀取失敗：' + err.message);
    }
  });

  pushBtn?.addEventListener('click', async ()=>{
    persistInputs();
    if(!hasRemoteConfig()){
      alert('請填同步 ID（新版不用填同步網址或 Token）');
      return;
    }
    try{
      saveActiveSlot();
      await pushRemoteState(remoteId);
      setStatus(`已儲存當下進度並上傳（ID：${remoteId}）`);
    }catch(err){
      console.error(err);
      setStatus('上傳失敗：' + err.message);
      alert('上傳失敗：' + err.message);
    }
  });

  clearBtn?.addEventListener('click', ()=>{
    clearRemoteConfig();
    if(idInput) idInput.value = '';
    setStatus('已停用遠端同步，僅使用本機儲存');
  });
}

function isDictOff(){ try{ return localStorage.getItem(DICT_OFF_KEY) === '1'; }catch{ return false; } }
function setDictOff(v){ try{ localStorage.setItem(DICT_OFF_KEY, v ? '1' : '0'); }catch{} }
function updateDictToggleUI(){
  const btn = document.getElementById('toggleDict');
  if(!btn) return;
  if(isDictOff()){
    btn.textContent = '字典：關';
    btn.title = '點一下開啟字典卡';
  }else{
    btn.textContent = '字典：開';
    btn.title = '點一下關閉字典卡';
  }
}

function getSelectedGenre(){const el = document.getElementById('genreSelect');return el ? el.value : '';}
function getCustomTopic(){
  const el = document.getElementById('customTopic');
  return el ? (el.value || '').trim() : '';
}
function getTargetLen(){
  const el = document.getElementById('lengthInput');
  const v = parseInt(el?.value || '500', 10);
  if (!isFinite(v)) return 500;
  return Math.max(100, Math.min(1200, v));
}
function getLangLabel(){
  const title = document.querySelector('header .wrap strong');
  const lang = getLang();
  if(lang === 'de'){
    title && (title.textContent = '本地德文點字查詢＋生字本');
  }else if(lang === 'fr'){
    title && (title.textContent = '本地法文點字查詢＋生字本');
  }else{
    title && (title.textContent = '本地英文點字查詢＋生字本');
  }
}
function updateUILang(){
  const lang = getLang();
  const lab = document.querySelector('label[for="src"]');
  const ta  = document.getElementById('src');
  const topic = document.getElementById('customTopic');

  if(lang === 'de'){
    lab && (lab.textContent = '在下方貼上德文文章：');
    ta && (ta.placeholder = 'Füge deinen deutschen Text hier ein…');
    topic && (topic.placeholder = 'Gib dein Wunschthema/Genre ein (z. B. eine überzeugende Abhandlung über erneuerbare Energien)…');
  }else if(lang === 'fr'){
    lab && (lab.textContent = '在下方貼上法文文章：');
    ta && (ta.placeholder = 'Collez votre texte français ici…');
    topic && (topic.placeholder = 'Saisissez le sujet/le ton souhaité (par ex. un article persuasif sur les énergies renouvelables)…');
  }else{
    lab && (lab.textContent = '在下方貼上英文文章：');
    ta && (ta.placeholder = 'Paste your English article here...');
    topic && (topic.placeholder = '輸入想要生成的主題／風格（例如：關於可再生能源的說服文）');
  }
  getLangLabel();
  renderWordList();
  applyHFClassesToReader({ force:true });
}

function getSelectedProvider(){
  const el = document.getElementById('providerSelect');
  return el ? el.value : 'openai';
}
function getSelectedModel(){
  const sel = document.getElementById('modelSelect');
  const custom = document.getElementById('modelCustom');
  const fromSelect = sel ? (sel.value || '').trim() : '';
  const fromCustom = custom ? (custom.value || '').trim() : '';
  return fromCustom || fromSelect;
}
function loadOpenAIKey(){ try { return localStorage.getItem(OPENAI_KEY_STORAGE) || ''; } catch { return ''; } }
function saveOpenAIKey(k){ localStorage.setItem(OPENAI_KEY_STORAGE, (k||'').trim()); }
function loadGrokKey(){ try { return localStorage.getItem(GROK_KEY_STORAGE) || ''; } catch { return ''; } }
function saveGrokKey(k){ localStorage.setItem(GROK_KEY_STORAGE, (k||'').trim()); }
function getApiKey(){ return ($('#openaiKey').value.trim() || loadOpenAIKey()); }

/* ========= 進度 ========= */
function getScrollProgress(el){
  if(!el) return 0;
  const max = el.scrollHeight - el.clientHeight;
  if (max <= 0) return 0;
  return el.scrollTop / max;
}
function applyScrollProgress(el, ratio){
  if(!el) return;
  const clamped = Math.min(Math.max(Number(ratio) || 0, 0), 1);
  const max = el.scrollHeight - el.clientHeight;
  if (max <= 0) return;
  requestAnimationFrame(()=>{ el.scrollTop = max * clamped; });
}
function restoreReaderProgress(ratio){
  if(!reader) return;
  const target = Math.min(Math.max(Number(ratio) || 0, 0), 1);
  requestAnimationFrame(()=>{
    if(useVirtualScroll) refreshAvgHeight();
    applyScrollProgress(reader, target);
    requestAnimationFrame(()=>{
      handleVirtualScroll();
      const actual = getScrollProgress(reader);
      updateProgressUI(actual);
      setSlotProgressInMap(activeSlotId, actual);
    });
  });
}
function captureProgressRestorer(){
  const current = getScrollProgress(reader);
  return ()=> restoreReaderProgress(current);
}
function updateProgressUI(ratio) {
  const value = Math.min(Math.max(Number(ratio) || 0, 0), 1);
  progressLabel.textContent = `進度 ${Math.round(value * 100)}%`;
  if (progressFill) progressFill.style.width = `${value * 100}%`;
}

/* ========= 沉浸模式 ========= */
function bindImmersiveMode(){
  if(!readerWrap || !immersiveLayer || !immersiveHost || !openImmersiveBtn || !exitImmersiveBtn) return;
  readerHome = { parent: readerWrap.parentNode, next: readerWrap.nextSibling };
  openImmersiveBtn.addEventListener('click', ()=>{ isImmersive ? exitImmersive() : enterImmersive(); });
  exitImmersiveBtn.addEventListener('click', exitImmersive);
  immersiveLayer.addEventListener('click', (e)=>{ if(e.target === immersiveLayer) exitImmersive(); });
  document.addEventListener('keydown', (e)=>{ if(e.key === 'Escape' && isImmersive) exitImmersive(); });
  document.addEventListener('fullscreenchange', ()=>{
    if(!document.fullscreenElement && isImmersive){ exitImmersive(); }
  });
}
async function requestImmersiveFullscreen(target){
  // Prefer全頁全屏，讓浮層（字典、解析條）仍可顯示於沉浸模式
  const preferred = document.documentElement || document.body || target;
  const fallback = target;
  if(preferred && typeof preferred.requestFullscreen === 'function'){
    try{ await preferred.requestFullscreen(); return; }catch{}
  }
  if(fallback && typeof fallback.requestFullscreen === 'function'){
    try{ await fallback.requestFullscreen(); }catch{}
  }
}
function exitFullscreenIfAny(){
  if(document.fullscreenElement){ document.exitFullscreen().catch(()=>{}); }
}
function enterImmersive(){
  if(isImmersive || !readerHome) return;
  const restoreProgress = captureProgressRestorer();
  immersiveHost.appendChild(readerWrap);
  immersiveLayer.classList.add('show');
  immersiveLayer.setAttribute('aria-hidden','false');
  document.body.classList.add('immersive-on');
  openImmersiveBtn.textContent = '退出沉浸';
  isImmersive = true;
  setStatus('已開啟沉浸模式');
  requestImmersiveFullscreen(immersiveLayer);
  restoreProgress();
}
function exitImmersive(){
  if(!isImmersive || !readerHome) return;
  const restoreProgress = captureProgressRestorer();
  const { parent, next } = readerHome;
  if(parent){
    if(next && next.parentNode === parent) parent.insertBefore(readerWrap, next);
    else parent.appendChild(readerWrap);
  }
  immersiveLayer.classList.remove('show');
  immersiveLayer.setAttribute('aria-hidden','true');
  document.body.classList.remove('immersive-on');
  openImmersiveBtn.textContent = '沉浸模式';
  isImmersive = false;
  setStatus('已退出沉浸模式');
  exitFullscreenIfAny();
  restoreProgress();
}

/* ========= TTS ========= */
function resetAllSegHighlights(){
  const scope = virtualDom.viewport || reader;
  if(scope) scope.querySelectorAll('.seg.playing').forEach(el=> el.classList.remove('playing'));
  currentSegIdx = null;
}
function highlightSegmentByIndex(idx){
  resetAllSegHighlights();
  const seg = ensureSegmentInDom(idx);
  if (seg){
    seg.classList.add('playing');
    currentSegIdx = idx;
  }
}
function resetAllPlayButtons(){
  (reader?.querySelectorAll('.playseg') || []).forEach(btn=>{
    btn.classList.remove('playing');
    btn.textContent = '▶';
    btn.title = (btn.title || '').replace('（播放中）','').trim();
  });
}
function setButtonPlaying(btn, isPlaying){
  if(isPlaying){
    btn.classList.add('playing');
    btn.textContent = '■';
    if(!/播放中/.test(btn.title)) btn.title = (btn.title || '') + '（播放中）';
  }else{
    btn.classList.remove('playing');
    btn.textContent = '▶';
    btn.title = (btn.title || '').replace('（播放中）','').trim();
  }
}
function sanitizeSegmentForTTS(text, genre){
  let t = text || '';
  if (genre === 'dialogue') {
    t = t.replace(/^\s*(?:[A-Z]|[A-Za-z]{1,20})\s*[:：]\s*/, '');
  }
  return t.trim();
}
async function fetchTTSUrl({ text, voice }){
  const apiKey = getApiKey();
  if(!apiKey) throw new Error('請先填入 OpenAI API Key');
  const resp = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice: voice || VOICE_MALE, input: text })
  });
  if(!resp.ok){ throw new Error('TTS 失敗：' + (await resp.text().catch(()=>resp.status))); }
  const arrayBuf = await resp.arrayBuffer();
  const blob = new Blob([arrayBuf], { type: 'audio/mpeg' });
  return URL.createObjectURL(blob);
}
async function buildTTSForCurrent() {
  const sourceSegments = compiledSegments.length
    ? compiledSegments
    : Array.from(document.querySelectorAll('.reader .seg')).map(el => ({
        i: parseInt(el.dataset.i || '0', 10) || 0,
        text: el.textContent || ''
      }));
  if (!sourceSegments.length) {
    alert('沒有可朗讀的文字');
    return;
  }
  for (const [, v] of segAudios) { try { if (v.url) URL.revokeObjectURL(v.url); } catch {} }
  segAudios.clear();

  const genre = getSelectedGenre();
  const shouldAlternate = (genre === 'dialogue');
  const pref = ($('#voicePref').value || 'male');
  const startMale = (pref !== 'female');
  const uniformVoice = startMale ? VOICE_MALE : VOICE_FEMALE;
  let spokenIndex = 0;
  const getVoiceByTurn = (turn) => {
    const maleThis = startMale ? (turn % 2 === 0) : (turn % 2 === 1);
    return maleThis ? VOICE_MALE : VOICE_FEMALE;
  };

  for (const segEl of sourceSegments) {
    const raw = (segEl.text || '').trim();
    const cleaned = sanitizeSegmentForTTS(raw, genre);
    if (!cleaned) continue;
    const i = segEl.i ?? parseInt(segEl.dataset?.i || '0', 10);
    const voice = shouldAlternate ? getVoiceByTurn(spokenIndex) : uniformVoice;
    try {
      const url = await fetchTTSUrl({ text: cleaned, voice });
      segAudios.set(i, { url, voice });
      if (shouldAlternate) spokenIndex++;
    } catch (err) {
      console.error('TTS 失敗 at line', i, err);
    }
  }
  ttsGenerated = true;
  resetAllSegHighlights();
  syncPlayButtonsForRenderedSegments();
  ttsDrawer.classList.add('show');
  alert(shouldAlternate
    ? '語音已生成（對話：男女交替）。'
    : '語音已生成（整篇單一聲線）。');
}
function segPlayHandler(e){
  const btn = e.target.closest('.playseg');
  if(!btn) return;
  if(!ttsGenerated){ alert('請先按「生成語音」'); return; }

  const idx = parseInt(btn.dataset.i, 10);
  const item = segAudios.get(idx);
  if(!item) return;

  if(btn.classList.contains('playing')){
    playQueue = [];
    if(currentAudio){ try{ currentAudio.pause(); }catch{} currentAudio = null; }
    setButtonPlaying(btn, false);
    resetAllSegHighlights();
    return;
  }

  resetAllPlayButtons();
  resetAllSegHighlights();
  playQueue = [];
  if(currentAudio){ try{ currentAudio.pause(); }catch{} currentAudio = null; }

  const rate = parseFloat(rateRange.value) || 1;
  const au = new Audio(item.url);
  au.playbackRate = rate;
  currentAudio = au;

  setButtonPlaying(btn, true);
  highlightSegmentByIndex(idx);

  au.onended = ()=>{
    setButtonPlaying(btn, false);
    resetAllSegHighlights();
    currentAudio = null;
  };

  au.play().catch(err=>{
    console.error(err);
    setButtonPlaying(btn, false);
    resetAllSegHighlights();
    currentAudio = null;
  });
}
async function ttsPlaySegmentsAll() {
  if (!ttsGenerated) { alert('請先按「生成語音」'); return; }
  if (currentAudio) { try { currentAudio.pause(); } catch {} currentAudio = null; }
  playQueue = [];

  const rate = parseFloat($('#rateRange').value) || 1;
  const orderedIdx = Array.from(segAudios.keys()).sort((a,b)=> a - b);
  for (const i of orderedIdx) {
    const item = segAudios.get(i);
    if (item) playQueue.push({ idx: i, url: item.url, voice: item.voice });
  }

  const playNext = function() {
    if (playQueue.length === 0) { currentAudio = null; resetAllSegHighlights(); return; }
    const it = playQueue.shift();
    resetAllSegHighlights();
    highlightSegmentByIndex(it.idx);
    const au = new Audio(it.url);
    au.playbackRate = rate;
    currentAudio = au;
    au.onended = playNext;
    au.play().catch(err => {
      console.error(err);
      playNext();
    });
  };
  playNext();
}

function bindTTSUI(){
  rateRange?.addEventListener('input', ()=>{
    rateLabel.textContent = `${parseFloat(rateRange.value).toFixed(2)}×`;
    if(currentAudio){ currentAudio.playbackRate = parseFloat(rateRange.value); }
  });
  $('#ttsPlayAll')?.addEventListener('click', ttsPlaySegmentsAll);
  $('#ttsStop')?.addEventListener('click', ()=>{
    playQueue = [];
    if(currentAudio){ currentAudio.pause(); currentAudio=null; }
    resetAllSegHighlights();
  });
  $('#buildTTS')?.addEventListener('click', async ()=>{
    const key = getApiKey();
    if(!key){ alert('請先填入 OpenAI API Key'); return; }
    const btn = $('#buildTTS');
    try{
      btn.disabled = true; btn.textContent = '生成語音中…';
      await buildTTSForCurrent();
    }catch(err){
      alert('生成語音失敗：' + err.message);
    }finally{
      btn.disabled = false; btn.textContent = '生成語音';
    }
  });
}

/* ========= 本機資料（生字本） ========= */
function persistWordsToStorage(key, list){
  try{ localStorage.setItem(key, JSON.stringify(list)); }catch{}
}
function loadWords(){
  const key = _curStoreKey();
  if(wordsCache && wordsCacheKey === key) return wordsCache;
  wordsCacheKey = key;
  try{
    wordsCache = JSON.parse(localStorage.getItem(key)) || [];
  }catch{
    wordsCache = [];
  }
  return wordsCache;
}
function saveWords(list, opts = {}){
  const key = _curStoreKey();
  wordsCacheKey = key;
  wordsCache = list;
  wordsSavePayload = { key, list };
  if(wordsSaveTimer) clearTimeout(wordsSaveTimer);
  wordsSaveTimer = setTimeout(()=>{
    wordsSaveTimer = null;
    if(!wordsSavePayload) return;
    persistWordsToStorage(wordsSavePayload.key, wordsSavePayload.list);
    wordsSavePayload = null;
  }, WORD_SAVE_DEBOUNCE_MS);
  if(!opts.skipRemote) scheduleRemotePush();
}
function loadQueue(){ try{ return JSON.parse(localStorage.getItem(_curQueueKey())) || [] } catch { return [] } }
function saveQueue(q){ localStorage.setItem(_curQueueKey(), JSON.stringify(q)); }
function postToSheet(payload){
  if (!WEB_APP_URL || !/^https:\/\//.test(WEB_APP_URL)) return;
  const body = JSON.stringify(payload);
  fetch(WEB_APP_URL, { method:'POST', mode:'no-cors', headers:{ 'Content-Type':'application/json' }, body })
    .catch(()=>{
      const q = loadQueue(); q.push({ body, ts: Date.now() }); saveQueue(q);
    });
}
async function flushQueue(){
  const q = loadQueue(); if(!q.length) return;
  const remain = [];
  for (const item of q){
    try{
      await fetch(WEB_APP_URL, { method:'POST', mode:'no-cors', headers:{ 'Content-Type':'application/json' }, body:item.body });
    }catch{ remain.push(item); }
  }
  saveQueue(remain);
}
window.addEventListener('online', flushQueue);
setInterval(flushQueue, 8000);
function scheduleWordUiRefresh(){
  if(wordUiRenderScheduled) return;
  wordUiRenderScheduled = true;
  const runner = ()=>{
    wordUiRenderScheduled = false;
    renderWordList();
    scheduleHFRecalc();
  };
  if(typeof requestIdleCallback === 'function'){
    requestIdleCallback(runner, { timeout: 120 });
  }else{
    requestAnimationFrame(runner);
  }
}
function upsertWord(word, payload = {}, inc = true){
  const base = loadWords();
  const key = toLowerAlpha(word);
  const idx = base.findIndex(x => x.word === key);
  if (idx >= 0){
    base[idx] = {
      ...base[idx],
      count: inc ? (base[idx].count || 0) + 1 : (base[idx].count || 0),
      lastSeen: nowISO(),
      pos: payload.pos ?? base[idx].pos,
      phon: payload.phon ?? base[idx].phon,
      defs: payload.defs ?? base[idx].defs,
      note: payload.note ?? base[idx].note,
      display: payload.display ?? base[idx].display
    };
  } else {
    base.push({
      word: key, display: payload.display || word,
      count: inc ? 1 : 0, firstSeen: nowISO(), lastSeen: nowISO(),
      pos: payload.pos || '', phon: payload.phon || '',
      defs: payload.defs || [], note: payload.note || ''
    });
  }
  saveWords(base);
  scheduleWordUiRefresh();
}
function adjustWordCount(word, delta){
  const base = loadWords();
  const key = toLowerAlpha(word);
  const idx = base.findIndex(x => x.word === key);
  if(idx < 0) return;
  base[idx].count = Math.max(0, (base[idx].count||0) + delta);
  base[idx].lastSeen = nowISO();
  saveWords(base);
  scheduleWordUiRefresh();
}
function updateWordNote(word, note){
  const base = loadWords();
  const key = toLowerAlpha(word);
  const idx = base.findIndex(x => x.word === key);
  if(idx >= 0){
    base[idx].note = note;
    base[idx].lastSeen = nowISO();
    saveWords(base);
    scheduleWordUiRefresh();
  }
}
function getWord(word){
  const base = loadWords();
  return base.find(x => x.word === toLowerAlpha(word));
}

/* ========= 高頻標示 ========= */
function getTopNWordKeys(n){
  return (loadWords()||[])
    .slice()
    .sort((a,b)=>{
      const c = (b.count||0)-(a.count||0);
      return c!==0 ? c : (b.lastSeen||'').localeCompare(a.lastSeen||'');
    })
    .slice(0,n)
    .map(x=>x.word);
}
function applyHFClassesToReader(opts = {}){
  const { force=false } = opts;
  recomputeHFClasses(force);
}

/* ========= 閱讀區虛擬化 ========= */
function ensureReaderShell(){
  if(!reader) return;
  clearWordNodeMap();
  reader.innerHTML = '';
  const padBefore = document.createElement('div');
  padBefore.className = 'virtual-pad before';
  const viewport = document.createElement('div');
  viewport.className = 'virtual-viewport';
  const padAfter = document.createElement('div');
  padAfter.className = 'virtual-pad after';
  reader.append(padBefore, viewport, padAfter);
  virtualDom = { viewport, padBefore, padAfter, start: 0, end: 0, avgHeight: virtualDom.avgHeight || 32 };
}
function teardownReader(){
  if(reader) reader.innerHTML = '';
  clearWordNodeMap();
  compiledSegments = [];
  useVirtualScroll = false;
  virtualDom = { viewport: null, padBefore: null, padAfter: null, start: 0, end: 0, avgHeight: virtualDom.avgHeight || 32 };
}
function applyAudioButtonIfAny(segEl, idx){
  if(!segEl) return;
  const item = segAudios.get(idx);
  if(!item) return;
  if(segEl.querySelector('.playseg')) return;
  const btn = document.createElement('button');
  btn.className = 'playseg';
  btn.textContent = '▶';
  btn.title = `播放這段（${item.voice === VOICE_FEMALE ? '女' : '男'}聲）`;
  btn.dataset.i = String(idx);
  segEl.prepend(btn);
}
function buildSegmentElement(seg){
  const segEl = document.createElement('div');
  segEl.className = 'seg';
  segEl.dataset.i = seg.i;
  segEl.innerHTML = seg.html;
  segEl.style.contentVisibility = 'auto';
  segEl.style.containIntrinsicSize = '1em 120px';
  registerSegmentWords(segEl);
  applyAudioButtonIfAny(segEl, seg.i);
  return segEl;
}
function updateVirtualPadding(start, end){
  if(!virtualDom.padBefore || !virtualDom.padAfter) return;
  const beforeH = start * virtualDom.avgHeight;
  const afterH = Math.max(0, (compiledSegments.length - end) * virtualDom.avgHeight);
  virtualDom.padBefore.style.height = `${beforeH}px`;
  virtualDom.padAfter.style.height = `${afterH}px`;
}
function refreshAvgHeight(){
  if(!virtualDom.viewport) return;
  const nodes = Array.from(virtualDom.viewport.children);
  if(!nodes.length) return;
  let sum = 0, count = 0;
  nodes.forEach(node=>{
    const h = node.offsetHeight;
    if(!h) return;
    const idx = Number(node.dataset.i);
    segmentHeights[idx] = h;
    sum += h; count += 1;
  });
  if(count){
    const next = sum / count;
    virtualDom.avgHeight = (virtualDom.avgHeight * 0.5) + (next * 0.5);
    updateVirtualPadding(virtualDom.start, virtualDom.end);
  }
}
function renderVirtualWindow(start, end){
  if(!reader) return;
  if(!virtualDom.viewport) ensureReaderShell();
  const total = compiledSegments.length;
  const s = Math.max(0, Math.min(start, total));
  const e = Math.max(s, Math.min(end, total));
  const viewport = virtualDom.viewport;
  const existing = new Map();
  Array.from(viewport.children).forEach(node=>{
    existing.set(Number(node.dataset.i), node);
  });
  existing.forEach((node, idx)=>{
    if(idx < s || idx >= e){
      unregisterSegmentWords(node);
      node.remove();
      existing.delete(idx);
    }
  });
  const frag = document.createDocumentFragment();
  for(let i=s; i<e; i++){
    let node = existing.get(i);
    if(!node){
      node = buildSegmentElement(compiledSegments[i]);
    }
    frag.appendChild(node);
  };
  viewport.appendChild(frag);
  virtualDom.start = s;
  virtualDom.end = e;
  updateVirtualPadding(s, e);
  requestAnimationFrame(refreshAvgHeight);
}
function computeWindowForIndex(idx){
  const total = compiledSegments.length;
  if(total === 0) return { start: 0, end: 0 };
  let start = Math.max(0, idx - Math.floor(MAX_RENDERED_SEGMENTS / 2));
  let end = Math.min(total, start + MAX_RENDERED_SEGMENTS);
  if(end - start < MAX_RENDERED_SEGMENTS && start > 0){
    start = Math.max(0, end - MAX_RENDERED_SEGMENTS);
  }
  return { start, end };
}
function renderAroundIndex(idx){
  if(!useVirtualScroll) return;
  const range = computeWindowForIndex(idx);
  renderVirtualWindow(range.start, range.end);
}
function ensureSegmentInDom(idx){
  if(!reader || compiledSegments.length === 0) return null;
  if(!useVirtualScroll){
    return reader.querySelector(`.seg[data-i="${idx}"]`);
  }
  if(idx < virtualDom.start || idx >= virtualDom.end){
    renderAroundIndex(idx);
  }
  return virtualDom.viewport?.querySelector(`.seg[data-i="${idx}"]`) || null;
}
function handleVirtualScroll(){
  if(!useVirtualScroll || !compiledSegments.length || !reader) return;
  const approxIdx = Math.floor(reader.scrollTop / Math.max(virtualDom.avgHeight, 1));
  const start = Math.max(0, approxIdx - VIRTUAL_BUFFER);
  const end = Math.min(compiledSegments.length, start + MAX_RENDERED_SEGMENTS);
  if(start === virtualDom.start && end === virtualDom.end) return;
  renderVirtualWindow(start, end);
}
function scrollToSegmentIndex(idx, behavior='smooth'){
  if(!reader || !compiledSegments.length) return;
  if(useVirtualScroll){
    const approxTop = Math.max(0, idx * virtualDom.avgHeight - virtualDom.avgHeight);
    reader.scrollTo({ top: approxTop, behavior });
    renderAroundIndex(idx);
  }else{
    const seg = reader.querySelector(`.seg[data-i="${idx}"]`);
    if(seg) seg.scrollIntoView({ behavior, block:'center' });
  }
}
function syncPlayButtonsForRenderedSegments(){
  if(!virtualDom.viewport) return;
  Array.from(virtualDom.viewport.querySelectorAll('.seg')).forEach(seg=>{
    const idx = Number(seg.dataset.i);
    applyAudioButtonIfAny(seg, idx);
  });
}
function getWordNodes(word){
  const set = wordNodeMap.get(word);
  return set ? Array.from(set) : [];
}
function findFirstSegmentIndexForWord(word){
  const key = toLowerAlpha(word);
  const re = buildVariantPattern(key) || new RegExp('\\b' + escapeRegExp(key) + '\\b', 'i');
  for(const seg of compiledSegments){
    if(re.test(seg.text)) return seg.i;
  }
  return -1;
}

/* ========= 文章處理 ========= */
function tokenizeParagraphToHTML(textLine){
  const lang = getLang();
  const WORD = lang === 'en'
    ? /[A-Za-z]+(?:'[A-Za-z]+)?/g
    : /[\p{L}]+(?:-[\p{L}]+)*(?:'[\p{L}]+)?/gu;

  const out = [];
  let last = 0, m;
  while ((m = WORD.exec(textLine)) !== null){
    if(m.index > last){
      const mid = textLine.slice(last, m.index)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      out.push(mid);
    }
    const tok = m[0];
    out.push(`<span class="word" data-w="${tok}">${tok}</span>`);
    last = WORD.lastIndex;
  }
  if(last < textLine.length){
    out.push(textLine.slice(last).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'));
  }
  return out.join('');
}

function compile(){
  ttsGenerated = false;
  segAudios.clear();
  ttsDrawer.classList.remove('show');
  deductedWords.clear();
  clearWordNodeMap();
  segmentHeights.length = 0;
  virtualDom.avgHeight = 32;

  const srcEl = document.querySelector('#src');
	const readerEl = document.querySelector('#reader');
	const langSelect = document.querySelector('#langSelect');

	const raw = (srcEl && srcEl.value) ? srcEl.value : '';
	// split into paragraphs/segments - keep same split logic as original
	const lines = raw.split(/\r?\n/);
	// collapse consecutive empty lines into empty paragraph boundaries (replicate prior behaviour)
	const segments = [];
	let buffer = [];
	for (let i = 0; i < lines.length; i++) {
		const l = lines[i];
		if (l.trim() === '') {
			if (buffer.length) {
				segments.push(buffer.join('\n'));
				buffer = [];
			} else {
				// preserve empty paragraph as empty segment if multiple blank lines
				segments.push('');
			}
		} else {
			buffer.push(l);
		}
	}
	if (buffer.length) segments.push(buffer.join('\n'));

	// --- Always render all segments (one-shot) ---
	// clear any virtual window leftovers/listeners
	try {
		if (typeof handleVirtualScroll === 'function') {
			window.removeEventListener('scroll', handleVirtualScroll, { passive: true });
		}
	} catch (e) { /* ignore if not present */ }

	// clear reader and seg audio cache (if present)
	if (readerEl) readerEl.innerHTML = '';
	if (typeof segAudios === 'object' && segAudios !== null && typeof segAudios.clear === 'function') {
		segAudios.clear();
	}
	// build HTML for all segments
	const lang = (langSelect && langSelect.value) ? langSelect.value : 'en';
	const wordRegex = (function() {
		// reuse same regex rule as original: english vs unicode word tokens
		if (lang === 'de' || lang === 'fr') {
			// Unicode-aware word token (letters)
			return /[\p{L}\p{M}]+/gu;
		}
		// fallback english-ish token
		return /[A-Za-z']+/g;
	})();

	const segHtml = segments.map((segText, idx) => {
		// escape HTML helper (minimal)
		const esc = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
		// create inner HTML by wrapping word tokens with span.word data-w
		const parts = [];
		let lastIndex = 0;
		if (!segText) {
			return `<div class="seg" data-i="${idx}"></div>`;
		}
		let m;
		while ((m = wordRegex.exec(segText)) !== null) {
			const w = m[0];
			const start = m.index;
			const end = start + w.length;
			parts.push(esc(segText.slice(lastIndex, start)));
			parts.push(`<span class="word" data-w="${esc(w)}">${esc(w)}</span>`);
			lastIndex = end;
		}
		if (lastIndex < segText.length) parts.push(esc(segText.slice(lastIndex)));
		const inner = parts.join('');
		return `<div class="seg" data-i="${idx}">${inner}</div>`;
	}).join('\n');

	if (readerEl) {
		readerEl.innerHTML = segHtml;
		// restore any per-render housekeeping from original code:
		// - rebind click/double-click handlers for words (if original had a helper, call it)
		// - re-apply HF classes
		// - reset progress UI
		// The original project exposes helpers with these names in README; call them if present.

		if (typeof bindReaderWordHandlers === 'function') {
			bindReaderWordHandlers(); // hypothetical existing helper - safe guard
		}
		// apply high-frequency highlight classes if helper exists
		if (typeof applyHFClassesToReader === 'function') {
			applyHFClassesToReader();
		}
		// cleanup any virtual window container node (renderVirtualWindow had inserted something)
		const virtualWindowNode = document.querySelector('.virtual-window');
		if (virtualWindowNode && virtualWindowNode.parentNode) {
			virtualWindowNode.parentNode.removeChild(virtualWindowNode);
		}

		// restore scroll progress if original kept it in a map
		if (typeof restoreReaderScrollProgress === 'function') {
			restoreReaderScrollProgress();
		} else if (typeof updateProgressUI === 'function') {
			updateProgressUI();
		} else {
			// try a generic progress update if available
			if (typeof onReaderScroll === 'function') onReaderScroll();
		}
	}

	// remove any flag that indicated virtual rendering was active
	if (typeof USE_VIRTUAL_WINDOW !== 'undefined') {
		try { window.USE_VIRTUAL_WINDOW = false; } catch(e){}
	}

	// ...existing code that follows compile() (e.g. saving state, TTS resets, etc.)...
}

/* ========= 字典卡 ========= */
function showWordCardSkeleton(display, word){
  card.style.display = 'block';
  resetWordQ();
  cardTitle.innerHTML =
    `<span class="badge">查詢</span> <strong style="font-size:18px">${display}</strong>`;
  cardMeta.textContent = '';
  offlineTip.style.display = 'none';
  defsBox.innerHTML = `<li style="color:#94a3b8">載入中⋯</li>`;
}
function updateWordCardFromInfo(display, word, info){
  if(!info){
    defsBox.innerHTML = `<li>（離線或查無結果，請自行補充備註作為臨時解釋。）</li>`;
    offlineTip.style.display = 'block';
    return;
  }
  cardTitle.innerHTML =
    `<span class="badge">查詢</span> <strong style="font-size:18px">${display}</strong>` +
    (info?.phon ? `<span class="phon">/${info.phon}/</span>` : '');
  cardMeta.textContent = info?.pos ? `詞性：${info.pos}` : '';
  defsBox.innerHTML = '';
  (info.defs||[]).slice(0,5).forEach(d=>{
    const li = document.createElement('li');
    li.innerHTML = d;
    defsBox.appendChild(li);
  });
  upsertWord(word, {
    display,
    pos: info.pos || '',
    phon: info.phon || '',
    defs: info.defs ? info.defs.slice(0,3) : []
  }, false);
  if(getLang() === 'en'){
    const row = getWord(word);
    postToSheet({
      lang: getLang(),
      word: row.word, display: row.display||word, pos: row.pos||'', phon: row.phon||'',
      defs: row.defs||[], note: row.note||'', count: row.count||1,
      pageUrl: location.href, userAgent: navigator.userAgent
    });
  }
}

/* ========= 字典查詢（生成） ========= */
async function generateEnglishEntry(word){
  const provider = getSelectedProvider();
  const model = getSelectedModel();
  const apiKey = (provider === 'grok')
    ? (document.getElementById('grokKey').value.trim() || loadGrokKey())
    : (document.getElementById('openaiKey').value.trim() || loadOpenAIKey());
  if(!apiKey) return null;
  const system = 'You are a concise English lexicographer. Reply in Traditional Chinese.';
  const user = `請用條列回覆單字「${word}」的精簡詞條（不要多餘說明）：
- 中文意思
- 詞性（英文縮寫，如 n., v., adj.；若多義可列最多二個）
- 音標（若不確定可略）
- 2–3 條核心義項（英文解釋，並附一個英文例句＋簡短中譯）
輸出格式例如：
詞性：n., v.
音標：/.../
義項：
1) ...（例：...｜譯：...）
2) ...（例：...｜譯：...）`;

  const txt = await doChat({
    provider, apiKey, model,
    messages: [{role:'system',content:system},{role:'user',content:user}],
    temperature: 0.3
  });
  if(!txt) return null;
  const lines = txt.split(/\n+/).map(s=>s.trim()).filter(Boolean);
  let pos = '', phon = '';
  const defs = [];
  for(const ln of lines){
    if(/^詞性[:：]/.test(ln)) pos  = ln.replace(/^詞性[:：]\s*/,'').trim();
    else if(/^音標[:：]/.test(ln)) phon = ln.replace(/^音標[:：]\s*/,'').trim().replace(/^\/|\/$/g,'');
    else if(/^義項[:：]/.test(ln)) { /* skip */ }
    else defs.push(ln);
  }
  if(!defs.length) return null;
  return { phon, pos, defs: defs.slice(0,5) };
}
async function generateFrenchEntry(word){
  const provider = getSelectedProvider();
  const model = getSelectedModel();
  const apiKey = (provider === 'grok')
    ? (document.getElementById('grokKey').value.trim() || loadGrokKey())
    : (document.getElementById('openaiKey').value.trim() || loadOpenAIKey());
  if(!apiKey) return null;
  const system = 'Tu es un lexicographe français concis. Réponds en chinois traditionnel.';
  const user = `請用條列回覆法文字「${word}」的精簡詞條（不要多餘說明）：
- 中文意思
- 詞性（法文縮寫，如 n., v., adj.；若多義可列最多二個）
- 音標（若不確定可略）
- 2–3 條核心義項（法文解釋，並附一個法文例句＋簡短中譯）
輸出格式例如：
詞性：n., v.
音標：/.../
義項：
1) ...（例：...｜譯：...）
2) ...（例：...｜譯：...）`;

  const txt = await doChat({
    provider, apiKey, model,
    messages: [{role:'system',content:system},{role:'user',content:user}],
    temperature: 0.3
  });
  if(!txt) return null;
  const lines = txt.split(/\n+/).map(s=>s.trim()).filter(Boolean);
  let pos = '', phon = '';
  const defs = [];
  for(const ln of lines){
    if(/^詞性[:：]/.test(ln)) pos  = ln.replace(/^詞性[:：]\s*/,'').trim();
    else if(/^音標[:：]/.test(ln)) phon = ln.replace(/^音標[:：]\s*/,'').trim().replace(/^\/|\/$/g,'');
    else if(/^義項[:：]/.test(ln)) { /* skip */ }
    else defs.push(ln);
  }
  if(!defs.length) return null;
  return { phon, pos, defs: defs.slice(0,5) };
}
async function generateGermanEntry(word){
  const provider = getSelectedProvider();
  const model = getSelectedModel();
  const apiKey = (provider === 'grok') ? (document.getElementById('grokKey').value.trim() || loadGrokKey())
                                       : (document.getElementById('openaiKey').value.trim() || loadOpenAIKey());
  if(!apiKey) return {
    phon:'', pos:'', defs:[ '（請先填入 API Key；或點「更多」前往補充）' ],
    deBasic:{ lemma:'', articles:'', numberForms:'', meaning:'', pos:'' }
  };

  const system = 'Du bist ein deutscher Lexikograph. Antworte kompakt in Traditionellem Chinesisch.';
  const user = `針對這個德文單字以條列回覆（僅回覆內容，不要加前後說明）：
「${word}」
詞性：
意思：
原型：
（若是名詞才顯示）定冠詞：
（若是名詞才顯示）複數：
（若是動詞才顯示，顯示在同一行）動詞變化：
（若是動詞才顯示，顯示在同一行，呈現過去式與過去分詞）過去式：
（若是形容詞才顯示）比較級／最高級：
`;

  const txt = await doChat({
    provider, apiKey, model,
    messages: [{role:'system',content:system},{role:'user',content:user}],
    temperature: 0.3
  });

  const lines = txt.split(/\n+/).map(s=>s.trim()).filter(Boolean);
  const pretty = [];
  let pos = '';
  for(const ln of lines){ pretty.push(ln); if(/^詞性/.test(ln)){ pos = ln.replace(/^詞性[:：]\s*/,''); } }
  return { phon:'', pos, defs: pretty, deBasic: { raw: txt } };
}
async function generateGermanMore(word){
  const provider = getSelectedProvider();
  const model = getSelectedModel();
  const apiKey = (provider === 'grok') ? (document.getElementById('grokKey').value.trim() || loadGrokKey())
                                       : (document.getElementById('openaiKey').value.trim() || loadOpenAIKey());
  if(!apiKey) return { more: '（請先在右側輸入 API Key）' };

  const system = 'Du bist ein deutscher Lexikograph. Antworte knapp in Traditionellem Chinesisch。';
  const user = `請針對德文單字「${word}」補充以下欄位，條列呈現（僅回覆內容，不要額外說明）：
常見搭配詞：
例句：1. … 2. …    （例句附簡短中文譯意）
其他備註（例如：可分動詞／介系詞搭配／語氣差異等）：`;

  const txt = await doChat({
    provider, apiKey, model,
    messages: [{role:'system',content:system},{role:'user',content:user}],
    temperature: 0.4
  });
  return { more: txt || '（生成失敗）' };
}
async function lookupDefinition(word){
  const lang = getLang();
  if(lang === 'de') return await generateGermanEntry(word);
  if(lang === 'fr') return await generateFrenchEntry(word);
  return await generateEnglishEntry(word);
}

/* ========= 點擊 / 雙擊 ========= */
function findWordTarget(node){
  if(!node) return null;
  return node.closest('.word');
}
function onWordClickHandler(el){
  if(!el) return;
  if (el._clickTimer) clearTimeout(el._clickTimer);
  el._clickTimer = setTimeout(()=>{ processSingleClick(el); el._clickTimer=null; }, 200);
}
function onWordDblClickHandler(el){
  if(!el) return;
  if (el._clickTimer){ clearTimeout(el._clickTimer); el._clickTimer=null; }
  el.classList.remove('tapping');
  processDoubleClick(el);
}
function onWordPointerDown(el){
  if(!el) return;
  el.classList.add('tapping');
  setTimeout(()=> el.classList.remove('tapping'), 320);
}
function handleReaderPointerDown(e){
  const target = findWordTarget(e.target);
  if(!target || target.closest('.playseg')) return;
  onWordPointerDown(target);
}
function handleReaderClick(e){
  const playBtn = e.target.closest('.playseg');
  if(playBtn){
    segPlayHandler(e);
    return;
  }
  const target = findWordTarget(e.target);
  if(!target) return;
  onWordClickHandler(target);
}
function handleReaderDblClick(e){
  const target = findWordTarget(e.target);
  if(!target || target.closest('.playseg')) return;
  onWordDblClickHandler(target);
}
async function processSingleClick(el){
  const display = el.dataset.w;
  const word = toLowerAlpha(display);
  const nodes = getWordNodes(word);
  const anyDeducted = deductedWords.has(word) || nodes.some(node => node.classList.contains('deducted'));
  if(anyDeducted){
    deductedWords.delete(word);
    nodes.forEach(node=> node.classList.remove('deducted'));
    updateHFClassesForWord(word);
    scheduleWordUiRefresh();
    return;
  }
  if(isDictOff()){
    upsertWord(word, { display }, true);
    return;
  }

  showWordCardSkeleton(display, word);
  upsertWord(word, { display }, true);

  try{
    const info = await lookupDefinition(word);
    if(getLang() === 'de'){
      if(info && info.defs?.length){
        updateWordCardFromInfo(display, word, info);
      }else{
        defsBox.innerHTML = '<li>（離線或生成失敗）</li>';
        offlineTip.style.display = 'block';
      }
      let moreBtn = document.getElementById('deMoreBtn');
      if(moreBtn) moreBtn.remove();
      moreBtn = document.createElement('button');
      moreBtn.id = 'deMoreBtn';
      moreBtn.className = 'secondary';
      moreBtn.style.marginTop = '8px';
      moreBtn.textContent = '更多';
      const contentBox = card.querySelector('.content');
      contentBox.appendChild(moreBtn);

      let moreBox = document.getElementById('deMoreBox');
      if(!moreBox){
        moreBox = document.createElement('div');
        moreBox.id = 'deMoreBox';
        moreBox.className = 'zh';
        moreBox.style.marginTop = '8px';
        contentBox.appendChild(moreBox);
      }else{
        moreBox.innerHTML = '';
      }

      moreBtn.onclick = async ()=>{
        try{
          moreBtn.disabled = true; moreBtn.textContent='生成中…';
          const extra = await generateGermanMore(display);
          moreBox.innerHTML = `
<div style="border-top:1px solid var(--border); margin-top:8px; padding-top:8px">
  ${extra.more.replace(/\n/g,'<br>')}
</div>`;
          moreBtn.remove();
        }catch(err){
          moreBox.textContent = '（生成失敗：' + err.message + '）';
          moreBtn.disabled = false; moreBtn.textContent='更多';
        }
      };
    }else{
      updateWordCardFromInfo(display, word, info);
      const moreBtn = document.getElementById('deMoreBtn'); if(moreBtn) moreBtn.remove();
      const moreBox = document.getElementById('deMoreBox'); if(moreBox) moreBox.remove();
    }
  }catch(err){
    defsBox.innerHTML = `<li>（查詢失敗：${(err&&err.message)||'未知錯誤'}）</li>`;
    offlineTip.style.display = 'block';
  }
}
function processDoubleClick(el){
  const display = el.dataset.w;
  const word = toLowerAlpha(display);
  deductedWords.add(word);
  adjustWordCount(word, -2);
  const nodes = getWordNodes(word);
  nodes.forEach(node=>{
    node.classList.remove('hf15','hf50');
    node.classList.add('deducted');
  });
  el.animate([{transform:'scale(1.02)'},{transform:'scale(1)'}],{duration:150});
}

/* ========= 生字本側欄 ========= */
function renderWordList(){
  const box = $('#wordList');
  const q = ($('#q').value || '').trim().toLowerCase();
  const all = loadWords()
    .slice()
    .sort((a,b)=> (b.lastSeen||'').localeCompare(a.lastSeen||''));
  const list = q ? all.filter(x =>
        x.word.includes(q) || (x.note||'').toLowerCase().includes(q) ) : all;

  if(!list.length){
    box.innerHTML = '<div class="empty">目前沒有生字。</div>';
    return;
  }
  box.innerHTML = list.map(x=>`
    <div class="item" data-w="${x.word}">
      <div>
        <div class="w">${x.display || x.word}${x.phon ? `<span class="phon"> /${x.phon}/</span>`:''}</div>
        <div class="t">${x.pos || ''}</div>
        ${x.defs?.length ? `<div class="t">• ${x.defs[0]}</div>`:''}
        ${x.note ? `<div class="t">備註：${x.note}</div>`:''}
      </div>
      <div class="c">×${x.count||0}</div>
      <button class="secondary" onclick="window.focusWord('${x.word}')">查看</button>
    </div>
  `).join('');
}
window.focusWord = async function(word){
  const key = toLowerAlpha(word);
  let nodes = getWordNodes(key);
  let targetSegIdx = null;
  if(!nodes.length && compiledSegments.length){
    const idx = findFirstSegmentIndexForWord(key);
    if(idx >= 0){
      targetSegIdx = idx;
      scrollToSegmentIndex(idx);
      nodes = getWordNodes(key);
    }
  }
  const animateNode = ()=>{
    const targetNode = (nodes && nodes.length) ? nodes[0] : getWordNodes(key)[0];
    if(!targetNode) return;
    const segEl = targetNode.closest('.seg');
    if(segEl && segEl.dataset.i){
      scrollToSegmentIndex(parseInt(segEl.dataset.i || '0', 10));
    }else{
      targetNode.scrollIntoView({behavior:'smooth', block:'center'});
    }
    targetNode.animate([{background:'rgba(56,189,248,.20)'},{background:'transparent'}],{duration:900});
  };
  if(nodes.length){
    animateNode();
  }else if(targetSegIdx !== null){
    setTimeout(animateNode, 120);
  }

  const x = getWord(word);
  if(!x) return;

  card.style.display = 'block';
  cardTitle.innerHTML = `<span class="badge">查詢</span> <strong style="font-size:18px">${x.display || x.word}</strong>` +
                        (x.phon ? `<span class="phon">/${x.phon}/</span>` : '');
  cardMeta.textContent = x.pos ? `詞性：${x.pos}` : '';
  resetWordQ();
  if(x.defs?.length){
    defsBox.innerHTML = x.defs.map(d=>`<li>${d}</li>`).join('');
  } else {
    const info = await lookupDefinition(word);
    if(info){
      upsertWord(word, info, false);
      defsBox.innerHTML = info.defs.map(d=>`<li>${d}</li>`).join('');
    } else {
      defsBox.innerHTML = '<li>（查無定義）</li>';
    }
  }
  noteInput.value = x.note || '';
  offlineTip.style.display = x.defs?.length ? 'none' : 'block';
};

function download(filename, text){
  const blob = new Blob([text], {type: 'text/plain;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
function exportCSV(){
  const rows = loadWords();
  const head = ['word','display','count','firstSeen','lastSeen','pos','phon','defs','note'];
  const csv = [head.join(',')].concat(rows.map(r=>{
    const vals = [
      r.word, r.display||'', r.count||0, r.firstSeen||'', r.lastSeen||'',
      r.pos||'', r.phon||'', (r.defs||[]).join(' | '), r.note||''
    ].map(v=> `"${String(v).replace(/"/g,'""')}"`);
    return vals.join(',');
  })).join('\n');
  download('words.csv', csv);
}
function exportJSON(){ download('words.json', JSON.stringify(loadWords(), null, 2)); }
function importJSONFile(file){
  const reader = new FileReader();
  reader.onload = () => {
    try{
      const data = JSON.parse(reader.result);
      if(!Array.isArray(data)) throw new Error('格式錯誤');
      const cur = loadWords();
      const map = new Map(cur.map(x=>[x.word,x]));
      data.forEach(x=>{
        const k = x.word;
        const exists = map.get(k);
        if(!exists){ map.set(k,x); }
        else{
          map.set(k, (new Date(x.lastSeen||0) > new Date(exists.lastSeen||0)) ? {...exists,...x} : {...x,...exists});
        }
      });
      saveWords(Array.from(map.values()));
      renderWordList();
      applyHFClassesToReader({ force:true });
      alert('匯入完成');
    }catch(err){ alert('匯入失敗：'+err.message); }
  };
  reader.readAsText(file);
}
function parseCSV(text){
  const rows = [];
  let i = 0, cur = [], cell = '', inQ = false;
  while(i < text.length){
    const ch = text[i];
    if(inQ){
      if(ch === '"'){
        if(text[i+1] === '"'){ cell += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      }
      cell += ch; i++; continue;
    }else{
      if(ch === '"'){ inQ = true; i++; continue; }
      if(ch === ','){ cur.push(cell); cell=''; i++; continue; }
      if(ch === '\r'){
        if(text[i+1] === '\n') i++;
        cur.push(cell); rows.push(cur); cell=''; cur=[]; i++; continue;
      }
      if(ch === '\n'){
        cur.push(cell); rows.push(cur); cell=''; cur=[]; i++; continue;
      }
      cell += ch; i++; continue;
    }
  }
  cur.push(cell); rows.push(cur);
  return rows.map(r => r.map(c => (c||'').replace(/^\uFEFF/,'').trim()));
}
function importCSVText(csvText){
  const grid = parseCSV(csvText).filter(r => r.some(c => c && c.length));
  if(!grid.length){ alert('CSV 無內容'); return; }
  const head = grid[0].map(x => x.toLowerCase());
  const hasHeader = ['word','display','pos','phon','defs','note','count'].some(k => head.includes(k));
  const base = loadWords();
  const map = new Map(base.map(x => [x.word, x]));
  let added = 0, updated = 0;
  const rows = hasHeader ? grid.slice(1) : grid;
  const idx = (name) => head.indexOf(name);
  for(const r of rows){
    let w = '';
    if(hasHeader){
      w = (r[idx('word')] || '').trim();
    }else{
      w = (r[0] || '').trim();
    }
    if(!w) continue;
    const key = toLowerAlpha(w);
    const display = hasHeader ? (r[idx('display')] || w).trim() : w;
    const pos  = hasHeader ? (r[idx('pos')]  || '').trim() : '';
    const phon = hasHeader ? (r[idx('phon')] || '').trim() : '';
    const defsRaw = hasHeader ? (r[idx('defs')] || '').trim() : '';
    const note = hasHeader ? (r[idx('note')] || '').trim() : '';
    const countCsv = hasHeader ? (parseInt(r[idx('count')] || '0',10) || 0) : 0;
    const defs = defsRaw
      ? defsRaw.split('|').map(s => s.trim()).filter(Boolean)
      : [];
    const now = nowISO();
    const existed = map.get(key);
    if(existed){
      map.set(key, {
        ...existed,
        display: display || existed.display || w,
        pos: pos || existed.pos || '',
        phon: phon || existed.phon || '',
        defs: defs.length ? defs : (existed.defs || []),
        note: note || existed.note || '',
        count: Math.max(0, (existed.count||0)) + 5 + (countCsv||0),
        lastSeen: now
      });
      updated++;
    }else{
      map.set(key, {
        word: key,
        display: display || w,
        count: 5 + (countCsv||0),
        firstSeen: now,
        lastSeen: now,
        pos, phon, defs, note
      });
      added++;
    }
  }
  saveWords(Array.from(map.values()));
  renderWordList();
  applyHFClassesToReader({ force:true });
  alert(`CSV 匯入完成：新增 ${added} 筆、更新 ${updated} 筆（每字額外 +5 次點擊）。`);
}
function importCSVFile(file){
  const fr = new FileReader();
  fr.onload = () => {
    try{
      importCSVText(String(fr.result||''));
    }catch(err){
      alert('匯入失敗：' + err.message);
    }
  };
  fr.readAsText(file, 'utf-8');
}

/* ========= OpenAI / Grok ========= */
async function doChat({ provider, apiKey, model, messages, temperature=0.7 }) {
  const p = (provider || 'openai');
  const m = model && model.trim();
  if(p === 'grok'){
    const key = apiKey || loadGrokKey();
    if(!key) throw new Error('請先填入 Grok API Key');
    const useModel = m || 'grok-4';
    const resp = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: useModel, messages, temperature })
    });
    if(!resp.ok){
      const msg = await resp.text().catch(()=>resp.status);
      throw new Error('Grok 失敗：' + msg);
    }
    const data = await resp.json();
    return (data.choices?.[0]?.message?.content || '').trim();
  }
  {
    const key = apiKey || loadOpenAIKey();
    if(!key) throw new Error('請先填入 OpenAI API Key');
    const useModel = m || 'gpt-4o-mini';
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: useModel, messages, temperature })
    });
    if(!resp.ok){
      const msg = await resp.text().catch(()=>resp.status);
      throw new Error('OpenAI 失敗：' + msg);
    }
    const data = await resp.json();
    return (data.choices?.[0]?.message?.content || '').trim();
  }
}

function getTopNWordsLocal(n=15){
  const all = loadWords();
  return (all||[])
    .slice()
    .sort((a,b)=>{
      const c = (b.count||0) - (a.count||0);
      return c !== 0 ? c : (b.lastSeen||'').localeCompare(a.lastSeen||'');
    })
    .slice(0, n)
    .map(x => x.display || x.word)
    .filter(Boolean);
}

function buildVariantPattern(w){
  const lang = getLang();
  const root = (w || '').trim();
  if(!root) return null;
  if(lang === 'de'){
    return new RegExp('\\b' + root.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '\\b', 'iu');
  }
  if(lang === 'fr'){
    const base = root.toLowerCase();
    const forms = new Set([
      base, base+'s', base+'es', base+'e', base+'er', base+'ers',
      base+'é', base+'ée', base+'és', base+'ées',
      base+'ant', base+'ants', base+'ante', base+'antes',
      base+'ait', base+'aient'
    ]);
    return new RegExp('\\b(' + Array.from(forms).map(escapeRegExp).join('|') + ')\\b', 'iu');
  }
  const base = root.toLowerCase();
  const forms = new Set([base, base+'s']);
  if (/(s|x|z|ch|sh|o)$/.test(base)) forms.add(base + 'es');
  if (/[^aeiou]y$/.test(base)) { forms.add(base.slice(0,-1) + 'ies'); forms.add(base.slice(0,-1) + 'ied'); }
  if (!base.endsWith('e')) { forms.add(base + 'ed'); forms.add(base + 'ing'); forms.add(base + 'ings'); }
  else { forms.add(base + 'd'); forms.add(base.slice(0,-1) + 'ing'); forms.add(base.slice(0,-1) + 'ings'); }
  forms.add(base + 'er'); forms.add(base + 'est'); forms.add(base + 'ly');
  ['ness','ful','less','ment','tion','sion','ation','able','ible','al','ive','ish','ity','ous','y']
    .forEach(suf => forms.add(base + suf));
  const IRREG = {
    child: ['children'], person: ['people'], man: ['men'], woman: ['women'],
    mouse: ['mice'], goose: ['geese'], foot: ['feet'], tooth: ['teeth'],
    go: ['went','gone'], be: ['am','is','are','was','were','been','being'],
    have: ['has','had'], do: ['does','did','done','doing']
  };
  if(IRREG[base]) IRREG[base].forEach(v=>forms.add(v));
  return new RegExp('\\b(' + Array.from(forms).map(escapeRegExp).join('|') + ')\\b', 'i');
}

function wordsMissingFrom(text, words){
  const t = text || '';
  const missing = [];
  for(const w of words){
    const re = buildVariantPattern(w);
    if(re && !re.test(t)) missing.push(w);
  }
  return missing;
}

function buildUserPromptByType({ lang, type, words, level, customTopic, targetCount }){
  const lc = (level||'B1').toUpperCase();
  const listText = words.join(', ');
  const commonRuleEN = words.length
    ? `Include EVERY ONE of the following target words at least once (allow inflected/derived forms): ${listText}`
    : `No specific target words are required.`;
  const commonRuleDE = words.length
    ? `Verwende JEDES der folgenden Zielwörter mindestens einmal (Groß-/Kleinschreibung egal, Beugungen erlaubt): ${listText}`
    : `Keine bestimmten Zielwörter erforderlich.`;
  const isDE = (lang === 'de');
  const isFR = (lang === 'fr');
  const commonRuleFR = words.length
    ? `Incluez CHAQUE mot cible au moins une fois (formes fléchies ou dérivées acceptées) : ${listText}`
    : `Aucun mot cible particulier requis.`;
  const approxLenEN = `about ${targetCount || 500} words`;
  const approxLenDE = `ca. ${targetCount || 500} Wörter`;
  const approxLenFR = `environ ${targetCount || 500} mots`;

  if(type === 'fairy_tale'){
    return isDE
      ? `Schreibe ein zusammenhängendes Märchen auf Deutsch (CEFR ${lc}), ${approxLenDE}.
${commonRuleDE}
Keine Aufzählungen. Nur Absätze als Fließtext.`
      : isFR
        ? `Écris un conte de fées cohérent et inspirant en français (CECR ${lc}), ${approxLenFR}.
${commonRuleFR}
Pas de puces. Fournis uniquement le récit en paragraphes.`
      : `Write a whimsical, coherent fairy tale in CEFR ${lc} English, ${approxLenEN}.
${commonRuleEN}
Do not use bullet points. Output only the story as paragraphs.`;
  }
  if(type === 'dialogue'){
    return isDE
      ? `Schreibe einen natürlichen Alltagsdialog auf Deutsch (CEFR ${lc}), ${approxLenDE}.
${commonRuleDE}
Format strikt:
- Verwende Sprecherlabels wie "A:" und "B:" (optional "C:").
- JEDER Turn steht in einer eigenen Zeile (genau eine Leerzeile dazwischen vermeiden).
- Keine Aufzählungen oder Nummerierungen.
- Kurze, realistische Turns.`
      : isFR
        ? `Écris un dialogue de la vie quotidienne en français (CECR ${lc}), ${approxLenFR}.
${commonRuleFR}
Format strict :
- Utilise des étiquettes de locuteur comme "A:" et "B:" (éventuellement "C:").
- PLACE CHAQUE RÉPLIQUE SUR SA PROPRE LIGNE (pas de ligne vide entre les répliques).
- Aucune liste à puces ni numérotation.
- Répliques courtes et naturelles.`
      : `Write a natural daily-life conversation in CEFR ${lc} English, ${approxLenEN}.
${commonRuleEN}
Format strictly:
- Use alternating speaker labels like "A:" and "B:" (optionally "C:").
- PUT EACH TURN ON ITS OWN LINE (use a single newline between turns, no blank lines).
- Do NOT use bullet points or numbering.
- Keep turns concise and realistic.`;
  }
  if(type === 'article'){
    return isDE
      ? `Schreibe einen informativen Fachartikel auf Deutsch (CEFR ${lc}), ${approxLenDE}.
Wähle ein zufälliges Themenfeld: Medizin, Recht, Finanzen, Ingenieurwesen, Umwelt, Bildung, Technologie, Psychologie, Design, Stadtplanung, Public Health, Landwirtschaft, Energie, Verkehr, Data Science.
${commonRuleDE}
Zielgruppe: gebildete Allgemeinheit. Keine Aufzählungen; gut strukturierte Absätze.`
      : isFR
        ? `Rédige un article informatif en français (CECR ${lc}), ${approxLenFR}.
Choisis un domaine au hasard : médecine, droit, finance, ingénierie, sciences de l'environnement, éducation, technologie, psychologie, design, urbanisme, santé publique, agriculture, énergie, transport, science des données.
${commonRuleFR}
Public cible : grand public instruit. Pas de listes à puces ; utilise des paragraphes bien structurés.`
      : `Write an informative professional article (${approxLenEN}) in CEFR ${lc} English.
Pick a random field from: medicine, law, finance, engineering, environmental science, education, technology, psychology, design, urban planning, public health, agriculture, energy, transportation, data science.
${commonRuleEN}
Target educated general readers. No bullet lists; use well-formed paragraphs only.`;
  }
  if(type === 'custom'){
    const topic = (customTopic || '').trim();
    const safeTopic = topic || (isDE ? 'ein frei wählbares Thema' : 'a topic of your choice');
    return isDE
      ? `Schreibe einen zusammenhängenden Text auf Deutsch (CEFR ${lc}), ${approxLenDE}, zum Thema:
「${safeTopic}」
${commonRuleDE}
- Keine Aufzählungen oder Nummerierungen (außer das Thema impliziert explizit einen Dialog).
- Wenn das Thema einen Dialog nahelegt, verwende "A:" / "B:"-Turns, jeder Turn in einer eigenen Zeile.
- Andernfalls schreibe in gut gegliederten Absätzen.`
      : isFR
        ? `Écris un texte cohérent en français (CECR ${lc}), ${approxLenFR}, sur le thème :
「${safeTopic || 'un sujet de ton choix'}」
${commonRuleFR}
- Pas de listes ou numérotation (sauf si le thème implique explicitement un dialogue).
- Si le thème suggère un dialogue, utilise des tours "A:" / "B:", chaque tour sur sa propre ligne.
- Sinon, écris en paragraphes bien formés.`
      : `Write a coherent piece in CEFR ${lc} English, ${approxLenEN}, on the topic:
“${safeTopic}”
${commonRuleEN}
- No bullet lists or numbering (unless the topic explicitly implies a dialogue).
- If the topic suggests a dialogue, use "A:" / "B:" turns, each turn on its own line.
- Otherwise, write in well-formed paragraphs.`;
  }
  if(type === 'mature_18'){
    const topic = (customTopic || '').trim();
    const safe = topic || (isDE ? 'ein reifes, romantisches Thema' : (isFR ? 'un thème romantique et adulte' : 'a mature, romantic theme'));
    return isDE
      ? `Schreibe eine reife, romantische Kurzgeschichte auf Deutsch (CEFR ${lc}), ${approxLenDE}.
Thema: „${safe}“
Rahmenbedingungen:
Schreibe eine explizite erotische Kurzgeschichte，請自行調整保持合宜。`
      : isFR
        ? `Écris une nouvelle romantique pour adultes en français (CECR ${lc}), ${approxLenFR}.
Thème : «${safe || 'un thème romantique et adulte'}»
Consignes :
Rédige une histoire érotique explicite en conservant un fil narratif cohérent.`
      : `Write a mature, romance-driven short story in CEFR ${lc} English (${approxLenEN}).
Theme: “${safe}”
Constraints:
Write an explicit erotic short story while keeping a coherent narrative.`;
  }
  return isDE
    ? `Schreibe einen gut strukturierten Text (CEFR ${lc}), ${approxLenDE}.\n${commonRuleDE}`
    : isFR
      ? `Écris un texte bien structuré en français (CECR ${lc}), ${approxLenFR}.\n${commonRuleFR}`
      : `Write a well-structured text in CEFR ${lc} English, ${approxLenEN}.\n${commonRuleEN}`;
}

async function generateContentWithOpenAI({ lang, type, words, level, customTopic, targetCount }){
  const provider = getSelectedProvider();
  const model = getSelectedModel();
  const key = (provider === 'grok')
    ? (document.getElementById('grokKey').value.trim() || loadGrokKey())
    : (document.getElementById('openaiKey').value.trim() || loadOpenAIKey());

  const lc = (level||'B1').toUpperCase();
  const isDE = (lang === 'de');
  const system = isDE
    ? `Du bist ein hilfreicher Schreibassistent. Schreibe in klarem Deutsch (CEFR ${lc}).`
    : (lang === 'fr')
      ? `Tu es un assistant de rédaction utile. Écris en français clair (CECR ${lc}).`
      : `You are a helpful writing assistant. Write in clear CEFR ${lc} English.`;
  const user = buildUserPromptByType({ lang, type, words, level, customTopic, targetCount });

  const content = await doChat({
    provider, apiKey: key, model,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    temperature: 0.9
  });
  return content || '';
}

async function reviseContentToInclude({ lang, baseText, missingWords, level, type, targetCount }){
  const provider = getSelectedProvider();
  const model = getSelectedModel();
  const key = (provider === 'grok')
    ? (document.getElementById('grokKey').value.trim() || loadGrokKey())
    : (document.getElementById('openaiKey').value.trim() || loadOpenAIKey());

  const lc = (level||'B1').toUpperCase();
  const isDE = (lang === 'de');
  const keepLenEN = `Keep the length ~${targetCount || 500} words (±15%).`;
  const keepLenDE = `Halte die Länge bei ca. ${targetCount || 500} Wörtern (±15%).`;
  const isFR = (lang === 'fr');
  const keepLenFR = `Garde une longueur d'environ ${targetCount || 500} mots (±15%).`;
  const listText = missingWords.join(', ');
  const system = isDE
    ? `Du überarbeitest einen ${type}-Text auf Deutsch (CEFR ${lc}).`
    : isFR
      ? `Tu révises un texte ${type} en français (CECR ${lc}).`
      : `You are an assistant revising a ${type} in CEFR ${lc} English.`;
  const user = isDE
    ? `Überarbeite den folgenden deutschen Text so, dass ALLE diese Zielwörter mindestens einmal vorkommen (Groß-/Kleinschreibung egal, Beugungen/Derivate erlaubt): ${listText}
${keepLenDE} Stil beibehalten. Gib NUR den revidierten Text aus, ohne額外說明。

Text:
${baseText}`
    : isFR
      ? `Révise le texte français suivant afin que TOUS ces mots cibles apparaissent au moins une fois (insensible à la casse, formes fléchies/dérivées admises) : ${listText}
${keepLenFR} Garde le style proche. Fourni UNIQUEMENT le texte révisé, sans commentaires supplémentaires.

Texte :
${baseText}`
      : `Revise the following text so that it includes ALL of these target words at least once, using either the exact word OR a natural inflected/derived form: ${listText}
${keepLenEN} Keep the style similar. Output the revised text only, no extra commentary.

Text:
${baseText}`;

  const revised = await doChat({
    provider, apiKey: key, model,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    temperature: 0.8
  });
  return revised || baseText;
}

/* ========= 解析 ========= */
function selectionWithinReaderStrict(){
  const sel = window.getSelection();
  if(!sel || sel.isCollapsed) return '';
  try{
    const range = sel.getRangeAt(0);
    const container = range.commonAncestorContainer;
    const node = container.nodeType === 1 ? container : container.parentNode;
    if(!reader.contains(node)) return '';
    return sel.toString().trim();
  }catch{ return ''; }
}
function updateBottomBar(){
  if(lastSelectionText){
    bottomBar.style.display = 'flex';
    selStatus.textContent = '按「翻譯與文法」解析選取的內容';
    selPreview.textContent = lastSelectionText.length > 38 ? (lastSelectionText.slice(0,38)+'…') : lastSelectionText;
    doExplainBtn.disabled = false;
  }else{
    bottomBar.style.display = 'none';
    selStatus.textContent = '請先在左側文章中框選句子或片段';
    selPreview.textContent = '未選取';
    doExplainBtn.disabled = true;
  }
}
function bindSelectionWatcher(){
  document.addEventListener('selectionchange', ()=>{
    const txt = selectionWithinReaderStrict();
    lastSelectionText = txt;
    updateBottomBar();
  });
  $('#analysisClose')?.addEventListener('click', ()=> analysisCard.style.display='none');
  doExplainBtn?.addEventListener('click', ()=>{
    if(!lastSelectionText){ alert('請先框選句子或片段'); return; }
    explainSelectionWithOpenAI(lastSelectionText);
  });
}

async function explainSelectionWithOpenAI(text){
  resetAnalysisQ();
  const provider = getSelectedProvider();
  const model = getSelectedModel();
  const key = (provider === 'grok')
    ? (document.getElementById('grokKey').value.trim() || loadGrokKey())
    : (document.getElementById('openaiKey').value.trim() || loadOpenAIKey());

  if(!key){ alert('請先填入對應的 API Key'); return; }
  if(!text){ alert('請先框選句子或片段'); return; }

  analysisCard.style.display = 'block';
  anaSrc.textContent = text;
  anaZh.textContent = '生成中…';
  anaGram.textContent = '生成中…';

  const system = '你是一位專業的英語／德語／法語老師，能以繁體中文詳細解析句子。';
  const user = `請針對以下英文、德文或法文句子進行完整的文法與翻譯分析，輸出格式請嚴格遵守：

① 中文翻譯：
（完整、自然的中文意思）

② 文法分析：
主詞（Subject）：
動詞（Verb）：
受詞（Object）：
句型結構：

③ 文法重點與說明：
重點1：（英文／德文／法文片段）→ 中文說明
重點2：（英文／德文／法文片段）→ 中文說明

④ 常見片語：
列出此句中出現的常見片語或固定搭配（若有），每個片語附中文解釋。

⑤ 其他例句：
請依上方文法重點各造一個新的英文、德文或法文例句。

句子如下：
${text}

請務必使用上述五個標題（①②③④⑤），不要添加其他內容。`;

  try{
    const txt = await doChat({
      provider, apiKey: key, model,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      temperature: 0.4
    });

    const zhMatch = txt.match(/①[\s\S]*?中文翻譯[:：]\s*([\s\S]*?)(?=\n②|$)/);
    const gramMatch = txt.match(/②[\s\S]*?文法分析[:：]\s*([\s\S]*?)(?=\n③|$)/);
    const focusMatch = txt.match(/③[\s\S]*?文法重點與說明[:：]\s*([\s\S]*?)(?=\n④|$)/);
    const phraseMatch = txt.match(/④[\s\S]*?常見片語[:：]\s*([\s\S]*?)(?=\n⑤|$)/);
    const exMatch = txt.match(/⑤[\s\S]*?其他例句[:：]\s*([\s\S]*)/);

    anaZh.textContent = zhMatch ? zhMatch[1].trim() : '（未取得翻譯）';
    let html = '';
    if(gramMatch){ html += `<div class="sec"><h4>② 文法分析</h4><pre class="zh">${gramMatch[1].trim()}</pre></div>`; }
    if(focusMatch){
      const lines = focusMatch[1].split(/\n+/).map(s=>s.trim()).filter(Boolean);
      const lis = lines.map((line)=>{
        const m = line.match(/重點\d+：\s*（(.+?)）\s*→\s*(.+)$/);
        const en = m ? m[1].trim() : line.replace(/^重點\d+[:：]\s*/,'');
        const zh = m ? m[2].trim() : '';
        return `<li><strong>${en}</strong> — ${zh}</li>`;
      }).join('');
      html += `<div class="sec"><h4>③ 文法重點與說明</h4><ul>${lis}</ul></div>`;
    }
    if(phraseMatch){
      const lines = phraseMatch[1].split(/\n+/).map(s=>s.trim()).filter(Boolean);
      const lis = lines.map((line,i)=>{
        let ph = line, ex = '';
        const mm = line.match(/^(.*?)\s*(—|–|-|：|:)\s*(.*)$/);
        if(mm){ ph = (mm[1]||'').trim(); ex = (mm[3]||'').trim(); }
        return `<li data-phrase="${ph.replace(/"/g,'&quot;')}" data-explain="${ex.replace(/"/g,'&quot;')}"><strong>${ph}</strong>${ex?` — ${ex}`:''}
          <button class="secondary more-ex-btn" data-kind="phrase" data-index="${i}">其他例句</button>
          <ul class="more-ex-list" style="margin-top:6px;padding-left:18px"></ul></li>`;
      }).join('');
      html += `<div class="sec"><h4>④ 常見片語</h4><ul>${lis}</ul></div>`;
    }
    if(exMatch){ html += `<div class="sec examples"><h4>⑤ 其他例句</h4><pre class="zh">${(exMatch[1]||'').trim()}</pre></div>`; }
    anaGram.innerHTML = html || '<div class="help">（未解析到文法資訊）</div>';
    anaGram.dataset.original = text;
  }catch(err){
    anaZh.textContent = '產生失敗：' + err.message;
    anaGram.textContent = '';
  }
}

/* ========= 問答區 ========= */
function resetWordQ(){
  const i = document.getElementById('wordQInput');
  const a = document.getElementById('qaBox');
  if(i) i.value = '';
  if(a) a.textContent = '';
}
function resetAnalysisQ(){
  const i = document.getElementById('extraQInput');
  const a = document.getElementById('extraQAns');
  if(i) i.value = '';
  if(a) a.textContent = '';
}
function bindExtraQuestionUI(){
  const btn = document.getElementById('extraQBtn');
  if(!btn) return;
  btn.addEventListener('click', async ()=>{
    const sel = (document.getElementById('anaSrc').textContent || '').trim();
    const q = document.getElementById('extraQInput').value.trim();
    if(!sel || !q) return;
    const provider = getSelectedProvider();
    const model = getSelectedModel();
    const key = (provider === 'grok')
      ? (document.getElementById('grokKey').value.trim() || loadGrokKey())
      : (document.getElementById('openaiKey').value.trim() || loadOpenAIKey());
    document.getElementById('extraQAns').textContent = '生成中...';
    try{
      const ans = await doChat({
        provider, apiKey: key, model,
        messages: [
          {role:'system',content:'你是英語／德語／法語語法與語意分析專家，請只針對該句子作答，並用繁體中文。'},
          {role:'user',content:`句子：${sel}\n問題：${q}`}
        ],
        temperature: 0.3
      });
      document.getElementById('extraQAns').innerHTML = ans || '（無回應）';
      document.getElementById('extraQInput').value = '';
    }catch(err){
      document.getElementById('extraQAns').textContent = '（生成失敗）';
    }
  });
}
function bindWordCardQA(){
  const btn = document.getElementById('wordQBtn');
  const input = document.getElementById('wordQInput');
  if(!btn || !input) return;
  btn.addEventListener('click', async ()=>{
    const q = (input.value || '').trim();
    if(!q) return;
    const provider = getSelectedProvider();
    const model = getSelectedModel();
    const key = (provider === 'grok')
      ? (document.getElementById('grokKey').value.trim() || loadGrokKey())
      : (document.getElementById('openaiKey').value.trim() || loadOpenAIKey());
    if(!key){ alert('請先輸入對應的 API Key'); return; }
    const titleText = (document.getElementById('cardTitle').textContent || '').trim();
    const word = titleText.replace(/^查詢\s*/,'').trim();
    document.getElementById('qaBox').textContent = '回答生成中...';
    try{
      const ans = await doChat({
        provider, apiKey: key, model,
        messages: [
          {role:'system',content:'你是一位英／德／法字典專家，只能針對該單字回答，請用繁體中文簡潔作答。'},
          {role:'user',content:`單字：${word}\n問題：${q}`}
        ]
      });
      document.getElementById('qaBox').innerHTML = ans || '（無回應）';
      document.getElementById('wordQInput').value = '';
    }catch(err){
      document.getElementById('qaBox').textContent = '（生成失敗）';
    }
  });
}

/* ========= 生成內容 UI ========= */
function bindStoryUI(){
  const keyInput   = $('#openaiKey');
  const grokInput  = $('#grokKey');
  const saveBtn    = $('#saveKey');
  const genBtn     = $('#genContent');
  const levelSel   = $('#levelSelect');
  const genreSel   = $('#genreSelect');
  const topicInput = $('#customTopic');
  const providerSel = $('#providerSelect');
  const modelSel    = $('#modelSelect');

  const MODEL_OPTIONS = {
    openai: [ 'gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini' ],
    grok: [ 'grok-4', 'grok-4-fast', 'grok-2.5', 'grok-2-latest', 'grok-2-mini' ]
  };

  keyInput.value  = loadOpenAIKey();
  grokInput.value = loadGrokKey();

  function refillModelOptions(){
    const p = providerSel.value || 'openai';
    const opts = MODEL_OPTIONS[p] || [];
    modelSel.innerHTML = opts.map(x=>`<option value="${x}">${x}</option>`).join('');
  }
  refillModelOptions();

  function reflectProviderUI(){
    const p = providerSel.value || 'openai';
    if(p === 'grok'){
      grokInput.style.display = '';
      keyInput.style.display  = '';
    }else{
      grokInput.style.display = 'none';
      keyInput.style.display  = '';
    }
    refillModelOptions();
  }
  providerSel.addEventListener('change', reflectProviderUI);
  reflectProviderUI();

  const toggleTopic = ()=>{
    const t = genreSel.value;
    if(t === 'custom' || t === 'mature_18'){ topicInput && (topicInput.style.display = ''); }
    else{
      if(topicInput){ topicInput.style.display = 'none'; topicInput.value = ''; }
    }
  };
  genreSel.addEventListener('change', toggleTopic);
  toggleTopic();

  saveBtn.addEventListener('click', ()=>{
    saveOpenAIKey(keyInput.value);
    saveGrokKey(grokInput.value);
    alert('已儲存到本機（localStorage）');
  });

  genBtn.addEventListener('click', async ()=>{
    try{
      genBtn.disabled = true; genBtn.textContent = '生成中…';
      const provider = getSelectedProvider();
      const usingKey = (provider === 'grok')
        ? (grokInput.value.trim() || loadGrokKey())
        : (keyInput.value.trim()  || loadOpenAIKey());
      if(!usingKey){ alert('請先填入對應的 API Key'); return; }

      const lang  = getLang();
      const level = (levelSel.value || 'B1').toUpperCase();
      const type  = genreSel.value;
      const customTopic = (topicInput?.value || '').trim();
      const targetCount = getTargetLen();
      if((type === 'custom' || type === 'mature_18') && !customTopic){
        alert('請輸入主題。');
        return;
      }
      let words = getTopNWordsLocal(15);
      if(words.length === 0){
        const text = await generateContentWithOpenAI({ lang, type, words: [], level, customTopic, targetCount });
        $('#src').value = text; compile(); saveActiveSlot();
        alert('已生成隨機內容（目前生字本沒有單字）。');
        return;
      }
      let text = await generateContentWithOpenAI({ lang, type, words, level, customTopic, targetCount });
      let missing = wordsMissingFrom(text, words);
      if(missing.length){
        text = await reviseContentToInclude({ lang, baseText: text, missingWords: missing, level, type, targetCount });
        missing = wordsMissingFrom(text, words);
        if(missing.length){ alert('注意：仍未成功納入：\n' + missing.join(', ')); }
      }
      $('#src').value = text; compile(); saveActiveSlot();
      alert(type === 'custom'
        ? '已依自訂主題生成內容，並盡力納入前 15 個高頻單字（允許詞形變化/派生）。'
        : '已生成內容並盡力納入前 15 個高頻單字（允許詞形變化/派生）。');
    }catch(err){
      console.error(err); alert('發生錯誤：' + err.message);
    }finally{
      genBtn.disabled = false; genBtn.textContent = '生成內容';
    }
  });
}

/* ========= 一般綁定 ========= */
function bindReaderDelegates(){
  if(!reader) return;
  reader.addEventListener('pointerdown', handleReaderPointerDown, { passive: true });
  reader.addEventListener('click', handleReaderClick);
  reader.addEventListener('dblclick', handleReaderDblClick);
}
function bindGeneralUI(){
  $('#compile')?.addEventListener('click', ()=>{ compile(); applyScrollProgress(reader, 0); saveActiveSlot(); });
  $('#sample')?.addEventListener('click', ()=>{
    $('#src').value = `A: Hey, do you want to grab coffee after class?
B: Sure! I was thinking about that new place near the library.
A: The one with the cozy lights and the giant muffins?
B: Exactly. Their muffins are legendary.
A: Let's meet there at five, then.
B: Deal! See you at five.

In the heart of the city, curiosity sparks when we notice subtle patterns in everyday life.
Language evolves; words adapt, meanings shift, and our interpretations blossom.`;
    compile(); applyScrollProgress(reader, 0); saveActiveSlot(); setStatus('已貼上範例，已儲存到書格');
  });
  $('#clearAll')?.addEventListener('click', ()=>{
    $('#src').value=''; compiledSegments = []; useVirtualScroll = false; deductedWords.clear(); clearWordNodeMap(); segmentHeights.length = 0;
    teardownReader();
    reader.innerHTML='<div class="empty">已清空，請貼上新文章。</div>';
    for(const [,v] of segAudios){ try{ URL.revokeObjectURL(v.url); }catch{} }
    segAudios.clear(); ttsGenerated=false; ttsDrawer.classList.remove('show');
    updateProgressUI(0); saveActiveSlot();
  });
  $('#cardClose')?.addEventListener('click', ()=> card.style.display='none'); resetWordQ();
  $('#exportCSV')?.addEventListener('click', exportCSV);
  $('#exportJSON')?.addEventListener('click', exportJSON);
  $('#importJSON')?.addEventListener('change', e=>{
    const f = e.target.files?.[0];
    if(f) importJSONFile(f);
    e.target.value = '';
  });
  $('#importCSV')?.addEventListener('change', e=>{
    const f = e.target.files?.[0];
    if(f) importCSVFile(f);
    e.target.value = '';
  });
  $('#resetWords')?.addEventListener('click', ()=>{
    if(confirm('確定要清空生字本？此動作無法復原。')){
      saveWords([]); renderWordList(); applyHFClassesToReader({ force:true });
      deductedWords.clear();
      wordNodeMap.forEach(set => set.forEach(el => el.classList.remove('deducted')));
    }
  });
  $('#q')?.addEventListener('input', renderWordList);
  $('#qClear')?.addEventListener('click', ()=>{ $('#q').value=''; renderWordList(); });
  document.getElementById('langSelect')?.addEventListener('change', updateUILang);
  const dictBtn = document.getElementById('toggleDict');
  if(dictBtn){
    dictBtn.addEventListener('click', ()=>{
      setDictOff(!isDictOff());
      updateDictToggleUI();
    });
  }
  $('#saveNote')?.addEventListener('click', ()=>{
    const titleText = (document.getElementById('cardTitle').textContent || '').trim();
    const word = titleText.replace(/^查詢\s*/,'').trim();
    updateWordNote(word, noteInput.value || '');
    setStatus('已儲存備註');
  });
}
