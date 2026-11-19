'use client';
/* "Add Connect to your home screen", shown now and then.
   Android/Chrome: the browser's own install box. iPhone: how to do it from
   Safari's Share menu (Apple has no install button for sites).
   Not shown once Connect is on the home screen. "Not now" waits 5 days. */

import React, { useEffect, useState } from 'react';

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallEvent;
    listeners.forEach((f) => f());
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    listeners.forEach((f) => f());
  });
}

const KEY = 'cx-install-later';
const WAIT = 5 * 864e5;
const installed = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
const iPhone = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios|edgios/i.test(navigator.userAgent);
const later = () => {
  try {
    return Date.now() - Number(localStorage.getItem(KEY) || 0) < WAIT;
  } catch {
    return true;
  }
};

export function InstallPrompt({ when }: { when: boolean }) {
  const [show, setShow] = useState<'android' | 'ios' | null>(null);
  useEffect(() => {
    if (!when || installed() || later()) return;
    const check = () => setShow(deferred ? 'android' : iPhone() ? 'ios' : null);
    // give the page a moment before asking
    const t = window.setTimeout(check, 4000);
    listeners.add(check);
    return () => {
      window.clearTimeout(t);
      listeners.delete(check);
    };
  }, [when]);
  if (!show) return null;
  const close = () => {
    try {
      localStorage.setItem(KEY, String(Date.now()));
    } catch {
      /* storage blocked */
    }
    setShow(null);
  };
  const add = async () => {
    if (!deferred) return close();
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    deferred = null;
    if (outcome !== 'accepted') close();
    else setShow(null);
  };
  return (
    <div className="cx-install" role="dialog" aria-label="Add Connect to your home screen">
      <img src="/assets/icon-192.png" alt="" width={44} height={44} />
      <div className="cx-install-text">
        <b>Add Connect to your home screen</b>
        {show === 'ios' ? (
          <span>
            In Safari, tap <em>Share</em>, then <em>Add to Home Screen</em>.
          </span>
        ) : (
          <span>It opens like an app and gets message alerts.</span>
        )}
      </div>
      <div className="cx-install-btns">
        <button type="button" className="btn btn-light btn-sm" onClick={close}>
          {show === 'ios' ? 'OK' : 'Not now'}
        </button>
        {show === 'android' && (
          <button type="button" className="btn btn-primary btn-sm" onClick={add}>
            Add
          </button>
        )}
      </div>
    </div>
  );
}
