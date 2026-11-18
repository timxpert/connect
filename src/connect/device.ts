/* One device at a time.
   Each signed-in browser keeps a random token. The first time it signs in,
   it tells the database "this is the student's device now", which ends the
   student's sign-ins everywhere else. Every few seconds it checks it's still
   the one; if another device has taken over, it signs out here. The team
   (grand sensei, moderators) is exempt on the server. */

import type { ConnectApi } from './types';

const KEY = 'cx-device';
const KICKED = 'cx-kicked';

function label() {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Device';
  const br = /EdgA?\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${os} · ${br}`;
}

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
};

/** True once, right after this device was signed out by another one */
export function takeKicked() {
  const k = read(KICKED) === '1';
  if (k) write(KICKED, null);
  return k;
}

/** Call when someone is signed in. Returns a function that stops the checks. */
export function guardDevice(api: ConnectApi, onKicked: () => void) {
  let stopped = false;
  let token = read(KEY);

  const check = async () => {
    if (stopped || !token || document.visibilityState !== 'visible') return;
    const ok = await api.checkDevice(token).catch(() => true);
    if (!ok && !stopped) {
      stopped = true;
      write(KEY, null);
      write(KICKED, '1');
      await api.signOut().catch(() => {});
      onKicked();
    }
  };

  (async () => {
    if (!token) {
      token = crypto.randomUUID();
      try {
        await api.claimDevice(token, label());
        write(KEY, token);
      } catch {
        token = null; // database not updated yet: leave things as they are
        return;
      }
    }
    check();
  })();

  const t = window.setInterval(check, 15000);
  const onVis = () => check();
  document.addEventListener('visibilitychange', onVis);
  return () => {
    stopped = true;
    window.clearInterval(t);
    document.removeEventListener('visibilitychange', onVis);
  };
}

/** Forget this device's token (on a normal sign out) */
export function forgetDevice() {
  write(KEY, null);
}
