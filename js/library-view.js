import { store } from './store.js';
import { db } from './db.js';
import { audio } from './audio.js';
import { $, $$, el, uid, toast, fmtTime, fmtBytes, pickFile } from './util.js';
import { openTextDialog } from './text-dialog.js';

const listEl = $('#libList');
const PREVIEW_KEY = '__preview__';

export async function addAudioFiles(files) {
  let added = 0;
  for (const file of files) {
    if (!/audio|mp3|wav|m4a|ogg|aac|flac/i.test(file.type + ' ' + file.name)) {
      toast('Skipped (not audio): ' + file.name, 'err');
      continue;
    }
    const id = uid('aud');
    const duration = await audio.probeDuration(file);
    await db.putAudio({ id, name: file.name, type: file.type || 'audio', size: file.size, blob: file });
    store.update(s => {
      s.audioMeta.push({ id, name: file.name.replace(/\.[^.]+$/, ''), type: file.type, size: file.size, duration });
    }, 'library');
    added++;
  }
  if (added) toast(`Added ${added} file${added > 1 ? 's' : ''}`, 'ok');
}

function previewToggle(meta, btn) {
  if (audio.isPlayingKey(PREVIEW_KEY)) {
    audio.stopByKey(PREVIEW_KEY, 0);
    return;
  }
  audio.play({ audioId: meta.id, name: meta.name, volume: 1, loop: false, restart: true, key: PREVIEW_KEY });
}

export function renderLibrary() {
  const metas = store.show.audioMeta;
  if (!metas.length) {
    listEl.innerHTML = '<div class="empty-state">No audio yet. Add your backing tracks (минусовки) and sound effects.<br>Supported: mp3, wav, m4a, ogg, aac, flac.</div>';
    return;
  }
  listEl.innerHTML = '';
  for (const m of metas) {
    const usedBy = store.show.cues.filter(c => c.audioId === m.id).length;
    const playBtn = el('button', { class: 'play', title: 'Preview' }, '▶');
    const item = el('div', { class: 'lib-item' }, [
      playBtn,
      el('div', { class: 'lib-main' }, [
        el('div', { class: 'lib-name' }, m.name),
        el('div', { class: 'lib-meta' }, [
          fmtTime(m.duration || 0) + ' · ' + fmtBytes(m.size || 0) +
          (usedBy ? ` · used in ${usedBy} cue${usedBy > 1 ? 's' : ''}` : ' · not used'),
        ]),
      ]),
      el('div', { class: 'lib-actions' }, [
        el('button', { title: 'Rename', onclick: () => renameAudio(m) }, '✏️'),
        el('button', { title: 'Delete', onclick: () => deleteAudio(m) }, '🗑'),
      ]),
    ]);
    playBtn.addEventListener('click', () => previewToggle(m, playBtn));
    listEl.append(item);
  }
  reflectPlaying();
}

function reflectPlaying() {
  const playing = audio.isPlayingKey(PREVIEW_KEY);
  $$('.lib-item .play', listEl).forEach(b => {
    b.classList.toggle('playing', playing);
    b.textContent = playing ? '◼' : '▶';
  });
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
  audio.onChange(reflectPlaying);
  store.onChange(reason => {
    if (['library', 'cues', 'init', 'show-switched'].includes(reason)) renderLibrary();
  });
}
