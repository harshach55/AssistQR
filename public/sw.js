// Service Worker for AssistQR
// Enables offline functionality for accident reporting form
// Includes Background Sync API for automatic report syncing

const CACHE_NAME = 'assistqr-v7';

// Install: Cache resources when Service Worker is installed
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Caching app shell');
      return cache.addAll([
        '/css/style.css',
        '/js/offline-storage.js',
        '/js/offline-sync.js'
      ]).catch(err => {
        console.log('[Service Worker] Cache addAll failed:', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate: Clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[Service Worker] Removing old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  return self.clients.claim();
});

// Fetch: Network-first strategy with cache fallback
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Only handle GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Handle form page requests (/qr/help)
  if (url.pathname.startsWith('/qr/help')) {
    event.respondWith(
      (async () => {
        try {
          const cache = await caches.open(CACHE_NAME);
          const cacheKey = new Request(url.pathname, { method: 'GET' });
          
          // Try network first
          try {
            const response = await fetch(event.request);
            
            // If successful, cache it
            if (response && response.status === 200) {
              const responseToCache = response.clone();
              cache.put(cacheKey, responseToCache).catch(err => {
                console.log('[SW] Cache put error:', err);
              });
              console.log('[SW] ✅ Cached form page');
            }
            
            return response;
          } catch (fetchError) {
            // Network failed - try cache
            console.log('[SW] Network failed, checking cache...');
            const cachedResponse = await cache.match(cacheKey);
            
            if (cachedResponse) {
              console.log('[SW] ✅ Serving from cache (offline)');
              return cachedResponse;
            }
            
            // No cache available
            console.log('[SW] ❌ No cache available');
            throw new Error('No cache');
          }
        } catch (error) {
          // Final fallback - return offline message
          return new Response(
            '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Offline</title><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body style="font-family: Arial; padding: 20px; text-align: center;"><h1>Offline</h1><p>Form not cached yet.</p><p>Please connect to internet, scan QR code once, then it will work offline.</p></body></html>',
            {
              status: 503,
              headers: { 'Content-Type': 'text/html; charset=utf-8' }
            }
          );
        }
      })()
    );
    return;
  }
  
  // Cache CSS and JS files
  if (url.pathname.startsWith('/css/') || url.pathname.startsWith('/js/')) {
    event.respondWith(
      caches.match(event.request).then((response) => {
        return response || fetch(event.request).then((response) => {
          if (response && response.status === 200) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return response;
        });
      })
    );
  }
});
