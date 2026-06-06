import { db } from './db.js';
import { uid } from './util.js';

const ACTIVE_KEY = 'sd.activeShowId';
const SCHEMA = 2;

function emptyShow(name = 'New show') {
  const now = Date.now();
  return {
    id: uid('show'),
    schema: SCHEMA,
    name,
    createdAt: now,
    updatedAt: now,
    script: [],      // [{ i, type, text }]
    cues: [],        // ordered [{ id, name, action, audioId, volume, fadeMs, loop, restart, anchorLine, trigger }]
    audioMeta: [],   // [{ id, name, type, size, duration }]  (blobs live in db 'audio')
  };
}

const listeners = new Set();
let show = emptyShow();
let _saveTimer = null;

export const store = {
  get show() { return show; },

  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  emit(reason = '') {
    for (const fn of listeners) { try { fn(reason); } catch (e) { console.error(e); } }
  },

  // Mutate then persist + notify. `reason` lets views decide what to re-render.
  update(mutator, reason = '') {
    mutator(show);
    show.updatedAt = Date.now();
    this.emit(reason);
    this.saveSoon();
  },

  saveSoon() {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => this.save(), 250);
  },

  async save() {
    clearTimeout(_saveTimer);
    await db.putShow(JSON.parse(JSON.stringify(show)));
    localStorage.setItem(ACTIVE_KEY, show.id);
  },

  async init() {
    const shows = await db.allShows();
    const activeId = localStorage.getItem(ACTIVE_KEY);
    let active = shows.find(s => s.id === activeId) || shows.sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (active) {
      show = migrate(active);
    } else {
      show = emptyShow('My Show');
      await this.save();
    }
    this.emit('init');
    return show;
  },

  async listShows() {
    return (await db.allShows()).sort((a, b) => b.updatedAt - a.updatedAt);
  },

  async newShow(name) {
    show = emptyShow(name || 'New show');
    await this.save();
    this.emit('show-switched');
    return show;
  },

  async loadShow(id) {
    const s = await db.getShow(id);
    if (!s) return false;
    show = migrate(s);
    localStorage.setItem(ACTIVE_KEY, show.id);
    this.emit('show-switched');
    return true;
  },

  // Replace the whole show object (used by import). Keeps audioMeta as-is.
  async replaceShow(obj) {
    show = migrate({ ...emptyShow(), ...obj, id: obj.id || uid('show') });
    await this.save();
    this.emit('show-switched');
  },

  // ---- convenience accessors ----
  cueById(id) { return show.cues.find(c => c.id === id); },
  audioMetaById(id) { return show.audioMeta.find(a => a.id === id); },
  cueIndex(id) { return show.cues.findIndex(c => c.id === id); },
};

function migrate(s) {
  s.schema = SCHEMA;
  s.script ||= [];
  s.cues ||= [];
  s.audioMeta ||= [];
  // ensure each script line has an index
  s.script.forEach((ln, i) => { ln.i = i; });
  // backfill cue fields
  s.cues.forEach(c => {
    c.id ||= uid('cue');
    c.action ||= 'start';
    if (c.volume == null) c.volume = 1;
    if (c.fadeMs == null) c.fadeMs = 0;
    c.loop = !!c.loop;
    c.restart = !!c.restart;
    if (c.anchorLine === undefined) c.anchorLine = null;
    c.trigger ||= '';
  });
  return s;
}
