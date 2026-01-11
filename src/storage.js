const STORAGE_KEY = 'local-text-reader.slots.v1';
const ACTIVE_KEY = 'local-text-reader.activeSlot.v1';
export const MAX_SLOTS = 5;

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
