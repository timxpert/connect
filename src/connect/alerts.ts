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

export async function notify(title: string, body: string, url: string, tag: string) {
  if (!alertsAllowed()) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(title, { body, tag, data: { url }, icon: '/assets/favicon-128.png', badge: '/assets/favicon-128.png' } as NotificationOptions);
  } catch {
    /* some browsers block notifications from pages; the in-app alert still shows */
  }
}
