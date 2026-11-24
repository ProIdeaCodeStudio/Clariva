/* Clariva app-shell cache. Private resource PDFs are never cached by the service worker. */
const CACHE_NAME = 'clariva-app-shell-v11';
const APP_SHELL = [
  './index.html',
  './Undergraduates.html',
  './AdminDashboard.html',
  './OwnerDashboard.html',
  './Stylesheet.css',
  './ProfileMenu.css?v=20261120-2',
  './script.js?v=20261124-1',
  './ProfileMenu.js?v=20261124-1',
  './StudentResources.js?v=20261124-1',
  './GuidedTour.css?v=20261124-3',
  './GuidedTour.js?v=20261124-3',
  './connectivity.js?v=20261121-2',
  './ClarivaTpLetterMark.png',
  './Clariva-loader-mark.webp',
  './ClarivaTpWordMark.png'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(APP_SHELL.map(async path => {
      try {
        const request = new Request(new URL(path, self.registration.scope), { cache: 'reload' });
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response);
      } catch (error) {
        // A single unavailable optional asset must not prevent the app shell installing.
        console.warn('Clariva app-shell asset was not cached:', path, error);
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('clariva-app-shell-') && key !== CACHE_NAME)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (request.mode === 'navigate' && url.origin === self.location.origin) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response && response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        }
        return response;
      } catch (_) {
        const cache = await caches.open(CACHE_NAME);
        const fallbackPath = url.pathname.endsWith('/Undergraduates.html')
          ? './Undergraduates.html'
          : './index.html';
        return (await cache.match(request)) ||
          (await cache.match(new URL(fallbackPath, self.registration.scope))) ||
          Response.error();
      }
    })());
    return;
  }

  const cacheableAsset = ['script', 'style', 'image', 'font', 'worker'].includes(request.destination);
  if (!cacheableAsset) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response && (response.ok || response.type === 'opaque')) {
        await cache.put(request, response.clone());
      }
      return response;
    } catch (error) {
      return cached || Response.error();
    }
  })());
});
