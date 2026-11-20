'use client';
/* Keyboard check (hidden): tap "Messages" five times to turn it on or off.
   A small panel at the top shows what the phone reports while the keyboard
   opens, so a screenshot tells us why it flashes or covers the message box. */

import React, { useEffect, useState } from 'react';
import { keyboardOver } from './keyboard';

const KEY = 'cx-kb-debug';
export const kbCheckOn = () => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};
export function toggleKbCheck() {
  try {
    if (kbCheckOn()) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, '1');
  } catch {
    /* storage blocked */
  }
  window.dispatchEvent(new Event('cx:kbcheck'));
}

type VK = EventTarget & { overlaysContent: boolean; boundingRect: DOMRect };

export function KeyboardCheck() {
  const [on, setOn] = useState(kbCheckOn);
  const [, tick] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  useEffect(() => {
    const t = () => setOn(kbCheckOn());
    window.addEventListener('cx:kbcheck', t);
    return () => window.removeEventListener('cx:kbcheck', t);
  }, []);
  useEffect(() => {
    if (!on) return;
    const t0 = performance.now();
    const add = (what: string) => setLog((l) => [...l.slice(-7), `${Math.round(performance.now() - t0)}ms ${what}`]);
    const vv = window.visualViewport;
    const vk = (navigator as Navigator & { virtualKeyboard?: VK }).virtualKeyboard;
    const onVv = () => add(`viewport ${Math.round(vv?.height ?? 0)} inner ${window.innerHeight}`);
    const onVk = () => add(`keyboard ${Math.round(vk?.boundingRect.height ?? 0)}`);
    const onFocus = (e: FocusEvent) => add(`focus ${(e.target as HTMLElement)?.tagName ?? ''}`);
    vv?.addEventListener('resize', onVv);
    vk?.addEventListener('geometrychange', onVk);
    window.addEventListener('focusin', onFocus);
    const t = window.setInterval(() => tick((n) => n + 1), 300);
    return () => {
      vv?.removeEventListener('resize', onVv);
      vk?.removeEventListener('geometrychange', onVk);
      window.removeEventListener('focusin', onFocus);
      window.clearInterval(t);
    };
  }, [on]);
  if (!on) return null;
  const vk = (navigator as Navigator & { virtualKeyboard?: VK }).virtualKeyboard;
  const root = document.documentElement;
  const chrome = /Chrome\/(\d+)/.exec(navigator.userAgent)?.[1] ?? '?';
  const lines = [
    `installed: ${window.matchMedia('(display-mode: standalone)').matches ? 'yes' : 'no'} · Chrome ${chrome}`,
    `keyboard API: ${vk ? 'yes' : 'no'} · overlay: ${vk ? String(vk.overlaysContent) : '-'} · class: ${root.classList.contains('cx-kb-overlay') ? 'on' : 'off'}`,
    `keyboard now: ${vk ? Math.round(vk.boundingRect.height) : '-'} · app thinks: ${keyboardOver()}`,
    `viewport: ${Math.round(window.visualViewport?.height ?? 0)} · inner: ${window.innerHeight} · screen: ${window.screen.height}`,
    `chat height: ${root.style.getPropertyValue('--vvh') || '-'}`,
    `meta: ${document.querySelector('meta[name=viewport]')?.getAttribute('content') ?? ''}`,
  ];
  return (
    <div className="cx-kbcheck" aria-hidden="true">
      {lines.map((l) => (
        <div key={l.slice(0, 12)}>{l}</div>
      ))}
      <hr />
      {log.map((l, i) => (
        <div key={i}>{l}</div>
      ))}
    </div>
  );
}
