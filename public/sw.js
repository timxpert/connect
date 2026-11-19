/* Motion Dojo Connect service worker.
   1. Shows message notifications (also from the server: see 3) and opens the right chat when one is tapped.
   2. Keeps photos (profile pictures, posts, chat photos) on the phone after
      they load once, so they show instantly next time and don't use data again.
      Only pictures are kept; pages and data always come fresh. */
const PHOTOS = 'cx-photos-v1';
const MAX_PHOTOS = 400;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) =>
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('cx-photos-') && k !== PHOTOS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  ),
);

// Signed links get a new ?query each time; the picture behind them stays the same
const keyOf = (url) => {
  const u = new URL(url);
  const signed = u.pathname.includes('/object/sign/') || u.hostname.endsWith('cloudflarestorage.com');
  return signed ? u.origin + u.pathname : url;
};
const isPhoto = (req) => {
  if (req.method !== 'GET' || req.destination !== 'image') return false;
  const u = new URL(req.url);
  if (u.origin === self.location.origin) return false;
  return /\/storage\/v1\/object\//.test(u.pathname) || /r2\.(dev|cloudflarestorage\.com)$/.test(u.hostname) || /\.(jpe?g|png|webp|avif|gif)$/i.test(u.pathname);
};
async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_PHOTOS; i++) await cache.delete(keys[i]);
}
self.addEventListener('fetch', (e) => {
  if (!isPhoto(e.request)) return;
  e.respondWith(
    (async () => {
      const cache = await caches.open(PHOTOS);
      const key = keyOf(e.request.url);
      const hit = await cache.match(key);
      if (hit) return hit;
      try {
        // CORS so the cached copy is readable (and doesn't eat storage the way opaque copies do)
        const res = await fetch(e.request.url, { mode: 'cors', credentials: 'omit' });
        if (res.ok) {
          cache.put(key, res.clone()).then(() => trim(cache)).catch(() => {});
          return res;
        }
      } catch {}
      return fetch(e.request);
    })(),
  );
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          if ('navigate' in c) c.navigate(url).catch(() => {});
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});

/* 3. Phone notifications from the server when Connect is closed (Web Push).
   Messages from the same chat stack in one notification, like WhatsApp. */
self.addEventListener('push', (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch {
    d = { title: 'Motion Dojo Connect', body: e.data ? e.data.text() : '' };
  }
  e.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Connect is open on screen: the app shows its own alert
      if (!d.force && wins.some((c) => c.visibilityState === 'visible' && c.focused)) return;
      const tag = d.tag || 'connect';
      const earlier = await self.registration.getNotifications({ tag });
      const lines = [...((earlier[0] && earlier[0].data && earlier[0].data.lines) || []), d.body || ''].slice(-6);
      const body = lines.length > 1 ? lines.join('\n') : lines[0];
      const title = lines.length > 1 ? `${d.title} (${lines.length} messages)` : d.title || 'Motion Dojo Connect';
      await self.registration.showNotification(title, {
        body,
        tag,
        renotify: true,
        silent: false,
        vibrate: [120, 60, 120],
        icon: d.icon || '/assets/icon-192.png',
        // Android shows this small one in white: the Motion Dojo mark
        badge: '/assets/badge-96.png',
        data: { url: d.url || '/', lines },
      });
    })(),
  );
});
