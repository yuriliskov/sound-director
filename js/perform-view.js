import { store } from './store.js';
import { audio } from './audio.js';
import { voice } from './voice.js';
import { $, el, toast, fmtTime, tokens, normalize } from './util.js';

const scriptEl = $('#performScript');
const npList = $('#npList');
const goBtn = $('#goBtn');
const nextTitle = $('#nextCueTitle');
const nextSub = $('#nextCueSub');
const voiceToggle = $('#voiceToggle');
const voiceState = $('#voiceState');
const voiceHeard = $('#voiceHeard');

let pos = 0;            // index of NEXT cue to fire
let armed = false;     // voice thinks the next cue is due
let active = false;    // perform view currently visible
let rafId = null;
const rackRows = new Map(); // playerId -> { row, range, time, playBtn }
const seeking = new Set();  // playerIds currently being dragged

// ---- voice "teleprompter" follow state ----
let followTokens = [];      // [{ line, w, norm }] spoken words in script order
let tokenCursor = 0;        // how far through the script we've heard
let speakingLineIdx = -1;   // line currently being spoken (DOM data-i)
let followMisses = 0;       // consecutive recognitions with no forward match
const FOLLOW_WINDOW = 45;   // how far ahead we look for the next spoken word

function nextCue() { return store.show.cues[pos] || null; }

// ---- firing ----
function executeCue(c) {
  switch (c.action) {
    case 'start':
      if (!c.audioId) { toast('Cue "' + c.name + '" has no audio', 'err'); return; }
      audio.play({ audioId: c.audioId, name: c.name, volume: c.volume, loop: c.loop, fadeMs: c.fadeMs, restart: c.restart, key: c.audioId });
      break;
    case 'stop':
    case 'fade':
      if (c.audioId) audio.stopByKey(c.audioId, c.fadeMs);
      else audio.stopAll(c.fadeMs);
      break;
    case 'stopall':
      audio.stopAll(c.fadeMs);
      break;
  }
}

function fireNext() {
  audio.unlock();
  const c = nextCue();
  if (!c) { toast('End of cue list'); return; }
  executeCue(c);
  pos++;
  armed = false;
  goBtn.classList.remove('armed');
  renderPlayhead();
  scrollToNextAnchor();
}

function skip() { if (pos < store.show.cues.length) { pos++; armed = false; goBtn.classList.remove('armed'); renderPlayhead(); scrollToNextAnchor(); } }
function prev() { if (pos > 0) { pos--; armed = false; renderPlayhead(); scrollToNextAnchor(); } }

// ---- rendering ----
export function renderPerform() {
  const cues = store.show.cues;
  const script = store.show.script;
  if (!cues.length) {
    scriptEl.innerHTML = '<div class="empty-state">No cues yet. Go to <b>Script</b> → import text, then <b>Cues</b> → tag start/stop points.</div>';
    goBtn.disabled = true;
    nextTitle.textContent = '—';
    nextSub.textContent = '';
    return;
  }
  // Build the script with cue anchors; if no script lines, show cue list itself.
  const cueByLine = new Map();
  cues.forEach((c, i) => { if (c.anchorLine != null) (cueByLine.get(c.anchorLine) || cueByLine.set(c.anchorLine, []).get(c.anchorLine)).push({ c, i }); });

  if (script.length) {
    scriptEl.innerHTML = '';
    for (const ln of script) {
      const row = el('div', { class: 'script-line ' + ln.type, dataset: { i: ln.i } });
      row.append(el('span', { class: 'ln' }, String(ln.i + 1)));
      const tx = el('span', { class: 'tx' });
      tx.append(el('span', { class: 'txt' }, ln.text)); // word-highlight target
      const here = cueByLine.get(ln.i);
      if (here) for (const { c } of here) tx.append(el('span', { class: 'cue-chip ' + c.action }, [(c.action === 'start' ? '▶' : c.action === 'fade' ? '↘' : '◼') + ' ' + c.name]));
      row.append(tx);
      scriptEl.append(row);
    }
  } else {
    // No script imported — show the bare cue sequence as the "playbook".
    scriptEl.innerHTML = '';
    cues.forEach((c, i) => {
      scriptEl.append(el('div', { class: 'script-line', dataset: { cue: i } }, [
        el('span', { class: 'ln' }, String(i + 1)),
        el('span', { class: 'tx' }, [el('span', { class: 'cue-chip ' + c.action }, c.name)]),
      ]));
    });
  }
  renderPlayhead();
  scrollToNextAnchor();
  if (voice.isRunning()) { buildFollowModel(); speakingLineIdx = -1; applyHighlight(); }
}

