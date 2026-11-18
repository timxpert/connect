/* Appearance: light or dark, the colour of your chat bubbles and the chat
   wallpaper. Saved on this device (like WhatsApp), so each phone can look
   the way its owner likes. */

import { useEffect, useState } from 'react';

export type ThemeChoice = 'light' | 'dark' | 'system';
export type ChatColor = 'violet' | 'midnight' | 'lime' | 'ocean' | 'rose' | 'sunset' | 'forest';
export type Wallpaper = 'plain' | 'lavender' | 'mint' | 'sky' | 'peach' | 'night' | 'photo';
export type Pattern = 'none' | 'dots' | 'keyframes';

export type Appearance = { theme: ThemeChoice; chat: ChatColor; wall: Wallpaper; pattern: Pattern; photo: string | null };

const KEY = 'cx-appearance-v1';
const PHOTO = 'cx-wallpaper-photo';
const EVENT = 'cx:appearance';
const DEFAULT: Appearance = { theme: 'light', chat: 'violet', wall: 'plain', pattern: 'none', photo: null };

/** Your bubble colour, its text, the time stamp and the "seen" tick */
export const CHAT_COLORS: Record<ChatColor, { label: string; bg: string; ink: string; meta: string; seen: string }> = {
  violet: { label: 'Violet', bg: '#6d32e8', ink: '#ffffff', meta: 'rgba(255,255,255,.75)', seen: '#c8ff3d' },
  midnight: { label: 'Midnight', bg: '#241446', ink: '#ffffff', meta: 'rgba(255,255,255,.7)', seen: '#c8ff3d' },
  lime: { label: 'Lime', bg: '#c8ff3d', ink: '#140a2e', meta: 'rgba(20,10,46,.6)', seen: '#6d32e8' },
  ocean: { label: 'Ocean', bg: '#1d63d8', ink: '#ffffff', meta: 'rgba(255,255,255,.75)', seen: '#c8ff3d' },
  rose: { label: 'Rose', bg: '#d6336c', ink: '#ffffff', meta: 'rgba(255,255,255,.75)', seen: '#ffe066' },
  sunset: { label: 'Sunset', bg: '#ef6c1a', ink: '#ffffff', meta: 'rgba(255,255,255,.8)', seen: '#140a2e' },
  forest: { label: 'Forest', bg: '#1f7a4c', ink: '#ffffff', meta: 'rgba(255,255,255,.75)', seen: '#c8ff3d' },
};

export const WALLPAPERS: { id: Wallpaper; label: string }[] = [
  { id: 'plain', label: 'Plain' },
  { id: 'lavender', label: 'Lavender' },
  { id: 'mint', label: 'Mint' },
  { id: 'sky', label: 'Sky' },
  { id: 'peach', label: 'Peach' },
  { id: 'night', label: 'Night' },
];

export const PATTERNS: { id: Pattern; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'dots', label: 'Dots' },
  { id: 'keyframes', label: 'Keyframes' },
];

export function readAppearance(): Appearance {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<Appearance> & { wall?: string };
    // dots and keyframes used to be wallpapers; they're patterns now
    if (saved.wall === 'dots' || saved.wall === 'keyframes') {
      saved.pattern = saved.wall;
      saved.wall = 'plain';
    }
    const photo = localStorage.getItem(PHOTO);
    return { ...DEFAULT, ...saved, photo } as Appearance;
  } catch {
    return DEFAULT;
  }
}

export function saveAppearance(next: Partial<Appearance>) {
  const cur = readAppearance();
  const merged = { ...cur, ...next };
  try {
    const { photo, ...rest } = merged;
    localStorage.setItem(KEY, JSON.stringify(rest));
    if ('photo' in next) {
      if (photo) localStorage.setItem(PHOTO, photo);
      else localStorage.removeItem(PHOTO);
    }
  } catch {
    /* storage full or blocked: it still applies until the page reloads */
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: merged }));
  return merged;
}

/** The current appearance, kept up to date when it changes anywhere in the app */
export function useAppearance() {
  const [a, setA] = useState<Appearance>(DEFAULT);
  const [systemDark, setSystemDark] = useState(false);
  useEffect(() => {
    setA(readAppearance());
    const on = (e: Event) => setA((e as CustomEvent<Appearance>).detail);
    window.addEventListener(EVENT, on);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemDark(mq.matches);
    const onMq = () => setSystemDark(mq.matches);
    mq.addEventListener?.('change', onMq);
    return () => {
      window.removeEventListener(EVENT, on);
      mq.removeEventListener?.('change', onMq);
    };
  }, []);
  const dark = a.theme === 'dark' || (a.theme === 'system' && systemDark);
  return { ...a, dark };
}

/** Shrinks a photo for the wallpaper so it fits in the browser's storage */
export async function wallpaperFromFile(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1080 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.72);
}
