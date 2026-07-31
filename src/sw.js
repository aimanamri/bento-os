// Service worker — offline app shell (SECURITY.md §7).
//
// Scope is deliberately narrow: this worker caches *the application*, never
// *the data*. Same-origin shell assets (HTML, CSS, JS, vendor libs, icons)
// are precached at install; everything cross-origin — every Supabase REST,
// Auth and Realtime call — is passed straight through and never stored, so
// no signed-in user's rows can outlive their session in CacheStorage.
//
// `scripts/build-sw.js` fills in the two placeholders below from the real
// contents of dist/, so the cache name changes whenever any shell file
// changes and the previous generation is dropped on activate.

const BUILD = '__BUILD_ID__';
const PRECACHE_URLS = __PRECACHE_URLS__;

const SHELL_CACHE = `bento-shell-${BUILD}`;
const RUNTIME_CACHE = `bento-runtime-${BUILD}`;
const KEEP = new Set([SHELL_CACHE, RUNTIME_CACHE]);

self.addEventListener('install', (event) => {
  // addAll is atomic: a single missing file fails the install and leaves the
  // previous worker serving, which is the behaviour we want for a half-built
  // deploy — better no update than a shell with a hole in it.
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(PRECACHE_URLS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('bento-') && !KEEP.has(key)) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

// The page offers "reload to update"; until then the new worker waits so a
// running session is never swapped out from under an unsaved draft.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// Network-first for the document: online, a deploy is picked up on the next
// load; offline, the cached shell boots instead of the browser's dino page.
async function documentResponse(request) {
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put('/index.html', fresh.clone());
    }
    return fresh;
  } catch {
    const cached = await caches.match('/index.html', { cacheName: SHELL_CACHE });
    return cached || new Response('Offline and no cached copy of Bento OS yet.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

// Cache-first for shell assets: they are immutable for the life of a build
// (the cache name carries the build id), so this costs one lookup and no
// revalidation round-trip. Anything same-origin that was not precached —
// KaTeX's font files, most notably — fills the runtime cache on first use.
async function assetResponse(request) {
  const cached = await caches.match(request, { ignoreSearch: false });
  if (cached) return cached;
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok && fresh.type === 'basic') {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, fresh.clone());
    }
    return fresh;
  } catch {
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Supabase et al: untouched
  // The data layer is never cached, wherever it lives. On the Supabase
  // variant that is already covered by the origin check above; on the local
  // SQLite variant the API is same-origin, and without this line a GET
  // /api/entries would put a signed-in user's rows into CacheStorage.
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return;
  if (url.pathname === '/sw.js') return; // never serve the worker from itself

  if (request.mode === 'navigate') {
    event.respondWith(documentResponse(request));
    return;
  }
  event.respondWith(assetResponse(request));
});
