const STORAGE_KEY = 'local-text-reader.slots.v1';
const ACTIVE_KEY = 'local-text-reader.activeSlot.v1';
const PROGRESS_KEY = 'local-text-reader.progress.v1';
const BOOKMARKS_KEY = 'local-text-reader.bookmarks.v1';
export const MAX_SLOTS = 5;
export const MAX_BOOKMARKS_PER_SLOT = 50;

export function defaultSlot(id) {
  return {
    id,
    title: `書本 ${id}`,
    content: '',
    createdAt: null,
    updatedAt: null,
    progress: 0, // 0~1 scroll ratio
  };
}

function normalizeSlots(raw) {
  const slots = Array.isArray(raw) ? raw : [];
  const map = new Map();

  slots.forEach((slot) => {
    if (!slot || typeof slot.id !== 'number') return;
    const id = clampId(slot.id);
    map.set(id, {
      ...defaultSlot(id),
      ...slot,
      progress: clampProgress(slot.progress ?? 0),
    });
  });

  for (let i = 1; i <= MAX_SLOTS; i += 1) {
    if (!map.has(i)) map.set(i, defaultSlot(i));
  }

  return Array.from(map.values()).sort((a, b) => a.id - b.id);
}

function readSlots() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

function writeSlots(slots) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(slots));
  } catch {
    /* ignore */
  }
}

function readProgress() {
  try {
    const stored = localStorage.getItem(PROGRESS_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

function writeProgress(map) {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

function readBookmarks() {
  try {
    const stored = localStorage.getItem(BOOKMARKS_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

function writeBookmarks(map) {
  try {
    localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

function normalizeProgress(raw) {
  const out = {};
  if (raw && typeof raw === 'object') {
    Object.entries(raw).forEach(([k, v]) => {
      const idNum = clampId(Number(k));
      if (!Number.isFinite(idNum)) return;
      out[idNum] = clampProgress(v ?? 0);
    });
  }
  return out;
}

function normalizeBookmarks(raw) {
  const out = {};
  for (let i = 1; i <= MAX_SLOTS; i += 1) {
    out[i] = [];
  }

  if (!raw || typeof raw !== 'object') return out;

  Object.entries(raw).forEach(([slotId, list]) => {
    const rawId = Number(slotId);
    if (!Number.isFinite(rawId)) return;
    const idNum = clampId(rawId);
    const arr = Array.isArray(list) ? list : [];
    const normalized = arr
      .map((item, idx) => normalizeBookmark(item, idx))
      .filter(Boolean)
      .slice(0, MAX_BOOKMARKS_PER_SLOT);
    out[idNum] = normalized;
  });

  return out;
}

function normalizeBookmark(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null;
  const anchorRaw = raw.anchor && typeof raw.anchor === 'object' ? raw.anchor : null;
  const anchorIdx = Number(anchorRaw?.i);
  if (!Number.isFinite(anchorIdx) || anchorIdx < 0) return null;

  const offsetRaw = Number(anchorRaw?.offset);
  const progressRaw = Number(raw.progress);
  const now = new Date().toISOString();
  const id = String(raw.id || '').trim() || `bm-${Date.now().toString(36)}-${idx}`;
  const label = String(raw.label || '').trim() || '書籤';
  const snippet = String(raw.snippet || '').trim().slice(0, 180);
  const createdAt = isValidISO(raw.createdAt) ? raw.createdAt : now;
  const contentHash = String(raw.contentHash || '').trim().slice(0, 64);

  return {
    id,
    label,
    anchor: {
      i: Math.max(0, Math.floor(anchorIdx)),
      offset: Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0,
    },
    progress: clampProgress(Number.isFinite(progressRaw) ? progressRaw : 0),
    snippet,
    createdAt,
    contentHash,
  };
}

function isValidISO(v) {
  if (typeof v !== 'string' || !v.trim()) return false;
  const ts = Date.parse(v);
  return Number.isFinite(ts);
}

export function loadSlots() {
  const raw = readSlots();
  const normalized = normalizeSlots(raw);
  writeSlots(normalized); // ensure shape stays consistent
  return normalized;
}

export function saveSlots(slots) {
  writeSlots(normalizeSlots(slots));
}

export function loadActiveSlotId() {
  try {
    const saved = Number(localStorage.getItem(ACTIVE_KEY));
    if (Number.isFinite(saved) && saved >= 1 && saved <= MAX_SLOTS) return saved;
  } catch {
    /* ignore */
  }
  return 1;
}

export function saveActiveSlotId(id) {
  try {
    localStorage.setItem(ACTIVE_KEY, String(clampId(id)));
  } catch {
    /* ignore */
  }
}

export function updateSlot(slots, id, updates) {
  const now = new Date().toISOString();
  const targetId = clampId(id);
  const next = slots.map((slot) => {
    if (slot.id !== targetId) return slot;
    const base = slot.createdAt ? slot.createdAt : now;
    return {
      ...slot,
      ...updates,
      createdAt: slot.createdAt || base,
      updatedAt: updates?.updatedAt || now,
      progress: clampProgress(updates?.progress ?? slot.progress ?? 0),
    };
  });
  writeSlots(next);
  return next;
}

export function resetSlot(slots, id) {
  const targetId = clampId(id);
  const next = slots.map((slot) => (slot.id === targetId ? defaultSlot(targetId) : slot));
  writeSlots(next);
  return next;
}

function clampId(id) {
  if (!Number.isFinite(id)) return 1;
  return Math.min(Math.max(Math.floor(id), 1), MAX_SLOTS);
}

function clampProgress(v) {
  const num = Number.isFinite(v) ? v : 0;
  return Math.min(Math.max(num, 0), 1);
}

export function loadProgressMap() {
  const raw = readProgress();
  const normalized = normalizeProgress(raw);
  writeProgress(normalized);
  return normalized;
}

export function saveProgressMap(map) {
  writeProgress(normalizeProgress(map));
}

export function loadBookmarksMap() {
  const raw = readBookmarks();
  const normalized = normalizeBookmarks(raw);
  writeBookmarks(normalized);
  return normalized;
}

export function saveBookmarksMap(map) {
  writeBookmarks(normalizeBookmarks(map));
}
