'use client';
/* Bars across the top of every screen: a call you've shrunk ("Tap to return")
   and the voice note that's playing. The call bar is put in here by the call
   screen itself. Their height is shared as --cx-bars so chats fit below them. */
import { useEffect, useRef } from 'react';
import { navigate } from './router';
import { Icon } from './ui';
import { useVn, vnStop, vnToggle } from './vn';

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function VnBar() {
  const vn = useVn();
  const t = vn.track;
  if (!t) return null;
  // in the chat it came from, the message itself shows it playing
  const here = window.location.pathname + window.location.hash === t.path;
  if (here) return null;
  const pct = vn.len ? Math.min(100, (vn.at / vn.len) * 100) : 0;
  const go = () => {
    const u = new URL(t.path, window.location.origin);
    if (u.hash) window.location.hash = u.hash;
    else navigate(u.pathname.replace(/^\/connect(?=\/|$)/, '') || '/');
  };
  return (
    <div className="cx-vn-bar" style={{ '--p': `${pct}%` } as React.CSSProperties}>
      <button type="button" className="cx-vn-play" onClick={() => vnToggle(t)} aria-label={vn.playing ? 'Pause voice message' : 'Play voice message'}>
        <Icon name={vn.playing ? 'pause' : 'play'} size={18} filled={!vn.playing} />
      </button>
      <button type="button" className="cx-vn-who" onClick={go}>
        <b>{t.who}</b>
        <small>Voice message · {clock(vn.at)}{vn.len ? ` / ${clock(vn.len)}` : ''}</small>
      </button>
      <button type="button" className="cx-vn-close" onClick={vnStop} aria-label="Stop voice message">
        <Icon name="close" size={18} />
      </button>
    </div>
  );
}

export function TopBars() {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const set = () => document.documentElement.style.setProperty('--cx-bars', `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.setProperty('--cx-bars', '0px');
    };
  }, []);
  return (
    <div id="cx-bars" className="cx-bars" ref={box}>
      <VnBar />
    </div>
  );
}
