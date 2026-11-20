'use client';
/* Installed app (opened from the home screen): the keyboard slides over the
   page instead of shrinking the window. Shrinking showed a flash of the app's
   fixed background colour every time the keyboard opened. The height the
   keyboard covers is kept in --kb, and the page makes room for it. In a normal
   browser tab nothing changes. */

import { useEffect } from 'react';

type VirtualKeyboard = EventTarget & { overlaysContent: boolean; boundingRect: DOMRect };
let covered = 0;

/** Height the keyboard covers right now (0 outside the installed app) */
export const keyboardOver = () => covered;

export function useKeyboardOverlay() {
  useEffect(() => {
    const vk = (navigator as Navigator & { virtualKeyboard?: VirtualKeyboard }).virtualKeyboard;
    const installed = window.matchMedia('(display-mode: standalone)').matches;
    if (!vk || !installed) return;
    const root = document.documentElement;
    vk.overlaysContent = true;
    // the page moves with the keyboard (see .cx-kb-overlay in the styles)
    root.classList.add('cx-kb-overlay');
    const change = () => {
      covered = Math.round(vk.boundingRect.height);
      root.style.setProperty('--kb', `${covered}px`);
      root.classList.toggle('cx-kb-open', covered > 0);
      window.dispatchEvent(new Event('cx:keyboard'));
      // keep what you're typing in view
      const el = document.activeElement as HTMLElement | null;
      if (covered > 0 && el && /^(INPUT|TEXTAREA)$/.test(el.tagName)) {
        requestAnimationFrame(() => {
          const r = el.getBoundingClientRect();
          const room = window.innerHeight - covered;
          if (r.bottom > room - 12) window.scrollBy({ top: r.bottom - room + 24 });
        });
      }
    };
    vk.addEventListener('geometrychange', change);
    return () => {
      vk.removeEventListener('geometrychange', change);
      vk.overlaysContent = false;
      covered = 0;
      root.style.removeProperty('--kb');
      root.classList.remove('cx-kb-open', 'cx-kb-overlay');
    };
  }, []);
}
