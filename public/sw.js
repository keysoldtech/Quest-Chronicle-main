// Service Worker - Quest & Chronicle
// Handles offline caching with proper error handling

// 1. CONFIGURATION
const CACHE_NAME = 'quest-and-chronicle-v4.3.7-pwa';
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
  // Minimal sprites/tiles for offline grid visibility
  '/assets/tiles/stone-floor.png',
  '/assets/tiles/stone-floor-dark.png',
  '/assets/sprites/barbarian.png',
  '/assets/sprites/warrior.png',
  '/assets/sprites/rogue.png',
  '/assets/sprites/ranger.png',
  '/assets/sprites/mage.png',
  '/assets/sprites/cleric.png',
  '/assets/sprites/goblin.png',
  '/assets/sprites/wolf.png',
  '/assets/sprites/skeleton.png',
  '/assets/sprites/spider.png',
  '/assets/sprites/orc.png',
  '/assets/sprites/sprite-manifest.json',
  '/icons/logo.png',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png'
];

// 2. INSTALL - Cache core files
self.addEventListener('install', event => {
  console.log('[SW] Install event');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Pre-caching app shell');
        return cache.addAll(urlsToCache);
      })
      .then(() => self.skipWaiting())
  );
});

// 3. ACTIVATE - Clean old caches
self.addEventListener('activate', event => {
  console.log('[SW] Activate event');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 4. FETCH - Handle requests with proper error handling
self.addEventListener('fetch', event => {
  const url = event.request.url;
  
  // CRITICAL: Only handle http(s) requests - skip everything else!
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return; // Skip chrome-extension:, data:, blob:, etc.
  }
  
  // Skip Socket.IO and non-GET requests
  if (event.request.method !== 'GET' || url.includes('/socket.io/')) {
    return;
  }

  // Cache-first strategy
  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        if (cachedResponse) {
          return cachedResponse;
        }
        
        // Not in cache, fetch from network
        return fetch(event.request)
          .then(networkResponse => {
            // Only cache successful responses from our origin
            if (networkResponse && 
                networkResponse.status === 200 && 
                networkResponse.type === 'basic' &&
                (event.request.url.startsWith(self.location.origin) || event.request.url.startsWith('http'))) {
              const responseToCache = networkResponse.clone();
              caches.open(CACHE_NAME).then(cache => {
                // Double-check the request URL before caching
                const reqUrl = event.request.url;
                if (reqUrl.startsWith('http://') || reqUrl.startsWith('https://')) {
                  cache.put(event.request, responseToCache).catch(err => {
                    // Silent fail - caching is optional
                    if (!err.message.includes('unsupported')) {
                      console.log('[SW] Cache put failed (not critical):', err.message);
                    }
                  });
                }
              });
            }
            return networkResponse;
          })
          .catch(error => {
            console.log('[SW] Fetch failed:', event.request.url);
            // Return fallback for navigation
            if (event.request.mode === 'navigate') {
              return caches.match('/index.html');
            }
            return new Response('Offline', { status: 503 });
          });
      })
  );
});
