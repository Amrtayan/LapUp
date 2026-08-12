// LapUp Service Worker
// Cache-first strategy for app shell; stale-while-revalidate for Google Fonts.

const CACHE_NAME = 'lapup-v2';

const APP_SHELL = [
  './index.html',
  './style.css',
  './script.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

const FONT_CACHE_NAME = 'laptrack-fonts-v1';
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

// ── Install: cache the app shell ─────────────────────────────
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

// ── Fetch: serve from cache, with font stale-while-revalidate ─
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Google Fonts: stale-while-revalidate
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

  // App shell: cache-first
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      // Not in cache: fetch from network and cache it
      return fetch(event.request).then(response => {
        if (response.ok) {
          caches.open(CACHE_NAME).then(cache =>
            cache.put(event.request, response.clone())
          );
        }
        return response;
      });
    })
  );
});
