'use client';
/* A small client router for Connect.
   - On connect.joinmotiondojo.com paths are clean: /students, /u/ada
   - On the main domain they live under /connect: /connect/students
   - In the preview build it runs on the URL hash: #/students */

import { useEffect, useState, type MouseEvent } from 'react';

export type Route =
  | { name: 'feed' }
  | { name: 'students'; tab?: 'challenge' | 'members' | 'projects' }
  | { name: 'challenge'; id: string }
  | { name: 'profile'; handle: string }
  | { name: 'post'; id: string }
  | { name: 'messages' }
  | { name: 'chat'; id: string }
  | { name: 'login'; team?: boolean }
  | { name: 'settings' }
  | { name: 'new' }
  | { name: 'connections' }
  | { name: 'notifications' }
  | { name: 'saved' }
  | { name: 'learn' }
  | { name: 'lesson'; id: string }
  | { name: 'lesson-edit'; id?: string }
  | { name: 'assignment'; phase: number }
  | { name: 'reviews' }
  | { name: 'devices' }
  | { name: 'group'; gid?: string }
  | { name: 'group-info'; gid?: string }
  | { name: 'join'; token: string }
  | { name: 'appearance' }
  | { name: 'notfound' };

const hashMode = () => typeof window !== 'undefined' && Boolean((window as unknown as { __CONNECT_HASH__?: boolean }).__CONNECT_HASH__);
const prefix = () =>
  typeof window !== 'undefined' && !hashMode() && window.location.pathname.startsWith('/connect') ? '/connect' : '';

function currentPath() {
  if (hashMode()) return window.location.hash.replace(/^#/, '') || '/';
  const p = window.location.pathname.replace(/^\/connect(?=\/|$)/, '');
  return p || '/';
}

export function parse(path: string): Route {
  const parts = path.split('?')[0].split('/').filter(Boolean).map(decodeURIComponent);
  const [a, b] = parts;
  if (!a) return { name: 'feed' };
  if (a === 'students' && !b) return { name: 'students', tab: 'challenge' };
  if (a === 'students' && (b === 'members' || b === 'projects')) return { name: 'students', tab: b };
  if (a === 'challenge' && b) return { name: 'challenge', id: b };
  if (a === 'u' && b) return { name: 'profile', handle: b };
  if (a === 'p' && b) return { name: 'post', id: b };
  if (a === 'messages' && b === 'g' && parts[2]) return parts[3] === 'info' ? { name: 'group-info', gid: parts[2] } : { name: 'group', gid: parts[2] };
  if (a === 'join' && b) return { name: 'join', token: b };
  if (a === 'messages' && b === 'group') return parts[2] === 'info' ? { name: 'group-info' } : { name: 'group' };
  if (a === 'messages') return b ? { name: 'chat', id: b } : { name: 'messages' };
  if (a === 'login') return { name: 'login' };
  if (a === 'team' && !b) return { name: 'login', team: true };
  if (a === 'settings') return { name: 'settings' };
  if (a === 'new') return { name: 'new' };
  if (a === 'connections') return { name: 'connections' };
  if (a === 'notifications') return { name: 'notifications' };
  if (a === 'saved') return { name: 'saved' };
  if (a === 'reviews') return { name: 'reviews' };
  if (a === 'devices') return { name: 'devices' };
  if (a === 'appearance') return { name: 'appearance' };
  if (a === 'learn') {
    if (!b) return { name: 'learn' };
    if (b === 'new') return { name: 'lesson-edit' };
    if (b === 'assignment' && /^[1-4]$/.test(parts[2] ?? '')) return { name: 'assignment', phase: Number(parts[2]) };
    if (parts[2] === 'edit') return { name: 'lesson-edit', id: b };
    return { name: 'lesson', id: b };
  }
  return { name: 'notfound' };
}

/** Turns an app path ("/u/ada") into a real href for the current host */
export function to(path: string) {
  if (hashMode()) return `#${path}`;
  return `${prefix()}${path === '/' && prefix() ? '' : path}` || '/';
}

export function navigate(path: string) {
  if (hashMode()) {
    window.location.hash = path;
  } else {
    window.history.pushState({}, '', to(path));
    window.dispatchEvent(new PopStateEvent('popstate'));
  }
  window.scrollTo({ top: 0 });
}

export function useRoute(): Route | null {
  const [route, setRoute] = useState<Route | null>(null);
  useEffect(() => {
    const update = () => setRoute(parse(currentPath()));
    update();
    window.addEventListener('popstate', update);
    window.addEventListener('hashchange', update);
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener('hashchange', update);
    };
  }, []);
  return route;
}

/** Intercepts clicks on internal links so pages switch without a reload */
export function onLinkClick(e: MouseEvent<HTMLAnchorElement>, path: string) {
  if (hashMode() || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  navigate(path);
}
