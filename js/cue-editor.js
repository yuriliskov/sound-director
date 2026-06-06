import { store } from './store.js';
import { $, el, uid, toast } from './util.js';

const dlg = $('#cueDialog');
const f = {
  title: $('#cueDialogTitle'), name: $('#cueName'), action: $('#cueAction'),
  audioFld: $('#audioFld'), audio: $('#cueAudio'),
  volume: $('#cueVolume'), volOut: $('#volOut'),
  fade: $('#cueFade'), fadeOut: $('#fadeOut'),
  loop: $('#cueLoop'), restart: $('#cueRestart'),
  anchorBox: $('#cueAnchorBox'), trigger: $('#cueTrigger'),
  del: $('#cueDeleteBtn'), cancel: $('#cueCancelBtn'), form: $('#cueForm'),
};

let editingId = null;       // null => creating
let pendingAnchor = null;   // line index when creating from script

function fadeMsFromSlider(v) { return Math.round(v / 100 * 8000); }       // 0..8s
function fadeSliderFromMs(ms) { return Math.round((ms || 0) / 8000 * 100); }

function refreshAudioOptions(selectedId) {
  f.audio.innerHTML = '';
  const metas = store.show.audioMeta;
  if (!metas.length) {
    f.audio.append(el('option', { value: '' }, '— no audio in library —'));
  } else {
    f.audio.append(el('option', { value: '' }, '— choose file —'));
    for (const m of metas) f.audio.append(el('option', { value: m.id }, m.name));
  }
  f.audio.value = selectedId || '';
}

function syncActionUI() {
  const a = f.action.value;
  // STOP-ALL needs no specific file; STOP/FADE optionally target a file.
  f.audioFld.style.display = (a === 'stopall') ? 'none' : '';
  const isStart = a === 'start';
  f.loop.closest('.fld-row').style.display = isStart ? '' : 'none';
}

f.action.addEventListener('change', syncActionUI);
f.volume.addEventListener('input', () => { f.volOut.textContent = f.volume.value + '%'; });
f.fade.addEventListener('input', () => { f.fadeOut.textContent = (fadeMsFromSlider(f.fade.value) / 1000).toFixed(1) + 's'; });

f.cancel.addEventListener('click', () => dlg.close());
f.del.addEventListener('click', () => {
  if (!editingId) return dlg.close();
  store.update(s => { s.cues = s.cues.filter(c => c.id !== editingId); }, 'cues');
  toast('Cue deleted');
  dlg.close();
});

f.form.addEventListener('submit', (e) => {
  e.preventDefault();
  const data = {
    name: f.name.value.trim() || 'Cue',
    action: f.action.value,
    audioId: f.audioFld.style.display === 'none' ? null : (f.audio.value || null),
    volume: +f.volume.value / 100,
    fadeMs: fadeMsFromSlider(f.fade.value),
    loop: f.loop.checked,
    restart: f.restart.checked,
    trigger: f.trigger.value.trim(),
  };
  if (data.action === 'start' && !data.audioId) {
    toast('Pick an audio file for a START cue', 'err');
    return;
  }
  store.update(s => {
    if (editingId) {
      const c = s.cues.find(x => x.id === editingId);
      Object.assign(c, data);
    } else {
      const c = { id: uid('cue'), anchorLine: pendingAnchor, ...data };
      // insert near the anchor so cue order follows the script
      if (pendingAnchor != null) {
        let idx = s.cues.findIndex(x => x.anchorLine != null && x.anchorLine > pendingAnchor);
        if (idx < 0) idx = s.cues.length;
        s.cues.splice(idx, 0, c);
      } else {
        s.cues.push(c);
      }
    }
  }, 'cues');
  toast(editingId ? 'Cue saved' : 'Cue added', 'ok');
  dlg.close();
});

// Open editor. opts: { anchorLine } when creating from a script line.
export function openCueEditor(cue = null, opts = {}) {
  editingId = cue ? cue.id : null;
  pendingAnchor = cue ? cue.anchorLine : (opts.anchorLine ?? null);

  f.title.textContent = cue ? 'Edit cue' : 'New cue';
  f.del.style.display = cue ? '' : 'none';

  const anchorIdx = cue ? cue.anchorLine : pendingAnchor;
  const line = (anchorIdx != null) ? store.show.script[anchorIdx] : null;

  f.name.value = cue ? cue.name : '';
  f.action.value = cue ? cue.action : 'start';
  refreshAudioOptions(cue ? cue.audioId : '');
  f.volume.value = cue ? Math.round((cue.volume ?? 1) * 100) : 100;
  f.volOut.textContent = f.volume.value + '%';
  f.fade.value = cue ? fadeSliderFromMs(cue.fadeMs) : 0;
  f.fadeOut.textContent = (fadeMsFromSlider(f.fade.value) / 1000).toFixed(1) + 's';
  f.loop.checked = cue ? cue.loop : false;
  f.restart.checked = cue ? cue.restart : true;
  f.trigger.value = cue ? (cue.trigger || '') : (line ? line.text.slice(0, 80) : '');
  f.anchorBox.textContent = line ? `Line ${anchorIdx + 1}: ${line.text.slice(0, 120)}` : '— not anchored to a line —';

  syncActionUI();
  dlg.showModal();
  setTimeout(() => f.name.focus(), 50);
}
