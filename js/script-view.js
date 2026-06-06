import { store } from './store.js';
import { $, el, toast, pickFile } from './util.js';
import { parseFile, textToLines } from './script-import.js';
import { openCueEditor } from './cue-editor.js';
import { openTextDialog } from './text-dialog.js';

const listEl = $('#scriptList');

// Words that usually mark a sound event in a Russian theater script.
const START_WORDS = /(фонограмм|минусовк|начина(ет|ется)|играет|звучит|вступ(ает|ление)|включа(ет|ется)|песня|саундтрек|музыка\s|оркестр|аплодисмент|звук|БДЫЩ)/i;
const STOP_WORDS = /(обрыва|затиха|заканчива|умолка|стоп|выключа|тишина|стихает|пауза\b)/i;

function cuesByLine() {
  const map = new Map();
  for (const c of store.show.cues) {
    if (c.anchorLine != null) {
      if (!map.has(c.anchorLine)) map.set(c.anchorLine, []);
      map.get(c.anchorLine).push(c);
    }
  }
  return map;
}

export function renderScript() {
  const script = store.show.script;
  if (!script.length) {
    listEl.innerHTML = '<div class="empty-state">No script loaded. Import the play\'s <b>.docx</b>, or paste the text. Then tap any line to make it a cue.</div>';
    return;
  }
  const byLine = cuesByLine();
  listEl.innerHTML = '';
  for (const ln of script) {
    const row = el('div', { class: 'script-line ' + ln.type, dataset: { i: ln.i } });
    row.append(el('span', { class: 'ln' }, String(ln.i + 1)));
    const tx = el('span', { class: 'tx' });
    tx.textContent = ln.text;
    const cues = byLine.get(ln.i);
    if (cues) {
      row.classList.add('has-cue');
      for (const c of cues) {
        tx.append(el('span', { class: 'cue-chip ' + c.action }, [chipIcon(c.action) + ' ' + c.name]));
      }
    }
    row.append(tx);
    row.addEventListener('click', () => {
      const existing = (byLine.get(ln.i) || [])[0];
      if (existing) openCueEditor(existing);
      else openCueEditor(null, { anchorLine: ln.i });
    });
    listEl.append(row);
  }
}

function chipIcon(a) { return a === 'start' ? '▶' : a === 'fade' ? '↘' : '◼'; }

async function importScriptFile() {
  const file = await pickFile('.docx,.txt,text/plain');
  if (!file) return;
  try {
    toast('Reading ' + file.name + '…');
    const lines = await parseFile(file);
    if (!lines.length) return toast('No text found in file', 'err');
    store.update(s => { s.script = lines; }, 'script');
    toast(`Loaded ${lines.length} lines`, 'ok');
  } catch (e) {
    console.error(e);
    toast('Import failed: ' + e.message, 'err');
  }
}

async function pasteScript() {
  const text = await openTextDialog({ title: 'Paste script text', multiline: true });
  if (text == null) return;
  const lines = textToLines(text);
  if (!lines.length) return toast('Nothing to import', 'err');
  store.update(s => { s.script = lines; }, 'script');
  toast(`Loaded ${lines.length} lines`, 'ok');
}

// Suggest cues by scanning the script. Adds non-duplicate suggestions.
export function autoDetectCues() {
  const script = store.show.script;
  if (!script.length) return toast('Load a script first', 'err');
  const existing = new Set(store.show.cues.filter(c => c.anchorLine != null).map(c => c.anchorLine));
  const found = [];
  for (const ln of script) {
    if (existing.has(ln.i)) continue;
    const t = ln.text;
    let action = null;
    if (STOP_WORDS.test(t) && !START_WORDS.test(t)) action = 'stop';
    else if (START_WORDS.test(t)) action = 'start';
    if (action) found.push({ line: ln.i, text: t, action });
  }
  if (!found.length) return toast('No new cue-like lines found', '');
  store.update(s => {
    for (const fnd of found) {
      s.cues.push({
        id: 'cue_' + Math.random().toString(36).slice(2, 9),
        name: suggestName(fnd.text, fnd.action),
        action: fnd.action,
        audioId: null,
        volume: 1, fadeMs: fnd.action === 'stop' ? 1500 : 0,
        loop: false, restart: true,
        anchorLine: fnd.line,
        trigger: fnd.text.slice(0, 80),
      });
    }
    s.cues.sort((a, b) => (a.anchorLine ?? 1e9) - (b.anchorLine ?? 1e9));
  }, 'cues');
  toast(`Added ${found.length} suggested cue${found.length > 1 ? 's' : ''} — assign audio in the Cues tab`, 'ok');
}

function suggestName(text, action) {
  const q = text.match(/[«"“]([^»"”]{2,40})[»"”]/);
  if (q) return (action === 'start' ? '▶ ' : '◼ ') + q[1];
  const t = text.replace(/\s+/g, ' ').trim();
  return (action === 'start' ? '▶ ' : '◼ ') + t.slice(0, 32);
}

export function initScriptView() {
  $('#importDocxBtn').addEventListener('click', importScriptFile);
  $('#pasteScriptBtn').addEventListener('click', pasteScript);
  store.onChange(reason => {
    if (['script', 'cues', 'init', 'show-switched'].includes(reason)) renderScript();
  });
}
