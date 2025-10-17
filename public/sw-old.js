// This file is the Service Worker for the Quest & Chronicle Progressive Web App (PWA).
// It handles caching of assets for offline functionality and manages the update process
// to ensure users seamlessly receive new versions of the app.

// --- INDEX ---
// 1. CONFIGURATION (CACHE_NAME, urlsToCache)
// 2. INSTALL Event Listener
// 3. ACTIVATE Event Listener
// 4. FETCH Event Listener (Cache-First Strategy)

// --- 1. CONFIGURATION ---
const CACHE_NAME = 'quest-and-chronicle-v3.7.0-attack-server-fix';
const urlsToCache = [
  '/',
  '/index.html',
  '/client.js',
  '/style.css',
  '/animations.css',
  '/character-viewer.css',
  '/manifest.json',
  '/offline-actions.js',
  '/offline-game-engine.js',
  '/sound-manager.js',
  '/game-data.js',
  '/icons/logo.png',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png'
];

// --- 2. INSTALL Event Listener ---
// This event is triggered when the service worker is first registered.
// It opens the cache and adds all the core application files to it.
self.addEventListener('install', event => {
  console.log('[SW] Install event');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Pre-caching app shell');
        return cache.addAll(urlsToCache);
      })
      .then(() => {
        // Force the waiting service worker to become the active service worker.
        return self.skipWaiting();
      })
  );
});

// --- 3. ACTIVATE Event Listener ---
// This event is triggered after installation. This is the perfect place
// to clean up old caches from previous versions of the service worker.
self.addEventListener('activate', event => {
  console.log('[SW] Activate event');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          // If a cache's name is different from our current cache name, delete it.
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
        // Take control of all open clients immediately.
        return self.clients.claim();
    })
  );
});

// --- 4. FETCH Event Listener (Optimized Strategy) ---
// This event is triggered for every network request made by the page.
self.addEventListener('fetch', event => {
  // We only want to cache GET requests. We also ignore socket.io requests.
  if (event.request.method !== 'GET' || event.request.url.includes('/socket.io/')) {
    return;
  }

  const url = new URL(event.request.url);
  
  // For external resources (fonts, CDN), use cache-first with network fallback
  if (url.origin !== self.location.origin) {
    event.respondWith(
      caches.match(event.request)
        .then(response => response || fetch(event.request)
          .then(networkResponse => {
            // Cache external resources for offline use
            if (networkResponse && networkResponse.status === 200) {
              const responseToCache = networkResponse.clone();
              caches.open(CACHE_NAME).then(cache => {
                cache.put(event.request, responseToCache);
              });
            }
            return networkResponse;
          })
          .catch(() => {
            console.log('[SW] External resource unavailable offline:', url.href);
            // Return empty response for failed external resources
            return new Response('', { status: 200 });
          })
        )
    );
    return;
  }
  
  // For local app resources, use cache-first strategy
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          // Return cached version, but also fetch in background to update cache
          const fetchPromise = fetch(event.request)
            .then(networkResponse => {
              if (networkResponse && networkResponse.status === 200) {
                const responseToCache = networkResponse.clone();
                caches.open(CACHE_NAME).then(cache => {
                  cache.put(event.request, responseToCache);
                });
              }
              return networkResponse;
            })
            .catch(() => response); // If fetch fails, keep using cached version
          
          return response;
        }

        // If not in cache, fetch from network
        return fetch(event.request).then(
          networkResponse => {
            if (!networkResponse || networkResponse.status !== 200) {
               return networkResponse;
            }

            // Clone and cache the response
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME)
              .then(cache => {
                cache.put(event.request, responseToCache);
              });

            return networkResponse;
          }
        ).catch(error => {
            console.error('[SW] Fetch failed; returning offline fallback.', error);
            // Return the cached index page as fallback for navigation requests
            if (event.request.mode === 'navigate') {
              return caches.match('/index.html');
            }
            // Return empty response for other failed requests
            return new Response('Offline - Resource unavailable', { 
              status: 503, 
              statusText: 'Service Unavailable',
              headers: new Headers({ 'Content-Type': 'text/plain' })
            });
        });
      })
    );
});