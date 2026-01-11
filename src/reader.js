const WORD_RE = /[A-Za-zÀ-ÖØ-öø-ÿ]+(?:'[A-Za-zÀ-ÖØ-öø-ÿ]+)?/g;

export function renderText(text, container) {
  if (!container) return;
  const trimmed = (text || '').trim();
  if (!trimmed) {
    container.innerHTML = `<div class="empty">尚未載入任何內容。請在左側貼上文章並儲存到某個書格。</div>`;
    return;
  }

  const lines = trimmed
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  const html = lines
    .map((line, idx) => `<div class="seg" data-i="${idx}">${wrapWords(line)}</div>`)
    .join('');

  container.innerHTML = html;
  bindWordToggles(container);
}

function wrapWords(line) {
  const out = [];
  let last = 0;
  let m;
  while ((m = WORD_RE.exec(line)) !== null) {
    if (m.index > last) {
      out.push(escapeHTML(line.slice(last, m.index)));
    }
    const tok = m[0];
    out.push(`<span class="word" data-w="${tok}">${tok}</span>`);
    last = WORD_RE.lastIndex;
  }
  if (last < line.length) {
    out.push(escapeHTML(line.slice(last)));
  }
  return out.join('');
}

function escapeHTML(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function bindWordToggles(container) {
  container.querySelectorAll('.word').forEach((el) => {
    el.addEventListener('click', () => {
      el.classList.toggle('marked');
    });
  });
}

export function getScrollProgress(el) {
  if (!el) return 0;
  const max = el.scrollHeight - el.clientHeight;
  if (max <= 0) return 0;
  return el.scrollTop / max;
}

export function applyScrollProgress(el, ratio) {
  if (!el) return;
  const clamped = Math.min(Math.max(Number(ratio) || 0, 0), 1);
  const max = el.scrollHeight - el.clientHeight;
  if (max <= 0) return;

  // 延後執行，等 DOM 高度算完
  requestAnimationFrame(() => {
    el.scrollTop = max * clamped;
  });
}
