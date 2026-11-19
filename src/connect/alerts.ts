/* Message alerts: a phone/computer notification when a message arrives while
   Connect is in the background. Uses the browser's Notification permission
   and the small service worker in /public/sw.js (needed on Android). */

export const alertsSupported = () => typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator;
export const alertsAllowed = () => alertsSupported() && Notification.permission === 'granted';
export const alertsUndecided = () => alertsSupported() && Notification.permission === 'default';

export function registerAlerts() {
  if (!alertsSupported()) return;
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

export async function askForAlerts() {
  if (!alertsSupported()) return false;
  const r = await Notification.requestPermission();
  return r === 'granted';
}

/* Phone notifications when Connect is closed (Web Push). The phone gets a
   subscription from its browser; we save it so the server can reach it. */
export const pushSupported = () => alertsSupported() && 'PushManager' in window;
export const pushOn = () => {
  try {
    return localStorage.getItem('cx-push-on') === '1';
  } catch {
    return false;
  }
};
const b64 = (s: string) => {
  const raw = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};
const b64u = (buf: ArrayBuffer | null) => (buf ? btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : '');

/** Subscribes this phone; returns what the server needs to reach it */
export async function pushSubscription(): Promise<{ endpoint: string; p256dh: string; auth: string } | null> {
  if (!pushSupported() || Notification.permission !== 'granted') return null;
  try {
    const res = await fetch('/api/push/key');
    if (!res.ok) return null;
    const { key } = (await res.json()) as { key: string };
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    const want = b64(key);
    if (sub) {
      const have = sub.options.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null;
      if (!have || have.length !== want.length || have.some((v, i) => v !== want[i])) {
        await sub.unsubscribe();
        sub = null;
      }
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want });
    return { endpoint: sub.endpoint, p256dh: b64u(sub.getKey('p256dh')), auth: b64u(sub.getKey('auth')) };
  } catch {
    return null;
  }
}
export function markPushOn(on: boolean) {
  try {
    localStorage.setItem('cx-push-on', on ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export async function notify(title: string, body: string, url: string, tag: string) {
  if (!alertsAllowed() || pushOn()) return; // with push on, the server's notification covers it
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(title, { body, tag, data: { url }, icon: '/assets/favicon-128.png', badge: '/assets/favicon-128.png' } as NotificationOptions);
  } catch {
    /* some browsers block notifications from pages; the in-app alert still shows */
  }
}
