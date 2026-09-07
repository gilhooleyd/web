/**
 * Caches the app shell so the app still opens with no signal (airplane
 * mode, bad gym wifi). Fully static/offline-capable already — everything
 * the app needs beyond these files is localStorage, not network.
 *
 * Strategy: stale-while-revalidate. Every request is answered from the
 * cache immediately if it's there (this is what makes a cold open fast),
 * and the cache entry is refreshed from the network in the background so
 * a changed file lands on the *next* open. Only a genuine cache miss
 * waits on the network at all.
 *
 * Why not the old plain cache-first: a cache-first handler with no
 * network timeout falls through to `fetch()` for anything it can't match
 * — a URL with a `?query`, a navigation the SW isn't controlling yet —
 * and on flaky wifi that `fetch()` hangs for many seconds before failing.
 * That stall on launch is the "odd delay". Fixes here: `ignoreSearch` so
 * query strings still hit the cache, navigation preload so the network
 * probe runs *during* SW startup instead of after it, and a navigation
 * fallback to the cached index so a miss can never block the app opening.
 *
 * CACHE_NAME still needs a manual bump when a shipped file changes (no
 * build step to hash content) — but stale-while-revalidate means a missed
 * bump self-heals on the following open rather than serving stale forever.
 *
 * Updates are user-gated: a new worker installs, precaches, and WAITS
 * (no skipWaiting on install). The page detects the waiting worker and
 * shows a banner; tapping it posts SKIP_WAITING here, this worker
 * activates, and the page reloads into it (see the registration block in
 * script.js).
 */
const CACHE_NAME = 'gym-cache-v3';
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
  // No skipWaiting() here on purpose: a new worker installs and then
  // WAITS. The page shows an "update available" banner and only when the
  // user taps it (-> SKIP_WAITING message below) does this worker take
  // over — so an update never yanks the page out from under someone
  // mid-workout.
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    if (self.registration.navigationPreload) {
      await self.registration.navigationPreload.enable();
    }
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

// Refresh one cache entry from the network. Returns the network response
// (or undefined if offline / it failed) — callers decide whether to wait
// on it or let it run in the background.
async function revalidate(cache, request, preloadResponse) {
  try {
    const response = (preloadResponse && (await preloadResponse)) || (await fetch(request));
    if (response && response.ok) await cache.put(request, response.clone());
    return response;
  } catch (e) {
    return undefined;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request, { ignoreSearch: true });
    const networkFetch = revalidate(cache, request, event.preloadResponse);

    if (cached) {
      event.waitUntil(networkFetch); // keep the SW alive for the background refresh
      return cached;
    }

    const network = await networkFetch;
    if (network) return network;

    // Offline and never cached — for a navigation, the app shell is a
    // fine stand-in (the app is a single page); otherwise there's nothing
    // to give back.
    if (request.mode === 'navigate') {
      return (await cache.match('./index.html')) || (await cache.match('./')) || Response.error();
    }
    return Response.error();
  })());
});