function renderPlayhead() {
  const cues = store.show.cues;
  goBtn.disabled = pos >= cues.length;
  const c = nextCue();
  if (c) {
    const meta = c.audioId ? store.audioMetaById(c.audioId) : null;
    nextTitle.textContent = `${pos + 1}. ${c.name}`;
    const verb = c.action === 'start' ? 'START' : c.action === 'stopall' ? 'STOP ALL' : c.action.toUpperCase();
    nextSub.textContent = verb + (meta ? ' · ' + meta.name : '') + ` · cue ${pos + 1} of ${cues.length}`;
  } else {
    nextTitle.textContent = '✓ End of show';
    nextSub.textContent = `${cues.length} cues fired`;
  }
  // highlight anchors
  for (const row of scriptEl.children) {
    row.classList.remove('next-anchor', 'fired');
    const i = row.dataset.i != null ? +row.dataset.i : null;
    const cueIdx = row.dataset.cue != null ? +row.dataset.cue : null;
    if (cueIdx != null) { if (cueIdx < pos) row.classList.add('fired'); if (cueIdx === pos) row.classList.add('next-anchor'); }
  }
  if (c && c.anchorLine != null) {
    const row = scriptEl.querySelector(`[data-i="${c.anchorLine}"]`);
    if (row) row.classList.add('next-anchor');
  }
}

