/* Makes moving between pages instant: reads are kept for a short while and
   reused, so going back to the feed or a profile doesn't wait on the
   network again. Any change (post, like, connect, message...) clears the
   cache, so nothing shown is out of date after you act. */

import type { ConnectApi } from './types';

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
]);

const TTL = 45_000;

export function withCache(api: ConnectApi): ConnectApi {
  const store = new Map<string, { at: number; value: Promise<unknown> }>();
  const clear = () => store.clear();

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
          const value = (fn as (...a: unknown[]) => Promise<unknown>).apply(target, args);
          store.set(key, { at: Date.now(), value });
          // a failed read shouldn't stick
          value.catch(() => store.delete(key));
          return value;
        };
      }
      if (LIVE.has(name)) return (fn as (...a: unknown[]) => unknown).bind(target);
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
