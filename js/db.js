// Minimal IndexedDB wrapper. Two stores:
//   audio  -> { id, name, type, size, blob }   (the actual files live here)
//   shows  -> { id, name, ...show JSON }        (script + cues + audioMeta)
const DB_NAME = 'sound-director';
const DB_VERSION = 1;
let _db = null;

function open() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('shows')) db.createObjectStore('shows', { keyPath: 'id' });
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then(r => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

function reqP(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const db = {
  // ---- audio ----
  putAudio: (rec) => tx('audio', 'readwrite', s => reqP(s.put(rec))),
  getAudio: (id) => tx('audio', 'readonly', s => reqP(s.get(id))),
  deleteAudio: (id) => tx('audio', 'readwrite', s => reqP(s.delete(id))),
  allAudio: () => tx('audio', 'readonly', s => reqP(s.getAll())),

  // ---- shows ----
  putShow: (show) => tx('shows', 'readwrite', s => reqP(s.put(show))),
  getShow: (id) => tx('shows', 'readonly', s => reqP(s.get(id))),
  deleteShow: (id) => tx('shows', 'readwrite', s => reqP(s.delete(id))),
  allShows: () => tx('shows', 'readonly', s => reqP(s.getAll())),

  estimate: () => (navigator.storage && navigator.storage.estimate)
    ? navigator.storage.estimate() : Promise.resolve(null),
};
