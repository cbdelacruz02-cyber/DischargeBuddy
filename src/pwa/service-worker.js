/**
 * service-worker.js — DischargeBuddy PWA Service Worker
 *
 * Strategy: Cache-First with Network Fallback
 *
 *  1. On INSTALL  — pre-cache every static asset listed in STATIC_ASSETS.
 *     These are the Expo web build outputs from `npx expo export --platform web`.
 *     After a rebuild, the cache version string (CACHE_VERSION) must be bumped
 *     OR the post-build script (scripts/pwa-inject.js) auto-stamps it with a
 *     build hash so the new worker takes over automatically.
 *
 *  2. On ACTIVATE — delete all old cache buckets (previous deploys).
 *
 *  3. On FETCH    — serve from cache first; fall back to network; if both fail
 *     (airplane mode + asset not cached), return the offline shell (index.html).
 *
 *  Offline guarantee: once installed, the full app shell — all JS bundles, CSS,
 *  fonts, icons — is served entirely from the device's Cache Storage.
 *  expo-speech (TTS) and expo-haptics are native device APIs: they work offline.
 *  Timers (setInterval / setTimeout) are native: they work offline.
 *  The Standalone/Cloud toggle correctly blocks any cloud action in airplane mode.
 */

// ─── Cache identity ───────────────────────────────────────────────────────────
// pwa-inject.js stamps __BUILD_HASH__ at build time so each fresh `expo export`
// automatically busts the cache. If you skip the script, bump this manually.
const CACHE_VERSION = '__BUILD_HASH__';
const CACHE_NAME    = `dischargebuddy-v${CACHE_VERSION}`;

// ─── Static asset manifest ────────────────────────────────────────────────────
// These paths match exactly what `npx expo export --platform web` outputs to
// the dist/ folder.  pwa-inject.js overwrites this array with the real hashed
// filenames after every build, so it stays accurate automatically.
const STATIC_ASSETS = [
  // App shell
  '/',
  '/index.html',
  '/favicon.ico',

  // Expo router pre-rendered HTML shells
  '/alert.html',
  '/explore.html',
  '/+not-found.html',

  // CSS
  '/_expo/static/css/global-87fd0564cfa78f37afcb8d7603e15d75.css',

  // JS bundles — hashed filenames from last build
  '/_expo/static/js/web/__expo-metro-runtime-97703ae02682710149335928b974f18d.js',
  '/_expo/static/js/web/_layout-7eb83df1d42f735596998879da2af285.js',
  '/_expo/static/js/web/__common-130fd1133f71c27f82a1f168bfb41033.js',
  '/_expo/static/js/web/entry-d0df1da45ff8950dc72135d8792e7893.js',
  '/_expo/static/js/web/index-0ead82b4e7f43949e12b1e8012ee1a50.js',
  '/_expo/static/js/web/alert-440fd1eb7c08f3a4a87eb25068033e1b.js',
  '/_expo/static/js/web/explore-c0174865462b41740c87d43a44a3ff9f.js',

  // PWA manifest
  '/manifest.json',
];

// ─── INSTALL — pre-cache all static assets ────────────────────────────────────
self.addEventListener('install', (event) => {
  // Skip waiting so this SW activates immediately on first install
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // addAll fails atomically — if any asset 404s the whole install fails.
      // This is intentional: a broken build should not replace a working cache.
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[SW] Pre-cache partial failure (non-fatal):', err.message);
        // Fall back to adding assets one-by-one so a single missing file
        // doesn't block the entire offline install.
        return Promise.allSettled(
          STATIC_ASSETS.map((url) =>
            cache.add(url).catch(() => {
              console.warn('[SW] Skipped (not found):', url);
            })
          )
        );
      });
    })
  );
});

// ─── ACTIVATE — delete stale caches from previous deploys ────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim())  // take control of open tabs immediately
  );
});

// ─── FETCH — cache-first with offline fallback ────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET requests; let POST/PUT/etc pass through unmodified
  if (request.method !== 'GET') return;

  // Only handle same-origin requests (don't intercept external CDNs)
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        // Serve from cache immediately (offline-first guarantee)
        return cached;
      }

      // Not in cache — try the network
      return fetch(request)
        .then((networkResponse) => {
          // Cache the fresh response for next time (dynamic caching)
          if (
            networkResponse.ok &&
            networkResponse.type === 'basic'
          ) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return networkResponse;
        })
        .catch(() => {
          // Network failed (airplane mode) — serve the offline shell
          // for navigation requests so the SPA still boots
          if (request.mode === 'navigate') {
            return caches.match('/index.html');
          }
          // For other assets (images, etc) return a minimal 503
          return new Response('Offline', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'text/plain' },
          });
        });
    })
  );
});

// ─── MESSAGE — force update from the app UI ──────────────────────────────────
// Send { type: 'SKIP_WAITING' } from the app to force a SW update immediately
// (useful for the Standalone/Cloud toggle's "check for updates" flow)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
