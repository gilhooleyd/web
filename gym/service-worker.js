/**
 * Caches the app shell so the app still opens with no signal (airplane
 * mode, bad gym wifi). Fully static/offline-capable already — everything
 * the app needs beyond these files is localStorage, not network — so a
 * simple cache-first strategy over a fixed precache list is enough; there's
 * no dynamically-fetched content to account for.
 *
 * Bump CACHE_NAME whenever a shipped file changes. There's no build step
 * generating a content hash, so this is a manual "did I change something"
 * convention: install fetches everything fresh into the new cache name,
 * activate deletes whatever old-named cache is left over.
 */
const CACHE_NAME = 'gym-cache-v1';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './model.js',
  './storage.js',
  './chart.js',
  './script.js',
  './manifest.json',
  './icons/icon-512.png',
  '../libs/mithril.js',
  '../libs/tacit-css.css',
  '../common/style.css',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request)),
  );
});
