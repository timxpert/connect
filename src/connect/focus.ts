'use client';
/* Strict focus mode: the student picks how long to study; until they've
   watched that much, the rest of Connect is locked. Only time spent watching
   counts (a YouTube lesson must be playing; other videos count while the
   lesson is open on screen). Kept on the phone, so reopening Connect doesn't
   undo it. */

import { useEffect, useState } from 'react';

export type Focus = { goal: number; watched: number; started: number };
const KEY = 'cx-focus';
let focus: Focus | null = null;
try {
  focus = typeof localStorage !== 'undefined' ? (JSON.parse(localStorage.getItem(KEY) || 'null') as Focus | null) : null;
} catch {
  focus = null;
}
// a session never lasts past a day (so no one is stuck if lessons run out)
if (focus && Date.now() - focus.started > 24 * 3600 * 1000) focus = null;
const subs = new Set<() => void>();
// tells the notification worker whether a study session is on (so alerts arrive silently)
let toldWorker: boolean | null = null;
const tellWorker = () => {
  const on = Boolean(focus);
  if (on === toldWorker || typeof caches === 'undefined') return;
  toldWorker = on;
  caches
    .open('cx-state')
    .then((c) => c.put('/__focus', new Response(on ? '1' : '0')))
    .catch(() => {});
};
const save = () => {
  tellWorker();
  try {
    if (focus) localStorage.setItem(KEY, JSON.stringify(focus));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage blocked */
  }
  subs.forEach((f) => f());
};

export const getFocus = () => focus;
export function startFocus(minutes: number) {
  focus = { goal: minutes * 60, watched: 0, started: Date.now() };
  save();
}
export function endFocus() {
  focus = null;
  save();
}
/** One more second watched; true when the goal is reached */
export function addWatched(secs: number) {
  if (!focus) return false;
  focus = { ...focus, watched: Math.min(focus.goal, focus.watched + secs) };
  const done = focus.watched >= focus.goal;
  if (done) focus = null;
  save();
  return done;
}

/* YouTube lessons report whether they're playing */
let players = 0;
let playing = 0;
export function playerMounted() {
  players += 1;
  return () => {
    players -= 1;
  };
}
export function setPlaying(on: boolean, was: boolean) {
  if (on && !was) playing += 1;
  if (!on && was) playing = Math.max(0, playing - 1);
}
/** Is a lesson video playing right now (or, without a YouTube player, is a lesson open) */
export const watchingNow = () => (players > 0 ? playing > 0 : true);

export function useFocus() {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick((n) => n + 1);
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  }, []);
  return focus;
}

export const left = (f: Focus) => {
  const s = Math.max(0, f.goal - f.watched);
  const m = Math.floor(s / 60);
  if (m >= 60) return m % 60 ? `${Math.floor(m / 60)} hr ${m % 60} min` : `${m / 60} hr`;
  return s >= 60 ? `${Math.ceil(s / 60)} min` : `${s} sec`;
};
