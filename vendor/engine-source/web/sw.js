 const CACHE_NAME = 'pdf-tools-__BUILD_ID__';
 const V = '__BUILD_ID__';
 const ASSETS_TO_CACHE = [
  './',
  './index.html?v=${V}',
  './style.css?v=${V}',
  './app.js?v=${V}',
  './gs-compress.js?v=${V}',
  './ghostscript.worker.js?v=${V}',
  './ghostscript.js?v=${V}',
  './ghostscript.wasm?v=${V}',
  './presets.js?v=${V}',
  './pdf-writer.js?v=${V}',
  './manifest.json?v=${V}',
  './icon-192.png?v=${V}',
  './icon-512.png?v=${V}',
  './apple-touch-icon.png?v=${V}',
  './icon.svg?v=${V}'
];

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Navigation requests: network first, fallback to cached index.html
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Static assets: cache first, fallback to network
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Fetch background update in non-blocking way
        fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.ok) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
          }
        }).catch(() => { /* offline silent catch */ });
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.ok && event.request.method === 'GET') {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
        }
        return networkResponse;
      });
    })
  );
});
