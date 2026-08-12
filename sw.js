// LapUp Service Worker
// Network-first for app shell (auto-updates); stale-while-revalidate for Google Fonts.

const CACHE_NAME = 'lapup-v2';

const APP_SHELL = [
  './index.html',
  './style.css',
  './script.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

const FONT_CACHE_NAME = 'lapup-fonts-v1';
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

// ── Install: pre-cache the app shell for offline use ─────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())  // activate immediately
  );
});

// ── Activate: delete outdated caches ─────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== FONT_CACHE_NAME)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())  // take control of open tabs
  );
});

// ── Fetch ────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Google Fonts: stale-while-revalidate (they rarely change)
  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.open(FONT_CACHE_NAME).then(cache =>
        cache.match(event.request).then(cached => {
          const network = fetch(event.request).then(response => {
            cache.put(event.request, response.clone());
            return response;
          });
          return cached || network;
        })
      )
    );
    return;
  }

  // App shell: network-first, fallback to cache
  // → When online: always gets the latest files and updates the cache
  // → When offline: serves the last cached version
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Got a fresh response — update the cache with it
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache =>
            cache.put(event.request, clone)
          );
        }
        return response;
      })
      .catch(() => {
        // Network failed (offline) — serve from cache
        return caches.match(event.request);
      })
  );
});
