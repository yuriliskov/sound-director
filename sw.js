// Offline app shell. Bump CACHE when you change any file below.
const CACHE = 'sound-director-v4';
const ASSETS = [
  './',
  './index.html',
  './app.css',
  './manifest.webmanifest',
  './vendor/jszip.min.js',
  './js/main.js',
  './js/store.js',
  './js/db.js',
  './js/util.js',
  './js/audio.js',
  './js/voice.js',
  './js/script-import.js',
  './js/script-view.js',
  './js/library-view.js',
  './js/cues-view.js',
  './js/cue-editor.js',
  './js/cues-view.js',
  './js/perform-view.js',
  './js/text-dialog.js',
  './js/show-io.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // don't cache cross-origin (e.g. speech API)
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      // cache same-origin app files as we go
      if (res.ok && (res.type === 'basic')) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => hit))
  );
});