function scrollToNextAnchor() {
  const c = nextCue();
  let row = null;
  if (c && c.anchorLine != null) row = scriptEl.querySelector(`[data-i="${c.anchorLine}"]`);
  else row = scriptEl.querySelector(`[data-cue="${pos}"]`);
  if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ---- now playing rack (live) ----
function buildRackRow(p) {
  const time = el('span', { class: 'npt-time' }, '0:00');
  const playBtn = el('button', { class: 'npt-play', title: 'Pause / resume' }, '⏸');
  const stopBtn = el('button', { class: 'npt-stop', title: 'Fade & stop' }, '◼');
  const range = el('input', { type: 'range', class: 'npt-seek', min: '0', max: '1000', value: '0', step: '1' });

  playBtn.addEventListener('click', () => audio.togglePause(p.id));
  stopBtn.addEventListener('click', () => audio.stop(p.id, 800));

  const startSeek = () => seeking.add(p.id);
  const liveLabel = () => {
    const pl = audio.players.get(p.id); const d = pl ? (pl.elem.duration || 0) : 0;
    time.textContent = fmtTime(d * range.value / 1000) + (d ? ' / ' + fmtTime(d) : '');
  };
  const commitSeek = () => { audio.seek(p.id, range.value / 1000); seeking.delete(p.id); };
  range.addEventListener('pointerdown', startSeek);
  range.addEventListener('touchstart', startSeek, { passive: true });
  range.addEventListener('input', liveLabel);
  range.addEventListener('change', commitSeek);
  range.addEventListener('pointerup', commitSeek);
  range.addEventListener('pointercancel', () => seeking.delete(p.id));

  const row = el('div', { class: 'np-track' + (p.loop ? ' loop' : ''), dataset: { pid: p.id } }, [
    el('div', { class: 'npt-top' }, [
      el('span', { class: 'npt-name' }, (p.loop ? '🔁 ' : '🎵 ') + p.name),
      time, playBtn, stopBtn,
    ]),
    range,
  ]);
  return { row, range, time, playBtn };
}

function renderRack() {
  const ids = new Set(audio.players.keys());
  // remove rows for finished players
  for (const [pid, ref] of rackRows) if (!ids.has(pid)) { ref.row.remove(); rackRows.delete(pid); seeking.delete(pid); }
  if (audio.players.size === 0) { npList.innerHTML = '<div class="np-empty">silence</div>'; rackRows.clear(); return; }
  const empty = npList.querySelector('.np-empty'); if (empty) empty.remove();
  // add rows for new players
  for (const p of audio.players.values()) {
    if (rackRows.has(p.id)) continue;
    const ref = buildRackRow(p);
    rackRows.set(p.id, ref);
    npList.append(ref.row);
  }
  updateRack();
}

function updateRack() {
  for (const p of audio.players.values()) {
    const ref = rackRows.get(p.id);
    if (!ref) continue;
    const d = p.elem.duration || 0, cur = p.elem.currentTime || 0;
    if (!seeking.has(p.id)) {
      ref.range.value = d ? Math.min(1000, cur / d * 1000) : 0;
      ref.time.textContent = fmtTime(cur) + (d ? ' / ' + fmtTime(d) : '');
    }
    const paused = p.elem.paused;
    ref.playBtn.textContent = paused ? '▶' : '⏸';
    ref.row.classList.toggle('paused', paused);
  }
}

function tick() {
  if (rackRows.size !== audio.players.size) renderRack();
  else updateRack();
  if (active) rafId = requestAnimationFrame(tick);
}

// ---- voice "teleprompter" follow ----
// Voice assist no longer arms or fires anything — it just highlights the words in
// the script as they're recognized, so the operator can see the position. GO stays
// fully manual.

const splitWords = (text) => text.split(/(\s+)/); // [word, space, word, space, ...]

function buildFollowModel() {
  followTokens = [];
  for (const ln of store.show.script) {
    if (ln.type === 'scene' || ln.type === 'stage') continue; // not spoken aloud
    let w = -1;
    for (const part of splitWords(ln.text)) {
      if (/^\s+$/.test(part) || part === '') continue;
      w++;
      followTokens.push({ line: ln.i, w, norm: normalize(part) });
    }
  }
}

function seedCursorToPlayhead() {
  const anchor = nextCue() ? nextCue().anchorLine : null;
  if (anchor == null) { tokenCursor = 0; return; }
  const idx = followTokens.findIndex(t => t.line >= anchor);
  tokenCursor = idx < 0 ? 0 : idx;
}

function globalFind(toks) {
  if (toks.length < 2) return -1;
  const a = toks[toks.length - 2], b = toks[toks.length - 1];
  for (let j = 1; j < followTokens.length; j++) {
    if (followTokens[j].norm === b && followTokens[j - 1].norm === a) return j;
  }
  return -1;
}

function onVoice(res) {
  if (res.error) { voiceToggle.checked = false; voiceState.textContent = 'mic denied'; toggleVoice(false); return; }
  const recog = tokens(res.final || res.interim || '').slice(-6);
  if (!recog.length) return;

  let advanced = false;
  for (const rt of recog) {
    const end = Math.min(followTokens.length, tokenCursor + FOLLOW_WINDOW);
    for (let j = tokenCursor; j < end; j++) {
      if (followTokens[j].norm === rt) { tokenCursor = j + 1; advanced = true; break; }
    }
  }
  if (advanced) { followMisses = 0; }
  else if (++followMisses >= 6) {            // lost the place — try to resync anywhere
    const j = globalFind(recog);
    if (j >= 0) { tokenCursor = j + 1; advanced = true; followMisses = 0; }
  }
  if (advanced) applyHighlight();
}

// Derive the highlight purely from tokenCursor so it survives re-renders.
function applyHighlight() {
  if (!followTokens.length || tokenCursor <= 0) return;
  const cur = followTokens[Math.min(tokenCursor, followTokens.length) - 1];
  const line = cur.line, wordIdx = cur.w;

  if (line !== speakingLineIdx) {
    // unwrap the previous speaking line back to plain text
    const prev = scriptEl.querySelector('.script-line.speaking');
    if (prev) { const t = prev.querySelector('.txt'); if (t) t.textContent = store.show.script[+prev.dataset.i].text; }
    // sweep line classes
    for (const row of scriptEl.children) {
      const i = row.dataset.i != null ? +row.dataset.i : null;
      if (i == null) continue;
      row.classList.toggle('spoken', i < line);
      row.classList.toggle('speaking', i === line);
    }
    speakingLineIdx = line;
    wrapSpeakingWords(line);
    const row = scriptEl.querySelector(`.script-line[data-i="${line}"]`);
    if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  // light up words up to the current one on the speaking line
  const row = scriptEl.querySelector(`.script-line[data-i="${line}"] .txt`);
  if (row) row.querySelectorAll('.w').forEach(s => s.classList.toggle('on', +s.dataset.w <= wordIdx));
}

function wrapSpeakingWords(lineI) {
  const txt = scriptEl.querySelector(`.script-line[data-i="${lineI}"] .txt`);
  if (!txt) return;
  const text = store.show.script[lineI].text;
  txt.textContent = '';
  let w = -1;
  for (const part of splitWords(text)) {
    if (part === '') continue;
    if (/^\s+$/.test(part)) { txt.append(part); continue; }
    w++;
    txt.append(el('span', { class: 'w', dataset: { w } }, part));
  }
}

function clearFollow() {
  if (speakingLineIdx >= 0 && store.show.script[speakingLineIdx]) {
    const t = scriptEl.querySelector(`.script-line[data-i="${speakingLineIdx}"] .txt`);
    if (t) t.textContent = store.show.script[speakingLineIdx].text;
  }
  for (const row of scriptEl.children) row.classList.remove('spoken', 'speaking');
  speakingLineIdx = -1; tokenCursor = 0; followMisses = 0;
}

function toggleVoice(on) {
  if (on) {
    if (!voice.supported()) { voiceToggle.checked = false; toast('Voice recognition not supported in this browser', 'err'); return; }
    if (!store.show.script.length) { voiceToggle.checked = false; toast('Import a script first — follow needs the text', 'err'); return; }
    buildFollowModel();
    seedCursorToPlayhead();
    voice.start(onVoice);
    voiceState.textContent = 'following the script · needs internet';
  } else {
    voice.stop();
    voiceState.textContent = 'off';
    clearFollow();
  }
  voiceHeard.hidden = true; // recognized-text line replaced by in-script highlight
}

// ---- lifecycle ----
export function setPerformActive(on) {
  active = on;
  if (on) {
    renderPerform();
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(tick);
  } else {
    cancelAnimationFrame(rafId);
  }
}

export function resetPlayhead() { pos = 0; armed = false; goBtn.classList.remove('armed'); if (active) { renderPlayhead(); scrollToNextAnchor(); } }

export function initPerformView() {
  goBtn.addEventListener('click', fireNext);
  $('#nextCueBtn').addEventListener('click', skip);
  $('#prevCueBtn').addEventListener('click', prev);
  $('#panicBtn').addEventListener('click', () => { audio.stopAll(600); toast('All stopped'); });
  voiceToggle.addEventListener('change', () => toggleVoice(voiceToggle.checked));
  voiceState.textContent = voice.supported() ? 'off' : 'unavailable';
  voiceHeard.hidden = true;
  audio.onChange(() => { if (active) renderRack(); });
  store.onChange(reason => {
    if (['cues', 'library', 'script'].includes(reason) && active) renderPerform();
    if (reason === 'show-switched') resetPlayhead();
  });
}
