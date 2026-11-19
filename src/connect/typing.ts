'use client';
/* "typing…" like WhatsApp. Nothing is saved: while someone types, their phone
   sends a small live signal every couple of seconds; it fades after 5 seconds
   without one, or straight away when they send or clear the box.
   Rooms: 'u:<person id>' (their private chats), 'g:main' (the community group),
   'g:<group id>' (one of the Grand Sensei's groups). */

import { useEffect, useRef, useState } from 'react';
import type { ConnectApi, TypingSignal } from './types';

const FADE = 5000;
// chat -> person id -> who and until when
const typing = new Map<string, Map<string, { name: string; until: number }>>();
const watchers = new Set<() => void>();
const notify = () => watchers.forEach((f) => f());

function receive(t: TypingSignal, me: string | undefined) {
  if (!t || t.id === me) return;
  const people = typing.get(t.chat) ?? new Map();
  if (t.on) people.set(t.id, { name: t.name, until: Date.now() + FADE });
  else people.delete(t.id);
  typing.set(t.chat, people);
  notify();
  if (t.on) window.setTimeout(notify, FADE + 50);
}

/** Listen to a room while the component is on screen */
export function useTypingRoom(api: ConnectApi, room: string | null, me: string | undefined) {
  useEffect(() => {
    if (!room || !me) return;
    return api.typingListen(room, (t) => receive(t, me));
  }, [api, room, me]);
}

/** Names of the people typing in this chat right now (not me) */
export function useTyping(chat: string | null): string[] {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick((n) => n + 1);
    watchers.add(f);
    return () => {
      watchers.delete(f);
    };
  }, []);
  if (!chat) return [];
  const now = Date.now();
  return [...(typing.get(chat)?.values() ?? [])].filter((p) => p.until > now).map((p) => p.name);
}

/** Tells the room I'm typing while the draft changes; stops when it's sent or cleared */
export function useTypingSender(api: ConnectApi, room: string | null, chat: string | null, me: { id: string; name: string } | null | undefined, draft: string) {
  const last = useRef(0);
  const on = useRef(false);
  useEffect(() => {
    if (!room || !chat || !me) return;
    const now = Date.now();
    if (draft.trim()) {
      if (now - last.current > 2500) {
        last.current = now;
        on.current = true;
        api.typingSend(room, { chat, id: me.id, name: me.name, on: true });
      }
    } else if (on.current) {
      on.current = false;
      last.current = 0;
      api.typingSend(room, { chat, id: me.id, name: me.name, on: false });
    }
  }, [draft, room, chat, me?.id]);
  // leaving the chat mid-sentence
  useEffect(
    () => () => {
      if (on.current && room && chat && me) api.typingSend(room, { chat, id: me.id, name: me.name, on: false });
    },
    [room, chat, me?.id],
  );
}

/** "Tunde is typing…", "Tunde and Kemi are typing…", "3 people are typing…" */
export function typingLine(names: string[]) {
  const first = names.map((n) => n.trim().split(/\s+/)[0]);
  if (!first.length) return '';
  if (first.length === 1) return `${first[0]} is typing…`;
  if (first.length === 2) return `${first[0]} and ${first[1]} are typing…`;
  return `${first.length} people are typing…`;
}
