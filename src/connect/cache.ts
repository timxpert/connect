/* Makes moving between pages instant: reads are kept for a short while and
   reused, so going back to the feed or a profile doesn't wait on the
   network again. Any change (post, like, connect, message...) clears the
   cache, so nothing shown is out of date after you act. */

import type { ConnectApi } from './types';
import { forgetDevice } from './device';

// Reads that are safe to reuse for a moment
const CACHED = new Set<keyof ConnectApi>([
  'listPosts',
  'listStudents',
  'getProfile',
  'counts',
  'connectionStatus',
  'isBlocked',
  'listConnections',
  'getPost',
  'listSaved',
  'getConversation',
  'listLessons',
  'getLesson',
  'getBriefs',
]);
// Reads that must always be fresh (polling, auth)
const LIVE = new Set<keyof ConnectApi>([
  'session',
  'subscribe',
  'presence',
  'listComments',
  'me',
  'onAuthChange',
  'listMessages',
  'listConversations',
  'listRequests',
  'unreadCount',
  'unreadMessageCount',
  'listNotices',
  'markRead',
  'markDelivered',
  'myAssignments',
  'reviewQueue',
  'teamDevices',
  'claimDevice',
  'checkDevice',
  'groupInfo',
  'listGroupMessages',
  'groupPreview',
  'markGroupRead',
  'groupLastRead',
  'groupStatus',
  'groupRemoved',
]);

const TTL = 45_000;

/* What was shown last time, so a screen can open with it straight away and
   then quietly swap in the fresh copy. Public things (posts, members,
   profiles, your own profile) are kept on this device between visits;
   private things (chats) only while the app is open. */
const KEEP = new Set<string>(['listLessons', 'listPosts', 'listStudents', 'getProfile', 'counts', 'getPost', 'me']);
const LAST_TOO = new Set<string>(['groupPreview', 'listGroupMessages', 'groupInfo', 'getLesson', 'listRequests', 'listConversations', 'listMessages', 'listConnections', 'listNotices', 'listSaved', 'getConversation', 'connectionStatus', 'isBlocked']);
const SAVE_KEY = 'cx-last-v1';
const last = new Map<string, unknown>();
let saveTimer = 0;
const k = (name: string, args: unknown[]) => `${name}:${JSON.stringify(args)}`;

try {
  const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(SAVE_KEY) : null;
  if (raw) for (const [key, v] of JSON.parse(raw) as [string, unknown][]) last.set(key, v);
} catch {
  /* nothing saved, or storage blocked */
}

function save() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      const keep = [...last].filter(([key]) => KEEP.has(key.slice(0, key.indexOf(':'))));
      let json = JSON.stringify(keep);
      // stay well inside the browser's storage limit
      while (json.length > 900_000 && keep.length) {
        keep.shift();
        json = JSON.stringify(keep);
      }
      localStorage.setItem(SAVE_KEY, json);
    } catch {
      /* storage full or blocked: memory still works */
    }
  }, 400);
}

function remember(name: string, args: unknown[], value: unknown) {
  const key = k(name, args);
  last.delete(key); // newest last, so the oldest is dropped first when trimming
  last.set(key, value);
  if (name === 'me') {
    // a different person signed in on this device: forget the previous one's things
    const prev = last.get('owner');
    const id = (value as { id?: string } | null)?.id ?? null;
    if (prev !== undefined && prev !== id) {
      for (const key2 of [...last.keys()]) if (!key2.startsWith('me:')) last.delete(key2);
    }
    last.set('owner', id);
  }
  if (KEEP.has(name)) save();
}

/** The last result of this read, if there is one. Use it as a screen's starting state. */
export function peek<T>(name: string, ...args: unknown[]): T | undefined {
  return last.get(k(name, args)) as T | undefined;
}

/** Forget everything (on sign out). */
export function forget() {
  last.clear();
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}

export function withCache(api: ConnectApi): ConnectApi {
  const store = new Map<string, { at: number; value: Promise<unknown> }>();
  // After a change, cached reads are re-fetched next time, but the last
  // result stays available to peek() so screens don't go blank.
  const clear = () => store.clear();
  const track = (name: string, args: unknown[], value: Promise<unknown>) => {
    value.then((v) => remember(name, args, v)).catch(() => {});
    return value;
  };

  return new Proxy(api, {
    get(target, prop: string | symbol, receiver) {
      const fn = Reflect.get(target, prop, receiver) as unknown;
      if (typeof fn !== 'function') return fn;
      const name = prop as keyof ConnectApi;
      if (CACHED.has(name)) {
        return (...args: unknown[]) => {
          const key = `${String(name)}:${JSON.stringify(args)}`;
          const hit = store.get(key);
          if (hit && Date.now() - hit.at < TTL) return hit.value;
          const value = track(String(name), args, (fn as (...a: unknown[]) => Promise<unknown>).apply(target, args));
          store.set(key, { at: Date.now(), value });
          // a failed read shouldn't stick
          value.catch(() => store.delete(key));
          return value;
        };
      }
      if (name === 'signOut') {
        return (...args: unknown[]) => {
          clear();
          forget();
          forgetDevice();
          return (fn as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      if (LIVE.has(name)) {
        if (name === 'me' || LAST_TOO.has(String(name)))
          return (...args: unknown[]) => track(String(name), args, (fn as (...a: unknown[]) => Promise<unknown>).apply(target, args));
        return (fn as (...a: unknown[]) => unknown).bind(target);
      }
      // Everything else changes something: forget cached reads after it
      return (...args: unknown[]) => {
        const out = (fn as (...a: unknown[]) => unknown).apply(target, args);
        clear();
        if (out && typeof (out as Promise<unknown>).then === 'function') (out as Promise<unknown>).finally(clear).catch(() => {});
        return out;
      };
    },
  });
}
