'use client';
/* "Delete for me": the message disappears on your phone only; everyone else
   still sees it. Kept on this phone, per account. */

import { useCallback, useState } from 'react';

const key = (uid: string) => `cx-hidden-${uid}`;
const load = (uid?: string | null): Set<string> => {
  if (!uid) return new Set();
  try {
    return new Set(JSON.parse(localStorage.getItem(key(uid)) || '[]') as string[]);
  } catch {
    return new Set();
  }
};

export function useHidden(uid?: string | null) {
  const [hidden, setHidden] = useState(() => load(uid));
  const hide = useCallback(
    (id: string) => {
      if (!uid) return;
      setHidden((cur) => {
        const next = new Set(cur).add(id);
        try {
          // the last 2,000 are plenty
          localStorage.setItem(key(uid), JSON.stringify([...next].slice(-2000)));
        } catch {
          /* storage full or blocked: hidden until the app reloads */
        }
        return next;
      });
    },
    [uid],
  );
  return { hidden, hide };
}
