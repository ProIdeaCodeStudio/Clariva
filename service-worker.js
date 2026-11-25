/* Clariva app-shell cache. Private resource PDFs are never cached by the service worker. */
const CACHE_NAME = 'clariva-app-shell-v17';
const APP_SHELL = [
  './index.html',
  './Undergraduates.html',
  './AdminDashboard.html',
  './OwnerDashboard.html',
  './Stylesheet.css',
  './ProfileMenu.css?v=20261120-2',
  './script.js?v=20261125-3',
  './notifications.js?v=20261125-1',
  './ProfileMenu.js?v=20261125-1',
  './StudentResources.js?v=20261125-1',
  './AdminDashboard.js?v=20261125-3',
  './OwnerDashboard.js?v=20261122-1',
  './GuidedTour.css?v=20261124-5',
  './GuidedTour.js?v=20261124-5',
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

self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; }
  catch (_) { payload = { body: event.data ? event.data.text() : 'You have a new Clariva notification.' }; }

  const title = String(payload.title || 'Clariva');
  const options = {
    body: String(payload.body || 'You have a new update.'),
    icon: new URL('./ClarivaTpLetterMark.png', self.registration.scope).href,
    badge: new URL('./ClarivaTpLetterMark.png', self.registration.scope).href,
    tag: String(payload.tag || 'clariva-update'),
    renotify: Boolean(payload.renotify),
    data: { url: payload.url || './' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || './', self.registration.scope);
  if (target.origin !== self.location.origin) return;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.focus();
        if ('navigate' in client) await client.navigate(target.href);
        return;
      }
    }
    await self.clients.openWindow(target.href);
  })());
});
