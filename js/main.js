import { store } from './store.js';
import { db } from './db.js';
import { $, $$, toast, fmtBytes } from './util.js';
import { openTextDialog } from './text-dialog.js';
import { initScriptView } from './script-view.js';
import { initLibraryView, addAudioFiles } from './library-view.js';
import { initCuesView } from './cues-view.js';
import { initPerformView, setPerformActive, resetPlayhead } from './perform-view.js';
import { exportShowJson, importShowJson, exportBundle, importBundle } from './show-io.js';

const APP_VERSION = 'v1.1.0';
let installPrompt = null;

// ---------- navigation ----------
function showView(name) {
  $$('.view').forEach(v => { v.hidden = v.dataset.view !== name; });
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === name));
  setPerformActive(name === 'perform');
  localStorage.setItem('sd.lastView', name);
}

function initNav() {
  $('#tabs').addEventListener('click', e => {
    const tab = e.target.closest('.tab');
    if (tab) showView(tab.dataset.view);
  });
}

// ---------- menu sheet ----------
function openMenu(open) {
  const m = $('#menuBackdrop');
  if (open && m.hidden) {
    m.hidden = false;
    $('#menuVersion').textContent = 'Sound Director ' + APP_VERSION;
    try { history.pushState({ sdMenu: true }, ''); } catch {}
  } else if (!open && !m.hidden) {
    m.hidden = true;
    if (history.state && history.state.sdMenu) { try { history.back(); } catch {} }
  }
}

function initMenu() {
  $('#menuBtn').addEventListener('click', () => openMenu(true));
  $('#menuBackdrop').addEventListener('click', (e) => { if (e.target.id === 'menuBackdrop') openMenu(false); });

  // Android back / Esc closes any open overlay so nothing can trap the user.
  window.addEventListener('popstate', () => {
    const m = $('#menuBackdrop');
    if (!m.hidden) m.hidden = true;
    document.querySelectorAll('dialog[open]').forEach(d => { try { d.close(); } catch {} });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const m = $('#menuBackdrop');
    if (!m.hidden) { e.preventDefault(); openMenu(false); }
  });
  // Tapping outside a dialog (on its backdrop) closes it.
  document.querySelectorAll('dialog').forEach(dlg => {
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  });
  $('#menuBackdrop').addEventListener('click', async (e) => {
    const item = e.target.closest('[data-act]');
    if (!item) return;
    const act = item.dataset.act;
    if (act !== 'close') openMenu(false);
    switch (act) {
      case 'close': openMenu(false); break;
      case 'new-show': {
        const name = await openTextDialog({ title: 'New show name', multiline: false, placeholder: 'e.g. Purimshpil 2026' });
        if (name) { await store.newShow(name.trim()); resetPlayhead(); updateShowName(); toast('New show created', 'ok'); }
        break;
      }
      case 'rename-show': {
        const name = await openTextDialog({ title: 'Rename show', multiline: false, value: store.show.name });
        if (name && name.trim()) { store.update(s => { s.name = name.trim(); }, 'meta'); updateShowName(); }
        break;
      }
      case 'export-show': exportShowJson(); break;
      case 'import-show': await importShowJson(); updateShowName(); break;
      case 'export-bundle': await exportBundle(); break;
      case 'import-bundle': await importBundle(); updateShowName(); break;
      case 'reload': await forceReload(); break;
      case 'install': await doInstall(); break;
      case 'storage': await showStorage(); break;
      case 'help': showHelp(); break;
    }
  });
}

function updateShowName() { $('#showName').textContent = store.show.name || 'Untitled'; }

async function showStorage() {
  const est = await db.estimate();
  const n = store.show.audioMeta.length;
  if (est) toast(`${n} audio files · using ${fmtBytes(est.usage)} of ~${fmtBytes(est.quota)}`);
  else toast(`${n} audio files in this show`);
}

function showHelp() {
  alert(
    'SOUND DIRECTOR — quick start\n\n' +
    '1) SCRIPT tab: import the play (.docx/.txt) or paste it.\n' +
    '2) AUDIO tab: add your mp3/wav backing tracks & sound effects.\n' +
    '3) CUES tab: tap a script line (or +Add cue) → choose START/STOP/FADE and pick the audio. ' +
    'Try ✨ Auto-detect to scan the script for cue-like lines.\n' +
    '4) SHOW tab: this is your live board. The next cue is highlighted; tap the big GO to fire it. ' +
    '◼ STOP ALL fades everything.\n\n' +
    'Voice assist (needs internet): listens to the Russian dialogue and lights up GO when it hears the next cue — you still tap GO.\n\n' +
    'Backup: menu → Export full backup (.zip) keeps your audio + cues together. Import it on the tablet.'
  );
}

// ---------- install (PWA) ----------
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; });
async function doInstall() {
  if (!installPrompt) { toast('Open the browser menu → "Install app" / "Add to Home screen".'); return; }
  installPrompt.prompt();
  const { outcome } = await installPrompt.userChoice;
  installPrompt = null;
  toast(outcome === 'accepted' ? 'Installing…' : 'Install dismissed');
}

// ---------- drag & drop audio onto window ----------
function initDrop() {
  ['dragover', 'drop'].forEach(ev => document.addEventListener(ev, e => e.preventDefault()));
  document.addEventListener('drop', e => {
    const files = [...(e.dataTransfer?.files || [])].filter(f => /audio|mp3|wav|m4a|ogg|aac|flac/i.test(f.type + ' ' + f.name));
    if (files.length) { addAudioFiles(files); showView('library'); }
  });
}

// ---------- service worker + updates ----------
function initSW() {
  if (!('serviceWorker' in navigator)) return;
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return; refreshing = true; location.reload();
  });
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

async function forceReload() {
  toast('Checking for updates…');
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      await reg.update();
      if (reg.waiting) { reg.waiting.postMessage({ type: 'SKIP_WAITING' }); return; } // controllerchange reloads
    }
  } catch {}
  location.reload(true);
}

// ---------- boot ----------
async function boot() {
  initNav();
  initMenu();
  initScriptView();
  initLibraryView();
  initCuesView();
  initPerformView();
  initDrop();
  initSW();

  await store.init();
  updateShowName();
  store.onChange(reason => { if (['meta', 'show-switched', 'init'].includes(reason)) updateShowName(); });

  const last = localStorage.getItem('sd.lastView') || 'perform';
  showView(last);

  // keep screen awake during a show if supported
  requestWakeLockSoft();
}

let wakeLock = null;
async function requestWakeLockSoft() {
  try {
    if ('wakeLock' in navigator) {
      const acquire = async () => { try { wakeLock = await navigator.wakeLock.request('screen'); } catch {} };
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') acquire(); });
      await acquire();
    }
  } catch {}
}

boot();
