/* Who's online. One shared list for the whole app, fed by api.presence(). */
import { useEffect, useState } from 'react';
import type { ConnectApi } from './types';

let online = new Set<string>();
const leftAt = new Map<string, number>();
const listeners = new Set<() => void>();

export function startPresence(api: ConnectApi) {
  const stop = api.presence((ids) => {
    const now = Date.now();
    online.forEach((id) => !ids.has(id) && leftAt.set(id, now));
    online = ids;
    listeners.forEach((f) => f());
  });
  return () => {
    stop();
    online = new Set();
    listeners.forEach((f) => f());
  };
}

export function useOnline(id: string | undefined) {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick((n) => n + 1);
    listeners.add(f);
    return () => {
      listeners.delete(f);
    };
  }, []);
  return Boolean(id && online.has(id));
}

/** "Online", "Last seen today at 9:14 AM", "Last seen yesterday at…", or "Offline" */
export function presenceLabel(isOnline: boolean, id: string, lastSeen?: string | null) {
  if (isOnline) return 'Online';
  const t = Math.max(lastSeen ? new Date(lastSeen).getTime() : 0, leftAt.get(id) ?? 0);
  if (!t) return 'Offline';
  const d = new Date(t);
  const mins = (Date.now() - t) / 60000;
  if (mins < 1.5) return 'Last seen just now';
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return `Last seen today at ${time}`;
  if (d.toDateString() === y.toDateString()) return `Last seen yesterday at ${time}`;
  if (mins < 7 * 24 * 60) return `Last seen ${d.toLocaleDateString([], { weekday: 'long' })} at ${time}`;
  return `Last seen ${d.toLocaleDateString([], { day: 'numeric', month: 'short' })}`;
}
