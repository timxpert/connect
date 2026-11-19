/* Motion Dojo Connect service worker.
   1. Shows message notifications and opens the right chat when one is tapped.
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
