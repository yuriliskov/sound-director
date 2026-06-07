import { store } from './store.js';
import { db } from './db.js';
import { audio } from './audio.js';
import { $, $$, el, uid, toast, fmtTime, fmtBytes, pickFile } from './util.js';
import { openTextDialog } from './text-dialog.js';

const listEl = $('#libList');
const PREVIEW_KEY = '__preview__';

export async function addAudioFiles(files) {
  files = Array.from(files || []).filter(Boolean);
  if (!files.length) return;
  toast(`Adding ${files.length} file${files.length > 1 ? 's' : ''}…`);
  let added = 0;
  for (const file of files) {
    // Only skip things that are *clearly* not audio (a known non-audio extension).
    // Android often gives an empty MIME type, so we must NOT require a match.
    if (/\.(txt|pdf|docx?|jpe?g|png|gif|zip|json|mp4|mov|avi)$/i.test(file.name || '')) {
      toast('Skipped (not audio): ' + file.name, 'err');
      continue;
    }
    try {
      const id = uid('aud');
      let duration = 0;
      try { duration = await audio.probeDuration(file); } catch {}
      await db.putAudio({ id, name: file.name || 'audio', type: file.type || 'audio', size: file.size || 0, blob: file });
      store.update(s => {
        s.audioMeta.push({ id, name: (file.name || 'audio').replace(/\.[^.]+$/, ''), type: file.type, size: file.size || 0, duration });
      }, 'library');
      added++;
    } catch (e) {
      console.error('add audio failed', e);
      toast('Could not add ' + (file.name || 'file') + ': ' + (e && e.message ? e.message : e), 'err');
    }
  }
  if (added) toast(`Added ${added} file${added > 1 ? 's' : ''}`, 'ok');
}

function previewPlayer() {
  for (const p of audio.players.values()) if (p.key === PREVIEW_KEY) return p;
  return null;
}

let previewRaf = null;
let previewSeeking = false;

function previewTick() {
  const pp = previewPlayer();
  const row = listEl.querySelector('.lib-item.previewing');
  if (pp && row && !previewSeeking) {
    const range = row.querySelector('.lib-seek');
    const time = row.querySelector('.lib-ptime');
    const d = pp.elem.duration || 0, cur = pp.elem.currentTime || 0;
    if (range) range.value = d ? Math.min(1000, cur / d * 1000) : 0;
    if (time) time.textContent = fmtTime(cur) + (d ? ' / ' + fmtTime(d) : '');
  }
  previewRaf = pp ? requestAnimationFrame(previewTick) : null;
}
function ensurePreviewTick() { if (!previewRaf && previewPlayer()) previewRaf = requestAnimationFrame(previewTick); }

function previewToggle(meta) {
  const pp = previewPlayer();
  if (pp && pp.audioId === meta.id) { audio.togglePause(pp.id); return; }
  if (pp) audio.stop(pp.id, 0);
  audio.play({ audioId: meta.id, name: meta.name, volume: 1, loop: false, restart: true, key: PREVIEW_KEY });
  ensurePreviewTick();
}

export function renderLibrary() {
  const metas = store.show.audioMeta;
  if (!metas.length) {
    listEl.innerHTML = '<div class="empty-state">No audio yet. Add your backing tracks (минусовки) and sound effects.<br>Supported: mp3, wav, m4a, ogg, aac, flac.</div>';
    return;
  }
  const pp = previewPlayer();
  listEl.innerHTML = '';
  for (const m of metas) {
    const usedBy = store.show.cues.filter(c => c.audioId === m.id).length;
    const isPrev = pp && pp.audioId === m.id;
    const paused = isPrev && pp.elem.paused;
    const playBtn = el('button', { class: 'play' + (isPrev && !paused ? ' playing' : ''), title: 'Preview' }, isPrev ? (paused ? '▶' : '⏸') : '▶');
    playBtn.addEventListener('click', () => previewToggle(m));

    const main = el('div', { class: 'lib-main' }, [
      el('div', { class: 'lib-name' }, m.name),
      el('div', { class: 'lib-meta' }, [
        fmtTime(m.duration || 0) + ' · ' + fmtBytes(m.size || 0) +
        (usedBy ? ` · used in ${usedBy} cue${usedBy > 1 ? 's' : ''}` : ' · not used'),
      ]),
    ]);

    if (isPrev) {
      const time = el('span', { class: 'lib-ptime' }, '0:00');
      const range = el('input', { type: 'range', class: 'lib-seek', min: '0', max: '1000', value: '0', step: '1' });
      range.addEventListener('pointerdown', () => { previewSeeking = true; });
      range.addEventListener('touchstart', () => { previewSeeking = true; }, { passive: true });
      range.addEventListener('input', () => { const d = pp.elem.duration || 0; time.textContent = fmtTime(d * range.value / 1000) + (d ? ' / ' + fmtTime(d) : ''); });
      range.addEventListener('change', () => { audio.seek(pp.id, range.value / 1000); previewSeeking = false; });
      range.addEventListener('pointerup', () => { audio.seek(pp.id, range.value / 1000); previewSeeking = false; });
      range.addEventListener('pointercancel', () => { previewSeeking = false; });
      main.append(el('div', { class: 'lib-transport' }, [
        time, range,
        el('button', { class: 'lib-pstop', title: 'Stop preview', onclick: () => audio.stop(pp.id, 0) }, '◼'),
      ]));
    }

    listEl.append(el('div', { class: 'lib-item' + (isPrev ? ' previewing' : '') }, [
      playBtn, main,
      el('div', { class: 'lib-actions' }, [
        el('button', { title: 'Rename', onclick: () => renameAudio(m) }, '✏️'),
        el('button', { title: 'Delete', onclick: () => deleteAudio(m) }, '🗑'),
      ]),
    ]));
  }
  ensurePreviewTick();
}

async function renameAudio(m) {
  const name = await openTextDialog({ title: 'Rename audio', multiline: false, value: m.name });
  if (name == null || !name.trim()) return;
  store.update(s => { const a = s.audioMeta.find(x => x.id === m.id); if (a) a.name = name.trim(); }, 'library');
}

async function deleteAudio(m) {
  const usedBy = store.show.cues.filter(c => c.audioId === m.id);
  const msg = usedBy.length
    ? `Delete "${m.name}"? It is used by ${usedBy.length} cue(s); they will lose their audio.`
    : `Delete "${m.name}"?`;
  if (!confirm(msg)) return;
  audio.stopByKey(PREVIEW_KEY, 0);
  await db.deleteAudio(m.id);
  audio.forget(m.id);
  store.update(s => {
    s.audioMeta = s.audioMeta.filter(x => x.id !== m.id);
    s.cues.forEach(c => { if (c.audioId === m.id) c.audioId = null; });
  }, 'library');
  toast('Deleted');
}

export function initLibraryView() {
  $('#addAudioBtn').addEventListener('click', async () => {
    const files = await pickFile('audio/*,.mp3,.wav,.m4a,.ogg,.aac,.flac', true);
    if (files && files.length) addAudioFiles(files);
  });
  // Re-render the list on playback changes (play/pause/stop) only while the
  // Audio tab is visible, so the preview transport stays in sync without churn.
  audio.onChange(() => {
    const view = document.querySelector('.view[data-view="library"]');
    if (view && !view.hidden) renderLibrary();
  });
  store.onChange(reason => {
    if (['library', 'cues', 'init', 'show-switched'].includes(reason)) renderLibrary();
  });
}
