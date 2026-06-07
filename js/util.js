export const uid = (p = 'id') => p + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function el(tag, props = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    n.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return n;
}

let toastTimer;
export function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (kind ? ' ' + kind : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

export function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return m + ':' + String(s).padStart(2, '0');
}

export function fmtBytes(b) {
  if (!b) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  return (b / Math.pow(1024, i)).toFixed(i ? 1 : 0) + ' ' + u[i];
}

// Normalize Russian/any text for fuzzy voice matching: lowercase, ё->е, strip punctuation.
export function normalize(s) {
  return (s || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokens(s) {
  return normalize(s).split(' ').filter(w => w.length > 1);
}

// How well does spoken text match a trigger phrase? Returns 0..1 (fraction of
// trigger words found in the spoken window).
export function matchScore(spoken, trigger) {
  const tw = tokens(trigger);
  if (!tw.length) return 0;
  const sset = new Set(tokens(spoken));
  let hit = 0;
  for (const w of tw) if (sset.has(w)) hit++;
  return hit / tw.length;
}

export async function downloadBlob(blob, filename) {
  // On phones a programmatic <a download> often does nothing, so prefer the
  // native share sheet (lets the user save to Files / Drive / etc.).
  try {
    if (navigator.canShare) {
      const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
        return true;
      }
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return false; // user cancelled the share
    // otherwise fall through to the anchor download
  }
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename, rel: 'noopener', target: '_blank' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return true;
}

// Robust file picker. Uses an off-screen (NOT display:none) input — some mobile
// browsers, notably Samsung Internet, won't open/return from a hidden input that
// is clicked programmatically. Resolves null if the user cancels.
export function pickFile(accept, multiple = false) {
  return new Promise((resolve) => {
    const input = el('input', {
      type: 'file', accept, multiple,
      style: 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;z-index:-1;pointer-events:none',
    });
    let settled = false;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('focus', onFocus);
      setTimeout(() => input.remove(), 0);
      resolve(val);
    };
    const onFocus = () => {
      // Window regained focus: if no file was chosen shortly after, treat as cancel.
      setTimeout(() => { if (!input.files || !input.files.length) finish(null); }, 1200);
    };
    input.addEventListener('change', () => finish(multiple ? Array.from(input.files) : (input.files[0] || null)), { once: true });
    window.addEventListener('focus', onFocus, { once: true });
    document.body.append(input);
    input.click();
  });
}

export function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
