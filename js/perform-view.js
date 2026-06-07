import { store } from './store.js';
import { audio } from './audio.js';
import { voice } from './voice.js';
import { $, el, toast, fmtTime, matchScore, escapeHtml } from './util.js';

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
      tx.textContent = ln.text;
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

// ---- voice assist ----
function onVoice(res) {
  if (res.error) { voiceState.textContent = res.error; voiceToggle.checked = false; voiceState.textContent = 'mic denied'; return; }
  const heard = (res.final || res.interim || '').slice(-120);
  const c = nextCue();
  let armNow = false, matchedWord = '';
  if (c && c.trigger) {
    const score = matchScore(heard, c.trigger);
    if (score >= 0.55) { armNow = true; }
  }
  voiceHeard.innerHTML = heard ? `“${escapeHtml(heard)}”` : '';
  if (armNow && !armed) { armed = true; goBtn.classList.add('armed'); navigator.vibrate?.(40); }
}

function toggleVoice(on) {
  if (on) {
    if (!voice.supported()) { voiceToggle.checked = false; toast('Voice recognition not supported in this browser', 'err'); return; }
    voice.start(onVoice);
    voiceState.textContent = 'listening · needs internet · Android may chime';
  } else {
    voice.stop();
    voiceState.textContent = 'off';
    voiceHeard.textContent = '';
    armed = false; goBtn.classList.remove('armed');
  }
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
  audio.onChange(() => { if (active) renderRack(); });
  store.onChange(reason => {
    if (['cues', 'library', 'script'].includes(reason) && active) renderPerform();
    if (reason === 'show-switched') resetPlayhead();
  });
}
