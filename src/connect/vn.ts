'use client';
/* One voice-note player for the whole app. The sound lives here, not inside
   the chat, so a voice note keeps playing when you leave the chat, open
   another one, or switch to a call. A bar at the top shows what's playing. */
import { useEffect, useState } from 'react';

export type VnTrack = { id: string; src: string; who: string; path: string; duration?: number | null };
export type VnState = { track: VnTrack | null; playing: boolean; at: number; len: number };

let audio: HTMLAudioElement | null = null;
let state: VnState = { track: null, playing: false, at: 0, len: 0 };
const subs = new Set<() => void>();
const emit = (next: Partial<VnState>) => {
  state = { ...state, ...next };
  subs.forEach((f) => f());
};

function el() {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = 'auto';
  audio.addEventListener('play', () => emit({ playing: true }));
  audio.addEventListener('pause', () => emit({ playing: false }));
  audio.addEventListener('timeupdate', () => emit({ at: audio!.currentTime }));
  audio.addEventListener('loadedmetadata', () => {
    const d = audio!.duration;
    if (Number.isFinite(d) && d > 0) emit({ len: d });
  });
  audio.addEventListener('ended', () => emit({ playing: false, at: 0, track: null }));
  return audio;
}

/** Play or pause this voice note (any other one stops) */
export function vnToggle(t: VnTrack) {
  const a = el();
  if (state.track?.id === t.id) {
    if (a.paused) a.play().catch(() => {});
    else a.pause();
    return;
  }
  a.pause();
  a.src = t.src;
  emit({ track: t, at: 0, len: t.duration ?? 0, playing: false });
  a.play().catch(() => {});
}
export function vnSeek(id: string, to: number) {
  if (state.track?.id !== id || !audio) return;
  audio.currentTime = to;
  emit({ at: to });
}
export function vnStop() {
  audio?.pause();
  emit({ track: null, playing: false, at: 0 });
}
export function useVn() {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick((n) => n + 1);
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  }, []);
  return state;
}
