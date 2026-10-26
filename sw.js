// Bump CACHE_VERSION whenever an app file changes so phones pick up the new version.
const CACHE_VERSION = 'v22';
const CACHE = `flashcards-${CACHE_VERSION}`;

const ASSETS = [
  './',
  'index.html',
  'style.css',
  'db.js',
  'app.js',
  'manifest.webmanifest',
  'data/hsk1.csv',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
];

self.addEventListener('install', event => {
  // cache: 'reload' skips the browser's HTTP cache: GitHub Pages lets it keep files for
  // 10 minutes, which could otherwise put an old file in the new version's cache.
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' })))));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'GET_VERSION') event.source.postMessage({ type: 'SW_VERSION', version: CACHE_VERSION });
});

// Cache first: the app must open with no network at all.
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true })
      .then(cached => cached || fetch(event.request))
  );
});
