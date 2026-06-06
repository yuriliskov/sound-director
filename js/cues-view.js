import { store } from './store.js';
import { audio } from './audio.js';
import { $, el, toast } from './util.js';
import { openCueEditor } from './cue-editor.js';
import { autoDetectCues } from './script-view.js';

const listEl = $('#cueList');

const ACTION_LABEL = { start: 'START', stop: 'STOP', fade: 'FADE', stopall: 'STOP ALL' };

export function renderCues() {
  const cues = store.show.cues;
  if (!cues.length) {
    listEl.innerHTML = '<div class="empty-state">No cues yet. Tag a line in the <b>Script</b> tab, or press <b>+ Add cue</b>. Use <b>✨ Auto-detect</b> to scan the script for likely sound moments.</div>';
    return;
  }
  listEl.innerHTML = '';
  cues.forEach((c, idx) => {
    const meta = c.audioId ? store.audioMetaById(c.audioId) : null;
    const line = c.anchorLine != null ? store.show.script[c.anchorLine] : null;
    const metaBits = [];
    if (c.action === 'start') {
      metaBits.push(meta ? '🎵 ' + meta.name : '⚠ no audio assigned');
      if (c.loop) metaBits.push('loop');
      if (c.fadeMs) metaBits.push('fade-in ' + (c.fadeMs / 1000).toFixed(1) + 's');
      if (c.volume < 1) metaBits.push(Math.round(c.volume * 100) + '%');
    } else if (c.action === 'stopall') {
      metaBits.push('stop everything' + (c.fadeMs ? ` · fade ${(c.fadeMs / 1000).toFixed(1)}s` : ''));
    } else {
      metaBits.push(meta ? '🎵 ' + meta.name : 'this cue\'s track');
      if (c.fadeMs) metaBits.push('fade ' + (c.fadeMs / 1000).toFixed(1) + 's');
    }
    if (line) metaBits.push('📜 line ' + (c.anchorLine + 1));

    const row = el('div', { class: 'cue-row' }, [
      el('div', { class: 'cue-no' }, String(idx + 1)),
      el('div', { class: 'cue-main' }, [
        el('div', { class: 'cue-title' }, [
          el('span', { class: 'cue-badge ' + c.action }, ACTION_LABEL[c.action]),
          el('span', {}, c.name),
        ]),
        el('div', { class: 'cue-meta' }, metaBits.join(' · ')),
      ]),
      el('div', { class: 'cue-actions' }, [
        el('button', { title: 'Test play', onclick: () => testCue(c) }, '▶'),
        el('button', { title: 'Move up', onclick: () => move(idx, -1) }, '↑'),
        el('button', { title: 'Move down', onclick: () => move(idx, 1) }, '↓'),
        el('button', { title: 'Edit', onclick: () => openCueEditor(c) }, '✏️'),
      ]),
    ]);
    listEl.append(row);
  });
}

function move(idx, dir) {
  const j = idx + dir;
  if (j < 0 || j >= store.show.cues.length) return;
  store.update(s => {
    const [c] = s.cues.splice(idx, 1);
    s.cues.splice(j, 0, c);
  }, 'cues');
}

function testCue(c) {
  if (c.action === 'stopall') { audio.stopAll(c.fadeMs); return toast('Stopped all'); }
  if (c.action === 'stop' || c.action === 'fade') {
    if (c.audioId) audio.stopByKey(c.audioId, c.fadeMs);
    else audio.stopAll(c.fadeMs);
    return toast('Stop fired');
  }
  if (!c.audioId) return toast('No audio assigned', 'err');
  audio.play({ audioId: c.audioId, name: c.name, volume: c.volume, loop: c.loop, fadeMs: c.fadeMs, restart: true, key: c.audioId });
  toast('Testing — ' + c.name);
}

export function initCuesView() {
  $('#addCueBtn').addEventListener('click', () => openCueEditor(null));
  $('#autoDetectBtn').addEventListener('click', autoDetectCues);
  store.onChange(reason => {
    if (['cues', 'library', 'init', 'show-switched', 'script'].includes(reason)) renderCues();
  });
}
