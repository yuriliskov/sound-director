import { store } from './store.js';
import { db } from './db.js';
import { uid, toast, downloadBlob, pickFile } from './util.js';

const safe = (s) => (s || 'show').replace(/[^\w\-а-яё ]/gi, '').trim().replace(/\s+/g, '_').slice(0, 40) || 'show';

// ---- lightweight: show structure only (no audio data) ----
export function exportShowJson() {
  const s = store.show;
  const json = JSON.stringify({ ...s, _kind: 'sound-director-show', _v: 1 }, null, 2);
  downloadBlob(new Blob([json], { type: 'application/json' }), safe(s.name) + '.json');
  toast('Show exported (structure only — use full backup to include audio)', 'ok');
}

export async function importShowJson() {
  const file = await pickFile('.json,application/json');
  if (!file) return;
  try {
    const obj = JSON.parse(await file.text());
    if (!obj.cues && !obj.script) throw new Error('Not a show file');
    obj.id = uid('show');
    await store.replaceShow(obj);
    toast('Show imported. Re-link audio in the Audio tab if needed.', 'ok');
  } catch (e) { toast('Import failed: ' + e.message, 'err'); }
}

// ---- full backup: ZIP with show.json + every audio file ----
export async function exportBundle() {
  if (typeof JSZip === 'undefined') return toast('ZIP library unavailable', 'err');
  toast('Building backup…');
  const zip = new JSZip();
  const s = store.show;
  zip.file('show.json', JSON.stringify({ ...s, _kind: 'sound-director-show', _v: 1 }, null, 2));
  const audioDir = zip.folder('audio');
  for (const m of s.audioMeta) {
    const rec = await db.getAudio(m.id);
    if (rec && rec.blob) audioDir.file(m.id + extFor(rec), rec.blob);
  }
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  downloadBlob(blob, safe(s.name) + '_backup.zip');
  toast('Full backup saved', 'ok');
}

function extFor(rec) {
  const fromName = (rec.name || '').match(/\.[a-z0-9]+$/i);
  if (fromName) return fromName[0];
  const t = rec.type || '';
  if (t.includes('mpeg') || t.includes('mp3')) return '.mp3';
  if (t.includes('wav')) return '.wav';
  if (t.includes('ogg')) return '.ogg';
  return '.bin';
}

export async function importBundle() {
  if (typeof JSZip === 'undefined') return toast('ZIP library unavailable', 'err');
  const file = await pickFile('.zip,application/zip');
  if (!file) return;
  try {
    toast('Restoring backup…');
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const showFile = zip.file('show.json');
    if (!showFile) throw new Error('No show.json in zip');
    const obj = JSON.parse(await showFile.async('string'));
    obj.id = uid('show');

    // restore audio blobs keyed by their original id (filename without ext)
    const audioFiles = zip.folder('audio');
    if (audioFiles) {
      const entries = [];
      zip.forEach((path, f) => { if (path.startsWith('audio/') && !f.dir) entries.push(f); });
      for (const f of entries) {
        const base = f.name.replace(/^audio\//, '').replace(/\.[^.]+$/, '');
        const blob = await f.async('blob');
        const type = guessType(f.name);
        await db.putAudio({ id: base, name: base, type, size: blob.size, blob: new Blob([blob], { type }) });
      }
    }
    await store.replaceShow(obj);
    toast('Backup restored — audio included', 'ok');
  } catch (e) { console.error(e); toast('Restore failed: ' + e.message, 'err'); }
}

function guessType(name) {
  const e = (name.match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase();
  return { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac' }[e] || 'audio/mpeg';
}
