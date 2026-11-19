'use client';

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useConnect } from './context';
import { navigate } from './router';
import { play } from './sounds';
import { alertsUndecided, askForAlerts } from './alerts';
import { presenceLabel, useOnline } from './presence';
import { useDragToClose } from './drag';
import type { Attachment, Conversation, GroupRow, Message, Profile } from './types';
import { peek } from './cache';
import { A, Avatar, Empty, Icon, Loading, BeltBadge, type IconName } from './ui';
import { compressVideo, MAX_VIDEO_SECONDS, videoSeconds } from './compress';
import { ForwardSheet } from './forward';
import { CameraScreen } from './camera';
import { MessageField, Rich, loadDraft, smartChange, useDraft } from './format';
import { EmojiButton, EmojiSheet } from './emoji';
import { startCall } from './calls';
import { callLine, readCall } from './special';
import { typingLine, useTyping, useTypingRoom, useTypingSender } from './typing';
import { NewGroupSheet } from './group';

/* ------------------------------------------------------------------
   One conversation, WhatsApp-style:
   - Enter makes a new line; only the send button sends
   - Voice notes: tap the mic to record, then send or bin it
   - Photos, videos and files, kept in a private bucket
   - Ticks on your messages: one = sent, two grey = delivered,
     two lime = seen
   - Hold (or right-click) a message to copy, delete for everyone or report
   - Report and block from the ⋯ menu in the chat header
------------------------------------------------------------------- */

const MAX_FILE = 50 * 1024 * 1024; // Supabase free plan's per-file limit
export const MAX_VOICE_SECONDS = 5 * 60;

export const clock = (s: number) => {
  const t = Math.max(0, Math.round(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
const size = (b?: number | null) =>
  !b ? '' : b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(0.1, Math.round((b / 1024) * 10) / 10)} kB`;
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
/** Delete for everyone: up to 24 hours after sending while it's unseen, and 1 hour after it's seen */
const DM_EMOJI = ['👍', '❤️', '😂', '🔥', '👏', '🙏'];

export const canUnsend = (sentAt: string, seenAt?: string | null) =>
  seenAt ? Date.now() <= new Date(seenAt).getTime() + 3600_000 : Date.now() <= new Date(sentAt).getTime() + 24 * 3600_000;
export const TOO_LATE = 'You can delete a message for everyone within 24 hours, or within 1 hour once it’s been seen.';

export const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
};

const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|3gp|3g2|avi|wmv|mpe?g|ts)$/i;

/** What a picked file is. A video is always sent as a video (made smaller first),
    never as a document, even when the phone doesn't label it as one. */
/** The short label and colour for a document: PDF, DOC, XLS ... */
export function docType(name: string | null | undefined) {
  const ext = (name?.split('.').pop() || '').toLowerCase();
  const map: Record<string, [string, string]> = {
    pdf: ['PDF', '#d93b3b'],
    doc: ['DOC', '#2f6fde'], docx: ['DOC', '#2f6fde'], txt: ['TXT', '#5d5470'],
    xls: ['XLS', '#1f8a4c'], xlsx: ['XLS', '#1f8a4c'], csv: ['CSV', '#1f8a4c'],
    ppt: ['PPT', '#e0662a'], pptx: ['PPT', '#e0662a'],
    zip: ['ZIP', '#6b6478'], rar: ['RAR', '#6b6478'],
    aep: ['AE', '#7b5cff'], prproj: ['PR', '#7b5cff'], psd: ['PSD', '#1b8ad6'], ai: ['AI', '#f08a24'],
    mp3: ['MP3', '#c2357d'], m4a: ['M4A', '#c2357d'], wav: ['WAV', '#c2357d'],
  };
  const [label, color] = map[ext] ?? [ext ? ext.slice(0, 4).toUpperCase() : 'FILE', '#6b6478'];
  return { label, color };
}

const DOC_ACCEPT = 'application/*,text/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.txt,.zip,.rar,.aep,.prproj,.psd,.ai,.xml,image/*,video/*';

/** The menu behind the paperclip: photos and videos, camera, or a document.
    Pull it up (or tap Photos & videos) to open the phone's gallery. */
export function AttachSheet({
  open,
  onClose,
  onPick,
  documents = true,
  extra,
}: {
  /** More choices (the team's Poll and Live class) */
  extra?: { label: string; icon: IconName; color: string; onClick: () => void }[];
  open: boolean;
  onClose: () => void;
  /** asDocument: send photos as files (full quality). Videos are always sent as videos. */
  onPick: (files: FileList | File[], asDocument: boolean) => void;
  documents?: boolean;
}) {
  const gallery = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const doc = useRef<HTMLInputElement>(null);
  const [cam, setCam] = useState(false);
  const sheet = useDragToClose<HTMLDivElement>(onClose, open);
  const take = (asDocument: boolean) => (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) onPick(Array.from(e.target.files), asDocument);
    e.target.value = '';
    setCam(false);
    onClose();
  };
  const openGallery = () => gallery.current?.click();
  return (
    <>
      <input ref={gallery} type="file" multiple accept="image/*,video/*" className="sr-only" onChange={take(false)} />
      <input ref={camera} type="file" accept="image/*" capture="environment" className="sr-only" onChange={take(false)} />
      <input ref={doc} type="file" multiple accept={DOC_ACCEPT} className="sr-only" onChange={take(true)} />
      {open && (
        <div className="cx-sheet-wrap" onClick={onClose}>
          <div
            className="cx-sheet cx-drag cx-attach-sheet"
            role="menu"
            aria-label="Send"
            ref={sheet}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => {
              // pulled up: straight to the gallery (the finger soon leaves the sheet, so watch the whole page)
              const from = e.clientY;
              const move = (ev: PointerEvent) => {
                if (from - ev.clientY > 40) {
                  stop();
                  openGallery();
                }
              };
              const stop = () => {
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', stop);
                window.removeEventListener('pointercancel', stop);
              };
              window.addEventListener('pointermove', move);
              window.addEventListener('pointerup', stop);
              window.addEventListener('pointercancel', stop);
            }}
          >
            <span className="cx-grab" aria-hidden="true" />
            <div className="cx-attach-grid">
              <button type="button" role="menuitem" onClick={openGallery}>
                <span className="cx-attach-ico" style={{ background: '#6d32e8' }}>
                  <Icon name="image" size={24} />
                </span>
                Photos & videos
              </button>
              <button type="button" role="menuitem" onClick={() => (onClose(), setCam(true))}>
                <span className="cx-attach-ico" style={{ background: '#d6336c' }}>
                  <Icon name="camera" size={24} />
                </span>
                Camera
              </button>
              {documents && (
                <button type="button" role="menuitem" onClick={() => doc.current?.click()}>
                  <span className="cx-attach-ico" style={{ background: '#1d63d8' }}>
                    <Icon name="file" size={24} />
                  </span>
                  Document
                </button>
              )}
              {extra?.map((x) => (
                <button key={x.label} type="button" role="menuitem" onClick={() => (onClose(), x.onClick())}>
                  <span className="cx-attach-ico" style={{ background: x.color }}>
                    <Icon name={x.icon} size={24} />
                  </span>
                  {x.label}
                </button>
              ))}
            </div>
            <p className="cx-attach-hint">Pull up for your gallery</p>
          </div>
        </div>
      )}
      {cam && (
        <CameraScreen
          onClose={() => setCam(false)}
          onShot={(f) => {
            setCam(false);
            onPick([f], false);
          }}
          onFallback={() => {
            setCam(false);
            camera.current?.click();
          }}
          onGallery={openGallery}
        />
      )}
    </>
  );
}

export function kindOf(file: File): Attachment['kind'] {
  if (file.type.startsWith('image/') && file.type !== 'image/svg+xml') return 'image';
  if (file.type.startsWith('video/') || VIDEO_EXT.test(file.name)) return 'video';
  if (file.type.startsWith('audio/')) return 'voice';
  return 'file';
}

/* ---------- Ticks ---------- */
function Status({ m }: { m: Message }) {
  if (m.failed) return <span className="cx-tick is-failed">Not sent · tap to retry</span>;
  if (m.pending)
    return (
      <span className="cx-tick" aria-label="Sending">
        <Icon name="clock" size={14} />
      </span>
    );
  if (m.read_at)
    return (
      <span className="cx-tick is-seen" aria-label="Seen">
        <Icon name="ticks" size={17} />
      </span>
    );
  if (m.delivered_at)
    return (
      <span className="cx-tick" aria-label="Delivered">
        <Icon name="ticks" size={17} />
      </span>
    );
  return (
    <span className="cx-tick" aria-label="Sent">
      <Icon name="tick" size={15} />
    </span>
  );
}

/** "Missed voice call · Call back" in the chat */
function CallLine({ m, mine, onCall }: { m: Message; mine: boolean; onCall: (video: boolean) => void }) {
  const c = readCall(m.body);
  const missed = c?.status !== 'ended';
  return (
    <div className={missed && !mine ? 'cx-callline is-missed' : 'cx-callline'}>
      <span className="cx-callline-ico" aria-hidden="true">
        <Icon name={c?.video ? 'cam' : 'phone'} size={18} />
      </span>
      <span>{callLine(c, mine)}</span>
      <button type="button" onClick={(e) => (e.stopPropagation(), onCall(Boolean(c?.video)))}>
        Call back
      </button>
    </div>
  );
}

/* ---------- Message info (my messages in a private chat) ---------- */
const when = (iso: string) => {
  const d = dayLabel(iso);
  const t = new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d === 'Today' ? `Today, ${t}` : `${d}, ${t}`;
};
function MessageInfo({ m, onClose }: { m: Message; onClose: () => void }) {
  const { api } = useConnect();
  const sheet = useDragToClose<HTMLDivElement>(onClose);
  const [played, setPlayed] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (m.kind === 'voice') api.listPlays(m.id).then((l) => setPlayed(l.find((p) => p.user_id !== m.sender_id)?.played_at ?? null)).catch(() => setPlayed(null));
  }, [api, m.id, m.kind, m.sender_id]);
  const rows: [string, string | null | undefined][] = [
    ['Sent', m.created_at],
    ['Delivered', m.delivered_at],
    ['Seen', m.read_at],
    ...(m.kind === 'voice' ? ([['Played', played]] as [string, string | null | undefined][]) : []),
  ];
  return (
    <div className="cx-sheet-wrap" onClick={onClose}>
      <div className="cx-sheet cx-drag cx-info" role="dialog" aria-label="Message info" ref={sheet} onClick={(e) => e.stopPropagation()}>
        <span className="cx-grab" aria-hidden="true" />
        <h2 className="cx-fwd-title">Message info</h2>
        <p className="cx-seen-msg">{m.kind === 'voice' ? `Voice message${m.duration ? ` · ${clock(m.duration)}` : ''}` : m.body ? m.body.slice(0, 160) : m.kind === 'image' ? 'Photo' : m.kind === 'video' ? 'Video' : m.file_name || 'File'}</p>
        <ul className="cx-info-rows">
          {rows.map(([label, at]) => (
            <li key={label}>
              <span>{label}</span>
              <b>{at ? when(at) : at === undefined && label === 'Played' ? '…' : 'Not yet'}</b>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ---------- Voice note player ---------- */
function Voice({ src, duration, onFirstPlay }: { src: string | null | undefined; duration?: number | null; onFirstPlay?: () => void }) {
  const told = useRef(false);
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const [len, setLen] = useState(duration ?? 0);
  const toggle = () => {
    const a = audio.current;
    if (!a || !src) return;
    if (a.paused) {
      // only one voice note plays at a time
      document.querySelectorAll('audio').forEach((x) => x !== a && x.pause());
      a.play().catch(() => {});
      if (!told.current) {
        told.current = true;
        onFirstPlay?.();
      }
    } else a.pause();
  };
  return (
    <div className="cx-voice">
      <button type="button" className="cx-voice-btn" onClick={toggle} aria-label={playing ? 'Pause voice message' : 'Play voice message'} disabled={!src}>
        <Icon name={playing ? 'pause' : 'play'} size={18} filled={!playing} />
      </button>
      <input
        className="cx-voice-bar"
        type="range"
        min={0}
        max={len || 1}
        step={0.1}
        value={at}
        aria-label="Position"
        style={{ '--p': `${len ? (at / len) * 100 : 0}%` } as React.CSSProperties}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (audio.current) audio.current.currentTime = v;
          setAt(v);
        }}
      />
      <span className="cx-voice-time">{clock(playing || at ? at : len)}</span>
      {src && (
        <audio
          ref={audio}
          src={src}
          preload="none"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setAt(0);
          }}
          onTimeUpdate={(e) => setAt(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration;
            if (Number.isFinite(d) && d > 0) setLen(d);
          }}
        />
      )}
    </div>
  );
}

/* ---------- Media: tap to download, view inside Connect, save to the phone ---------- */
const DL_KEY = 'cx-downloaded';
export function loadDownloaded(): Set<string> {
  try {
    return new Set(JSON.parse(window.localStorage.getItem(DL_KEY) || '[]') as string[]);
  } catch {
    return new Set();
  }
}
export function rememberDownloaded(ids: Set<string>) {
  try {
    window.localStorage.setItem(DL_KEY, JSON.stringify([...ids].slice(-500)));
  } catch {
    /* private mode: remembered for this visit only */
  }
}

/* Files kept on this device after the first download (and files you sent),
   so tapping again opens them straight away instead of downloading again. */
const FILES = 'cx-files-v1';
const fileKey = (id: string) => `/cx-file/${id}`;
export async function keepFile(id: string, blob: Blob) {
  try {
    const c = await caches.open(FILES);
    await c.put(fileKey(id), new Response(blob, { headers: { 'Content-Type': blob.type || 'application/octet-stream' } }));
  } catch {
    /* no storage: it will download again when opened */
  }
}
export async function keptFile(id: string): Promise<Blob | null> {
  try {
    const r = await (await caches.open(FILES)).match(fileKey(id));
    return r ? await r.blob() : null;
  } catch {
    return null;
  }
}

/** First tap: downloads the file once (kept in Connect, and saved to Downloads on Android and computers) */
async function downloadFile(m: Message): Promise<boolean> {
  if (!m.media_url) return false;
  const res = await fetch(m.media_url);
  if (!res.ok) return false;
  const blob = await res.blob();
  await keepFile(m.id, blob);
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!ios) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileNameFor(m, blob.type);
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  return true;
}

/** Later taps: opens the copy on this device. The tab is opened first, inside the tap,
    so phones don't block it; it never shows where the file is stored. */
export async function openFile(m: Message, toast: (t: string) => void) {
  const win = window.open('', '_blank');
  try {
    let blob = await keptFile(m.id);
    if (!blob && m.media_url) {
      if (m.media_url.startsWith('blob:')) blob = await (await fetch(m.media_url)).blob();
      else {
        const res = await fetch(m.media_url);
        if (!res.ok) throw new Error();
        blob = await res.blob();
        await keepFile(m.id, blob);
      }
    }
    if (!blob) throw new Error();
    const file = new File([blob], fileNameFor(m, blob.type), { type: blob.type });
    const url = URL.createObjectURL(file);
    if (win) win.location.href = url;
    else window.location.assign(url);
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch {
    win?.close();
    toast('Couldn’t open it. Check your connection and try again.');
  }
}

const EXT: Record<string, string> = { image: 'jpg', video: 'mp4', voice: 'm4a', file: 'bin' };
export function fileNameFor(m: Message, type: string) {
  if (m.file_name && m.kind === 'file') return m.file_name;
  const ext = type.split('/')[1]?.replace('jpeg', 'jpg').replace('quicktime', 'mov').replace(/[^a-z0-9]/g, '') || EXT[m.kind ?? 'file'];
  const d = new Date(m.created_at);
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  return `MotionDojo-${stamp}.${ext}`;
}

/** Saves a chat file to the phone. iPhone: the share sheet ("Save Image" puts it in Photos).
    Android and computers: a normal download, which the gallery picks up from Downloads. */
export async function saveToPhone(m: Message, toast: (t: string) => void) {
  if (!m.media_url) return toast('Download it first.');
  try {
    const res = await fetch(m.media_url);
    if (!res.ok) throw new Error();
    const blob = await res.blob();
    const name = fileNameFor(m, blob.type);
    const file = new File([blob], name, { type: blob.type });
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
    if (ios && nav.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] });
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
    toast(m.kind === 'image' || m.kind === 'video' ? 'Saved. Find it in your gallery or Downloads.' : 'Saved to Downloads');
  } catch (e) {
    if ((e as Error).name !== 'AbortError') toast('Couldn’t save it. Check your connection and try again.');
  }
}

/** Full-screen photo viewer, inside Connect (no web address shown) */
export function Viewer({ m, onClose, onSave }: { m: Message; onClose: () => void; onSave: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  // swipe the photo down to close it
  const photo = useDragToClose<HTMLImageElement>(onClose, m.kind !== 'video');
  return (
    <div className="cx-viewer" role="dialog" aria-modal="true" aria-label="Photo" onClick={onClose}>
      <div className="cx-viewer-bar" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="cx-icon-btn cx-icon-flat" onClick={onClose} aria-label="Close">
          <Icon name="close" />
        </button>
        <button type="button" className="btn btn-light btn-sm" onClick={onSave}>
          <Icon name="download" size={18} /> Save
        </button>
      </div>
      {m.kind === 'video' ? (
        <video src={m.media_url ?? undefined} controls autoPlay playsInline onClick={(e) => e.stopPropagation()} />
      ) : (
        <img ref={photo} className="cx-drag" src={m.media_url ?? undefined} alt="" onClick={(e) => e.stopPropagation()} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------
   Before sending photos, videos or files: a review screen. Look at
   what you picked, drop any you don't want, add more, write a caption,
   then send. Nothing uploads until you tap send.
------------------------------------------------------------------- */
export type Picked = { key: string; file: File; kind: Attachment['kind']; url: string };

export function SendPreview({
  items,
  to,
  caption,
  onCaption,
  onRemove,
  onAdd,
  onClose,
  onSend,
}: {
  items: Picked[];
  to: string;
  caption: string;
  onCaption: (v: string) => void;
  onRemove: (key: string) => void;
  onAdd: () => void;
  onClose: () => void;
  onSend: () => void;
}) {
  const [at, setAt] = useState(0);
  const i = Math.min(at, items.length - 1);
  const cur = items[i];
  // videos are made smaller before sending, so only other files have a hard limit
  const tooBig = items.some((x) => x.kind !== 'video' && x.file.size > MAX_FILE);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    window.addEventListener('keydown', k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', k);
      document.body.style.overflow = prev;
    };
  }, []);
  if (!cur) return null;
  return (
    <div className="cx-pre" role="dialog" aria-modal="true" aria-label="Review before sending">
      <header className="cx-pre-bar">
        <button type="button" className="cx-icon-btn cx-icon-flat" onClick={onClose} aria-label="Cancel">
          <Icon name="close" />
        </button>
        <span className="cx-pre-title">
          <strong>{items.length === 1 ? cur.file.name : `${i + 1} of ${items.length}`}</strong>
          <small>{size(cur.file.size)}</small>
        </span>
        <button type="button" className="cx-icon-btn cx-icon-flat" onClick={() => onRemove(cur.key)} aria-label="Remove this one">
          <Icon name="trash" />
        </button>
      </header>

      <div className="cx-pre-stage">
        {cur.kind === 'image' ? (
          <img key={cur.key} src={cur.url} alt="" />
        ) : cur.kind === 'video' ? (
          <video key={cur.key} src={cur.url} controls playsInline preload="metadata" />
        ) : (
          <div className="cx-pre-file">
            <Icon name="file" size={40} />
            <strong>{cur.file.name}</strong>
            <span>{size(cur.file.size)}</span>
          </div>
        )}
      </div>

      <div className="cx-pre-foot">
        <ul className="cx-pre-strip" aria-label="Picked files">
          {items.map((x, n) => (
            <li key={x.key}>
              <button type="button" className={n === i ? 'is-on' : ''} onClick={() => setAt(n)} aria-label={`Show ${x.file.name}`}>
                {x.kind === 'image' ? (
                  <img src={x.url} alt="" />
                ) : x.kind === 'video' ? (
                  <video src={`${x.url}#t=0.1`} muted playsInline preload="metadata" />
                ) : (
                  <Icon name="file" size={20} />
                )}
              </button>
            </li>
          ))}
          {items.length < 10 && (
            <li>
              <button type="button" className="cx-pre-add" onClick={onAdd} aria-label="Add more">
                <Icon name="plus" size={20} />
              </button>
            </li>
          )}
        </ul>
        {tooBig && (
          <p className="cx-pre-warn" role="alert">
            Files can be up to 50 MB. Remove the large one to send.
          </p>
        )}
        <div className="cx-pre-send">
          <label className="sr-only" htmlFor="pre-caption">
            Caption
          </label>
          <textarea id="pre-caption" rows={1} maxLength={1000} placeholder="Add a caption" value={caption} onChange={(e) => onCaption(e.target.value)} />
          <button type="button" className="cx-send" disabled={tooBig} onClick={onSend} aria-label={`Send to ${to}`}>
            <Icon name="send" size={20} />
          </button>
        </div>
        <p className="cx-pre-to">To {to}</p>
      </div>
    </div>
  );
}

/** A tiny preview (about 40px wide, a few hundred bytes) to show blurred before download */
export async function makeThumb(file: File, kind: Attachment['kind']): Promise<string | undefined> {
  if (kind !== 'image' && kind !== 'video') return undefined;
  try {
    let source: CanvasImageSource;
    let w: number;
    let h: number;
    if (kind === 'image') {
      const bmp = await createImageBitmap(file);
      source = bmp;
      w = bmp.width;
      h = bmp.height;
    } else {
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.preload = 'auto';
      v.src = URL.createObjectURL(file);
      await new Promise<void>((ok, bad) => {
        const t = window.setTimeout(() => bad(new Error('timeout')), 4000);
        v.onloadeddata = () => {
          v.currentTime = Math.min(0.5, (v.duration || 1) / 2);
        };
        v.onseeked = () => {
          window.clearTimeout(t);
          ok();
        };
        v.onerror = () => bad(new Error('video'));
      });
      source = v;
      w = v.videoWidth;
      h = v.videoHeight;
      window.setTimeout(() => URL.revokeObjectURL(v.src), 1000);
    }
    if (!w || !h) return undefined;
    const tw = 64;
    const th = Math.max(1, Math.round((h / w) * tw));
    const c = document.createElement('canvas');
    c.width = tw;
    c.height = Math.min(th, 128);
    c.getContext('2d')!.drawImage(source, 0, 0, c.width, c.height);
    const url = c.toDataURL('image/jpeg', 0.6);
    return url.length <= 6000 ? url : undefined;
  } catch {
    return undefined;
  }
}

/** A private reply's quote: {name, text} from the group */
export function readQuote(q: string | null | undefined): { name: string; text: string; dm?: boolean } | null {
  if (!q) return null;
  try {
    const v = JSON.parse(q) as { name?: string; text?: string; dm?: boolean };
    return v.text ? { name: v.name ?? 'Member', text: v.text, dm: v.dm } : null;
  } catch {
    return null;
  }
}

/** @username in a message shows in bold violet */
export function withMentions(text: string) {
  const parts = text.split(/(@[A-Za-z0-9_]{2,30})/g);
  if (parts.length === 1) return text;
  return parts.map((p, i) => (i % 2 ? <b key={i} className="cx-mention">{p}</b> : <React.Fragment key={i}>{p}</React.Fragment>));
}

/* ---------- One message ---------- */
export function Bubble({
  m,
  mine,
  ready,
  onHold,
  onRetry,
  onDownload,
  onOpen,
  who,
  quote,
  reactions,
  onReact,
  noTicks = false,
  seen,
  onSeen,
  domId,
  avatar,
  onReactions,
  onReply,
  content,
  onPlayed,
}: {
  m: Message;
  mine: boolean;
  /** Group chats: who sent it (shown above other people's messages) */
  who?: { name: string } | null;
  /** The message this one replies to */
  quote?: { name: string; text: string; onClick?: () => void } | null;
  reactions?: { emoji: string; count: number; mine: boolean }[];
  onReact?: (emoji: string) => void;
  noTicks?: boolean;
  /** Group chats: how many members have seen my message */
  seen?: number;
  onSeen?: () => void;
  domId?: string;
  /** Group chats: the sender's photo beside their first message in a row (false: keep the space) */
  avatar?: Profile | false;
  /** Group chats: tapping the reactions shows who reacted */
  onReactions?: () => void;
  /** Swipe the message left or right to reply to it */
  onReply?: (m: Message) => void;
  /** Shown instead of the text (polls, live classes) */
  content?: React.ReactNode;
  /** Someone else's voice note was played (for message info) */
  onPlayed?: (m: Message) => void;
  /** Downloaded (or sent by me): show the media itself */
  ready: boolean;
  onHold: (m: Message) => void;
  onRetry?: (m: Message) => void;
  onDownload: (m: Message) => void;
  onOpen: (m: Message) => void;
}) {
  const timer = useRef<number | undefined>(undefined);
  // Swipe to reply: drag the message sideways (either way) past the line and let go
  const swipe = useRef<{ x: number; y: number; dx: number; on: boolean | null } | null>(null);
  const li = useRef<HTMLLIElement>(null);
  const SWIPE = 64;
  const setShift = (dx: number) => {
    const el = li.current;
    if (!el) return;
    el.style.transform = dx ? `translateX(${dx}px)` : '';
    el.style.setProperty('--swipe', String(Math.min(1, Math.abs(dx) / SWIPE)));
    el.classList.toggle('is-swiping', dx !== 0);
    el.classList.toggle('is-swipe-left', dx < 0);
  };
  const hold = {
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      onHold(m);
    },
    onTouchStart: (e: React.TouchEvent) => {
      timer.current = window.setTimeout(() => onHold(m), 450);
      const t = e.touches[0];
      swipe.current = onReply && !m.pending ? { x: t.clientX, y: t.clientY, dx: 0, on: null } : null;
    },
    onTouchMove: (e: React.TouchEvent) => {
      window.clearTimeout(timer.current);
      const s = swipe.current;
      if (!s) return;
      const t = e.touches[0];
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      // decide once: sideways means swipe, up/down means scrolling
      if (s.on === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) s.on = Math.abs(dx) > Math.abs(dy) * 1.4;
      if (!s.on) return;
      const limited = Math.sign(dx) * Math.min(Math.abs(dx) * 0.6, SWIPE + 16);
      if (Math.abs(s.dx) < SWIPE && Math.abs(limited) >= SWIPE) navigator.vibrate?.(10);
      s.dx = limited;
      setShift(limited);
    },
    onTouchEnd: () => {
      window.clearTimeout(timer.current);
      const s = swipe.current;
      swipe.current = null;
      if (!s?.on) return;
      const el = li.current;
      if (el) {
        el.style.transition = 'transform 0.18s ease-out';
        window.setTimeout(() => el && (el.style.transition = ''), 200);
      }
      setShift(0);
      if (Math.abs(s.dx) >= SWIPE) onReply?.(m);
    },
  };

  if (m.deleted_at) {
    return (
      <li className={mine ? 'cx-msg is-mine is-deleted' : 'cx-msg is-deleted'}>
        <p>{mine ? 'You deleted this message' : 'This message was deleted'}</p>
        <span className="cx-msg-meta">
          <time dateTime={m.created_at}>{hhmm(m.created_at)}</time>
        </span>
      </li>
    );
  }

  const kind = m.kind ?? 'text';
  return (
    <li
      id={domId}
      ref={li}
      className={[
        'cx-msg',
        mine ? 'is-mine' : '',
        kind !== 'text' ? `is-${kind}` : '',
        content ? 'is-card' : '',
        (kind === 'image' || kind === 'video') && !m.body && !m.forwarded ? 'is-bare' : '',
        m.pending ? 'is-pending' : '',
        m.failed ? 'is-failed' : '',
        avatar !== undefined ? 'has-av' : '',
        reactions && reactions.length > 0 ? 'has-rx' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      {...hold}
      onClick={m.failed && onRetry ? () => onRetry(m) : undefined}
    >
      {onReply && (
        <span className="cx-swipe-ico" aria-hidden="true">
          <Icon name="forward" size={18} />
        </span>
      )}
      {avatar && (
        <span className="cx-msg-av" aria-hidden="true">
          <Avatar p={avatar} size={30} />
        </span>
      )}
      {who && <b className="cx-msg-who">{who.name}</b>}
      {m.forwarded && !m.deleted_at && (
        <span className="cx-msg-fwd">
          <Icon name="forward" size={14} /> Forwarded
        </span>
      )}
      {quote && (
        <button type="button" className="cx-msg-quote" onClick={quote.onClick}>
          <b>{quote.name}</b>
          <span>{quote.text}</span>
        </button>
      )}
      {kind === 'voice' && <Voice src={m.media_url} duration={m.duration} onFirstPlay={!mine && onPlayed ? () => onPlayed(m) : undefined} />}
      {(kind === 'image' || kind === 'video') &&
        (ready && m.media_url ? (
          kind === 'image' ? (
            <button type="button" className="cx-msg-media" onClick={() => onOpen(m)} aria-label="Open photo">
              <img src={m.media_url} alt="" />
            </button>
          ) : (
            // a still with a play button; tapping opens it full screen
            <button type="button" className="cx-msg-media cx-msg-vid" onClick={() => onOpen(m)} aria-label="Play video">
              {m.thumb ? <img src={m.thumb} alt="" /> : <video src={`${m.media_url}#t=0.1`} muted playsInline preload="metadata" tabIndex={-1} />}
              <span className="cx-msg-play" aria-hidden="true">
                <Icon name="play" size={26} filled />
              </span>
              {m.duration ? (
                <span className="cx-msg-len">
                  <Icon name="video" size={14} /> {clock(m.duration)}
                </span>
              ) : null}
            </button>
          )
        ) : (
          // Not downloaded yet (WhatsApp-style): nothing is fetched until it's tapped
          <button type="button" className={m.thumb ? 'cx-msg-media cx-msg-dl has-thumb' : 'cx-msg-media cx-msg-dl'} onClick={() => onDownload(m)} disabled={!m.media_url}>
            {m.thumb ? <img className="cx-msg-thumb" src={m.thumb} alt="" /> : <Icon name={kind === 'image' ? 'image' : 'video'} size={30} />}
            <span className="cx-msg-dl-btn">
              <Icon name="download" size={18} />
              {size(m.file_size) || 'Download'}
            </span>
            {kind === 'video' && m.duration ? (
              <span className="cx-msg-len">
                <Icon name="video" size={14} /> {clock(m.duration)}
              </span>
            ) : null}
          </button>
        ))}
      {kind === 'file' && (
        <button type="button" className="cx-msg-file" onClick={() => !m.failed && !m.pending && (ready ? onOpen(m) : onDownload(m))} disabled={!m.media_url}>
          <span className="cx-msg-file-ico" style={{ background: docType(m.file_name).color }}>
            {docType(m.file_name).label}
          </span>
          <span className="cx-msg-file-text">
            <strong>{m.file_name || 'File'}</strong>
            <small>
              {[size(m.file_size), docType(m.file_name).label].filter(Boolean).join(' · ')}
            </small>
          </span>
          {!ready && <Icon name="download" size={18} />}
        </button>
      )}
      {m.pending && m.progress !== undefined && m.progress < 1 && (
        <span className="cx-msg-progress" aria-hidden="true">
          <span style={{ transform: `scaleX(${Math.max(0.05, m.progress)})` }} />
        </span>
      )}
      {m.pending && kind === 'video' && (m.progress ?? 0) < 0.5 && <small className="cx-msg-prep">Making the video smaller…</small>}
      {content ?? (m.body && <Rich text={m.body} mention={withMentions} />)}
      <span className="cx-msg-meta">
        {m.edited_at && <span className="cx-msg-edited">Edited</span>}
        <time dateTime={m.created_at}>{hhmm(m.created_at)}</time>
        {mine && !noTicks && <Status m={m} />}
        {mine && noTicks && (m.pending || m.failed) && <Status m={m} />}
        {mine && noTicks && !m.pending && !m.failed && seen !== undefined && (
          <button type="button" className={seen ? 'cx-tick cx-seen-count is-seen' : 'cx-tick cx-seen-count'} onClick={(e) => (e.stopPropagation(), onSeen?.())} aria-label={seen ? `Seen by ${seen}` : 'Not seen yet'}>
            <Icon name={seen ? 'ticks' : 'tick'} size={seen ? 17 : 15} />
            {seen > 0 && <span>{seen}</span>}
          </button>
        )}
      </span>
      {reactions && reactions.length > 0 && (() => {
        // one pill on the bubble's edge, like WhatsApp: the emojis, then how many
        const total = reactions.reduce((n, r) => n + r.count, 0);
        const mineR = reactions.find((r) => r.mine);
        return (
          <button
            type="button"
            className={mineR ? 'cx-msg-rx is-mine' : 'cx-msg-rx'}
            onClick={(e) => {
              e.stopPropagation();
              if (onReactions) onReactions();
              else if (mineR) onReact?.(mineR.emoji);
            }}
            aria-label={`${total} ${total === 1 ? 'reaction' : 'reactions'}: ${reactions.map((r) => r.emoji).join(' ')}`}
          >
            {[...reactions].sort((a, b) => b.count - a.count).slice(0, 3).map((r) => (
              <span key={r.emoji}>{r.emoji}</span>
            ))}
            {total > 1 && <small>{total}</small>}
          </button>
        );
      })()}
    </li>
  );
}

/* ---------- The chat ---------- */
export function Chat({ id }: { id: string }) {
  const { api, me, signedIn, toast, ask } = useConnect();
  const [conv, setConv] = useState<Conversation | null | undefined>(() => peek<Conversation | null>('getConversation', id));
  const [msgs, setMsgs] = useState<Message[]>(() => peek<Message[]>('listMessages', id) ?? []);
  const [local, setLocal] = useState<Message[]>([]); // still sending
  // unsent text stays when you leave the chat ("Draft" in Messages)
  const [draft, setDraft] = useDraft(id);
  const [blocked, setBlocked] = useState(false);
  const [menu, setMenu] = useState(false);
  const [held, setHeld] = useState<Message | null>(null);
  // + : any emoji as a reaction
  const [rxMore, setRxMore] = useState<Message | null>(null);
  // editing one of my messages: the box holds its text until saved
  const [editing, setEditing] = useState<Message | null>(null);
  // message info: sent, delivered, read, played
  const [infoOf, setInfoOf] = useState<Message | null>(null);
  const [forwarding, setForwarding] = useState<Message | null>(null);
  const [rec, setRec] = useState<{ start: number; secs: number } | null>(null);
  const end = useRef<HTMLLIElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [attach, setAttach] = useState(false);
  const recorder = useRef<{ mr: MediaRecorder; chunks: Blob[]; stream: MediaStream; cancel: boolean } | null>(null);
  const retries = useRef(new Map<string, { a: Attachment; caption: string }>());
  const [downloaded, setDownloaded] = useState<Set<string>>(() => new Set());
  const [viewing, setViewing] = useState<Message | null>(null);
  // "Reply privately" from the group: the group message to answer
  const [quote, setQuote] = useState<string | null>(null);
  useEffect(() => {
    setDownloaded(loadDownloaded());
    try {
      const q = sessionStorage.getItem(`cx-quote-${id}`);
      if (q) {
        setQuote(q);
        sessionStorage.removeItem(`cx-quote-${id}`);
      }
    } catch {
      /* ignore */
    }
  }, [id]);

  // the first message from them I hadn't read when I opened the chat
  // (worked out from last time's messages when we have them, so the chat opens in place at once)
  const [unreadFrom, setUnreadFrom] = useState<string | null | undefined>(() => {
    const cached = peek<Message[]>('listMessages', id);
    if (!cached || !me) return undefined;
    return cached.find((m) => m.sender_id !== me.id && !m.read_at && !m.deleted_at)?.id ?? null;
  });
  const load = useCallback(async () => {
    const list = await api.listMessages(id);
    if (me) setUnreadFrom((u) => (u !== undefined ? u : (list.find((m) => m.sender_id !== me.id && !m.read_at && !m.deleted_at)?.id ?? null)));
    setMsgs(list);
    if (me && list.some((m) => m.sender_id !== me.id && !m.read_at && !m.deleted_at)) api.markRead(id).then(() => window.dispatchEvent(new Event('cx:counts'))).catch(() => {});
  }, [api, id, me]);

  useEffect(() => {
    if (!me) return;
    api.getConversation(id).then((c) => {
      setConv(c);
      if (c) api.isBlocked(c.other.id).then(setBlocked).catch(() => {});
    });
    load().catch(() => {});
    // New messages and tick updates: check every few seconds while the chat is open
    // Live: messages and tick changes arrive the moment they happen.
    // A slow check every 20 seconds covers a dropped connection.
    const stop = api.subscribe('messages', `conversation_id=eq.${id}`, () => load().catch(() => {}));
    // reactions on this chat's messages
    const stopRx = api.subscribe('message_reactions', '', () => load().catch(() => {}));
    const t = window.setInterval(() => document.visibilityState === 'visible' && load().catch(() => {}), 20000);
    return () => {
      stop();
      stopRx();
      window.clearInterval(t);
    };
  }, [api, id, me, load]);

  const all = [...msgs, ...local];
  // Open where you left off: at the first message you haven't read (under an
  // "Unread messages" line), or at the newest one if you've read everything.
  // New messages after that glide into view. Only the message list moves.
  const opened = useRef(false);
  // Hidden until it's scrolled into place, so it never shows old messages and then jumps
  const [placed, setPlaced] = useState(false);
  useLayoutEffect(() => {
    const el = end.current;
    const list = el?.parentElement;
    if (!el || !list) return;
    if (!opened.current) {
      if (unreadFrom === undefined) return; // still finding out what's new
      opened.current = true;
      const place = () => {
        const mark = unreadFrom ? list.querySelector<HTMLElement>('.cx-unread') : null;
        list.scrollTop = mark ? mark.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop - 8 : list.scrollHeight;
      };
      place();
      setPlaced(true);
      // Photos and videos load after this and push things down: keep the same
      // spot for a few seconds, unless the person starts scrolling themselves.
      let touched = false;
      const stop = () => (touched = true);
      const again = () => !touched && place();
      list.addEventListener('load', again, true);
      list.addEventListener('loadedmetadata', again, true);
      list.addEventListener('touchstart', stop, { passive: true });
      list.addEventListener('wheel', stop, { passive: true });
      window.setTimeout(() => {
        list.removeEventListener('load', again, true);
        list.removeEventListener('loadedmetadata', again, true);
        list.removeEventListener('touchstart', stop);
        list.removeEventListener('wheel', stop);
      }, 6000);
      return;
    }
    list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
  }, [all.length, unreadFrom]);

  // Stop the microphone if the person leaves mid-recording
  useEffect(
    () => () => {
      const r = recorder.current;
      if (r) {
        r.cancel = true;
        if (r.mr.state !== 'inactive') r.mr.stop();
        r.stream.getTracks().forEach((t) => t.stop());
      }
    },
    [],
  );

  const otherOnline = useOnline(conv?.other.id);
  // "typing…": my typing goes to their private room; theirs arrives in mine (listened to app-wide)
  useTypingSender(api, conv ? `u:${conv.other.id}` : null, id, me, draft);
  const typers = useTyping(id);
  const [picked, setPicked] = useState<Picked[]>([]);
  // the hold menu can be dragged down to close
  const heldSheet = useDragToClose<HTMLDivElement>(() => setHeld(null), Boolean(held));
  const [caption, setCaption] = useState('');

  if (!signedIn) return <Empty title="Sign in to see your messages" />;
  if (me === undefined || conv === undefined) return <Loading />;
  if (!me) return <Empty title="Finish your profile first" />;
  if (conv === null) return <Empty title="Conversation not found" />;

  const other = conv.other;

  /* sending text */
  const sendText = async () => {
    const body = draft.trim();
    if (!body) return;
    if (editing) {
      const m = editing;
      setEditing(null);
      setDraft('');
      if (body === m.body) return;
      setMsgs((ms) => ms.map((x) => (x.id === m.id ? { ...x, body, edited_at: new Date().toISOString() } : x)));
      try {
        await api.editMessage(m.id, body);
      } catch (e) {
        setMsgs((ms) => ms.map((x) => (x.id === m.id ? m : x)));
        toast((e as Error).message);
      }
      return;
    }
    const q = quote;
    setDraft('');
    setQuote(null);
    play('send');
    const tmp: Message = { id: `tmp-${Date.now()}`, conversation_id: id, sender_id: me.id, body, quote: q, created_at: new Date().toISOString(), kind: 'text', pending: true };
    setLocal((l) => [...l, tmp]);
    try {
      const m = await api.sendMessage(id, body, q);
      setMsgs((xs) => [...xs, m]);
      setLocal((l) => l.filter((x) => x.id !== tmp.id));
    } catch (e) {
      setLocal((l) => l.filter((x) => x.id !== tmp.id));
      setDraft(body);
      toast((e as Error).message);
    }
    box.current?.focus();
  };

  /* sending a file, photo, video or voice note: shows at once, uploads behind */
  const sendFile = async (a: Attachment, caption = '') => {
    if (a.kind !== 'video' && a.file.size > MAX_FILE) return toast('Files can be up to 50 MB.');
    if (a.kind === 'video') {
      const secs = await videoSeconds(a.file);
      if (secs > MAX_VIDEO_SECONDS) return toast('Videos can be up to 3 minutes. Share a Google Drive link for longer ones.');
      if (secs && !a.duration) a = { ...a, duration: Math.round(secs) };
    }
    const tmp: Message = {
      id: `tmp-${Date.now()}`,
      conversation_id: id,
      sender_id: me.id,
      body: caption,
      created_at: new Date().toISOString(),
      kind: a.kind,
      media_url: URL.createObjectURL(a.file),
      file_name: a.file.name,
      file_size: a.file.size,
      duration: a.duration,
      pending: true,
      progress: 0,
    };
    setLocal((l) => [...l, tmp]);
    play('send');
    const thumb = await makeThumb(a.file, a.kind);
    let file = a.file;
    if (a.kind === 'video') {
      file = await compressVideo(a.file, (p) => setLocal((l) => l.map((x) => (x.id === tmp.id ? { ...x, progress: p * 0.5 } : x))));
      if (file.size > MAX_FILE) {
        setLocal((l) => l.map((x) => (x.id === tmp.id ? { ...x, failed: true, pending: false } : x)));
        return toast('This video is still over 50 MB. Share a Google Drive link instead.');
      }
    }
    upload(tmp, { ...a, file, ...(thumb ? { thumb } : {}) }, caption, a.kind === 'video' ? 0.5 : 0);
  };

  const upload = async (tmp: Message, a: Attachment, caption: string, from = 0) => {
    retries.current.set(tmp.id, { a, caption });
    try {
      const m = await api.sendAttachment(id, a, caption, (p) => setLocal((l) => l.map((x) => (x.id === tmp.id ? { ...x, progress: from + p * (1 - from) } : x))));
      // You sent it, so it's already on this device: tapping opens it, no download
      if (a.kind === 'file') keepFile(m.id, a.file);
      setMsgs((xs) => [...xs, m]);
      setLocal((l) => l.filter((x) => x.id !== tmp.id));
      retries.current.delete(tmp.id);
    } catch (e) {
      setLocal((l) => l.map((x) => (x.id === tmp.id ? { ...x, failed: true, pending: false } : x)));
      toast((e as Error).message);
    }
  };

  /* Tap a "Not sent" message to try again */
  const retry = (m: Message) => {
    const r = retries.current.get(m.id);
    if (!r) return;
    setLocal((l) => l.map((x) => (x.id === m.id ? { ...x, failed: false, pending: true, progress: 0 } : x)));
    upload(m, r.a, r.caption);
  };

  /* picking photos, videos or files opens the review screen first */
  const pickFiles = (files: FileList | File[] | null, asDocument = false) => {
    if (!files?.length) return;
    if (!picked.length) {
      // Whatever was typed becomes the caption
      setCaption(draft.trim());
      setDraft('');
    }
    // videos are always videos; from Document, everything else goes as a file
    const add = Array.from(files).map((f, n) => {
      const k = kindOf(f);
      return { key: `${Date.now()}-${n}-${f.name}`, file: f, kind: k === 'video' ? k : asDocument || k === 'voice' ? ('file' as const) : k, url: URL.createObjectURL(f) };
    });
    setPicked((p) => [...p, ...add].slice(0, 10));
  };
  const closePicked = () => {
    picked.forEach((x) => URL.revokeObjectURL(x.url));
    setPicked([]);
    setDraft((d) => d || caption);
    setCaption('');
  };
  const removePicked = (key: string) =>
    setPicked((p) => {
      const gone = p.find((x) => x.key === key);
      if (gone) URL.revokeObjectURL(gone.url);
      return p.filter((x) => x.key !== key);
    });
  const sendPicked = () => {
    const list = picked;
    const text = caption.trim();
    setPicked([]);
    setCaption('');
    list.forEach((x, n) => {
      URL.revokeObjectURL(x.url);
      sendFile({ file: x.file, kind: x.kind }, n === 0 ? text : '');
    });
  };

  /* voice notes */
  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return toast('Voice notes don’t work in this browser.');
    let stream: MediaStream;
    try {
      // Mono with noise cleanup: voice notes stay small and clear
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch {
      return toast('Allow microphone access to record a voice note.');
    }
    const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'].find((t) => MediaRecorder.isTypeSupported?.(t));
    // 16 kbps Opus: about 2 KB a second, so a 1-minute note is around 120 KB
    const mr = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 16000 });
    const r = { mr, chunks: [] as Blob[], stream, cancel: false };
    recorder.current = r;
    const start = Date.now();
    mr.ondataavailable = (e) => e.data.size && r.chunks.push(e.data);
    mr.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      recorder.current = null;
      setRec(null);
      const secs = (Date.now() - start) / 1000;
      if (r.cancel || secs < 0.8) return;
      const mime = mr.mimeType || type || 'audio/webm';
      const ext = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm';
      const file = new File(r.chunks, `voice-${Date.now()}.${ext}`, { type: mime.split(';')[0] });
      sendFile({ file, kind: 'voice', duration: Math.round(secs * 10) / 10 });
    };
    mr.start(250);
    setRec({ start, secs: 0 });
    const tick = window.setInterval(() => {
      if (recorder.current !== r) return window.clearInterval(tick);
      const secs = (Date.now() - start) / 1000;
      setRec({ start, secs });
      if (secs >= MAX_VOICE_SECONDS) mr.stop();
    }, 250);
  };
  const stopRecording = (send: boolean) => {
    const r = recorder.current;
    if (!r) return;
    r.cancel = !send;
    if (r.mr.state !== 'inactive') r.mr.stop();
  };

  /* media: photos and videos download only when tapped; files save to the phone */
  const markDownloaded = (id: string) =>
    setDownloaded((d) => {
      const next = new Set(d).add(id);
      rememberDownloaded(next);
      return next;
    });
  const download = async (m: Message) => {
    if (m.kind === 'file') {
      toast('Downloading…');
      try {
        if (!(await downloadFile(m))) throw new Error();
        markDownloaded(m.id);
        toast('Downloaded. Tap it to open.');
      } catch {
        toast('Couldn’t download it. Check your connection and try again.');
      }
      return;
    }
    setDownloaded((d) => {
      const next = new Set(d).add(m.id);
      rememberDownloaded(next);
      return next;
    });
  };

  /* holding a message */
  const copy = async (m: Message) => {
    setHeld(null);
    try {
      await navigator.clipboard.writeText(m.body);
      toast('Copied');
    } catch {
      /* ignore */
    }
  };
  // React to a message (tap the same emoji again to take it off)
  const react = async (m: Message, emoji: string) => {
    setHeld(null);
    const mine = m.reactions?.find((r) => r.mine);
    const next = mine?.emoji === emoji ? null : emoji;
    setMsgs((xs) =>
      xs.map((x) => {
        if (x.id !== m.id) return x;
        let rx = (x.reactions ?? []).map((r) => (r.mine ? { ...r, count: r.count - 1, mine: false } : r)).filter((r) => r.count > 0);
        if (next) {
          const e = rx.find((r) => r.emoji === next);
          rx = e ? rx.map((r) => (r.emoji === next ? { ...r, count: r.count + 1, mine: true } : r)) : [...rx, { emoji: next, count: 1, mine: true }];
        }
        return { ...x, reactions: rx };
      }),
    );
    if (next) play('like');
    await api.reactMessage(m.id, next).catch((e: Error) => toast(e.message));
  };
  const remove = async (m: Message) => {
    setHeld(null);
    if (!(await ask({ title: 'Delete for everyone?', body: `This message will be removed for you and ${other.name}.`, confirm: 'Delete', danger: true }))) return;
    setMsgs((xs) => xs.map((x) => (x.id === m.id ? { ...x, deleted_at: new Date().toISOString(), body: '', media_url: null } : x)));
    try {
      await api.deleteMessage(m.id);
    } catch (e) {
      toast((e as Error).message);
      load().catch(() => {});
    }
  };
  const reportMsg = async (m: Message) => {
    setHeld(null);
    const reason = await ask({ title: 'Report this message', body: 'A moderator will look at it. They won’t know who reported it.', input: 'What’s wrong?', confirm: 'Send report' });
    if (!reason) return;
    await api.report('message', m.id, reason);
    toast('Reported. A moderator will look at it.');
  };

  /* header menu */
  const reportUser = async () => {
    setMenu(false);
    const reason = await ask({ title: `Report ${other.name}`, body: 'A moderator will look at it. They won’t know who reported them.', input: 'What’s wrong?', confirm: 'Send report' });
    if (!reason) return;
    await api.report('profile', other.id, reason);
    toast('Reported. A moderator will look at it.');
  };
  const toggleBlock = async () => {
    setMenu(false);
    if (!blocked && !(await ask({ title: `Block ${other.name}?`, body: 'They won’t be able to message you, and your connection ends.', confirm: 'Block', danger: true }))) return;
    try {
      await api.setBlock(other.id, !blocked);
      setBlocked(!blocked);
      toast(blocked ? 'Unblocked' : 'Blocked');
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const typing = draft.trim().length > 0;
  let lastDay = '';

  return (
    <div className="cx-col cx-chat">
      <header className="cx-chat-head">
        <A path="/messages" className="cx-icon-btn cx-icon-flat" aria-label="All messages">
          <Icon name="back" />
        </A>
        <A path={`/u/${other.handle}`} className="cx-person">
          <Avatar p={other} size={40} />
          <span className="cx-person-text">
            <span className="cx-person-name">
              <span className="cx-name-text">{other.name}</span>
              {other.is_student && <BeltBadge p={other} small showRole={false} />}
            </span>
            {typers.length ? (
              <span className="cx-person-meta is-typing">typing…</span>
            ) : (
              <span className={otherOnline ? 'cx-person-meta is-online' : 'cx-person-meta'}>
                {other.team_role ? `${other.team_role} · ` : ''}
                {presenceLabel(otherOnline, other.id, other.last_seen_at)}
              </span>
            )}
          </span>
        </A>
        {!blocked && (
          <>
            <button type="button" className="cx-icon-btn cx-icon-flat cx-call-start" aria-label={`Video call ${other.name}`} onClick={() => startCall(other, id, true)}>
              <Icon name="cam" />
            </button>
            <button type="button" className="cx-icon-btn cx-icon-flat cx-call-start" aria-label={`Call ${other.name}`} onClick={() => startCall(other, id, false)}>
              <Icon name="phone" />
            </button>
          </>
        )}
        <div className="cx-menu cx-chat-more">
          <button type="button" className="cx-icon-btn cx-icon-flat" aria-label="Chat options" aria-expanded={menu} onClick={() => setMenu((x) => !x)}>
            <Icon name="more" />
          </button>
          {menu && (
            <>
              <div className="cx-menu-scrim" onClick={() => setMenu(false)} aria-hidden="true" />
              <div className="cx-menu-list" role="menu">
                <button type="button" role="menuitem" onClick={() => navigate(`/u/${other.handle}`)}>
                  View profile
                </button>
                <button type="button" role="menuitem" onClick={reportUser}>
                  Report {other.name}
                </button>
                <button type="button" role="menuitem" className={blocked ? '' : 'cx-danger'} onClick={toggleBlock}>
                  {blocked ? `Unblock ${other.name}` : `Block ${other.name}`}
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      <ol className={placed ? 'cx-msgs' : 'cx-msgs is-placing'}>
        {all.map((m) => {
          const day = dayLabel(m.created_at);
          const showDay = day !== lastDay;
          lastDay = day;
          return (
            <React.Fragment key={m.id}>
              {showDay && <li className="cx-day">{day}</li>}
              {m.id === unreadFrom && <li className="cx-unread">Unread messages</li>}
              {(m.kind as string) === 'join' ? (
                // the first line of a student's chat with the Grand Sensei
                <li className="cx-joincard">
                  {m.sender_id === me.id ? (
                    <>
                      <b>You joined the community</b>
                      <span>You can message {other.name} here any time.</span>
                    </>
                  ) : (
                    <>
                      <Avatar p={other} size={56} />
                      <b>{other.name} joined the community</b>
                      <span>
                        {new Date(m.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                        {other.country ? ` · ${other.country}` : ''}
                      </span>
                      {all.length === 1 && !draft && (
                        <button type="button" className="cx-joincard-btn" onClick={() => setDraft(`Welcome to Motion Dojo, ${other.name.split(' ')[0]}. Start with the orientation video in Learn, then pick your phase.`)}>
                          Send a welcome
                        </button>
                      )}
                    </>
                  )}
                </li>
              ) : (
              <Bubble
                m={m}
                mine={m.sender_id === me.id}
                ready={m.sender_id === me.id || downloaded.has(m.id)}
                onHold={(x) => !x.pending && !x.id.startsWith('tmp-') && setHeld(x)}
                reactions={m.reactions}
                onReact={(e) => react(m, e)}
                content={
                  m.kind === 'call' ? (
                    <CallLine m={m} mine={m.sender_id === me.id} onCall={(video) => startCall(other, id, video)} />
                  ) : undefined
                }
                onPlayed={(x) => api.markPlayed(x.id).catch(() => {})}
                onRetry={retry}
                onDownload={download}
                onOpen={(x) => (x.kind === 'file' ? openFile(x, toast) : setViewing(x))}
                quote={readQuote(m.quote) ? { name: readQuote(m.quote)!.dm ? readQuote(m.quote)!.name : `${readQuote(m.quote)!.name} in the group`, text: readQuote(m.quote)!.text } : null}
                onReply={(x) => {
                  const text = x.body || (x.kind === 'voice' ? 'Voice message' : x.kind === 'image' ? 'Photo' : x.kind === 'video' ? 'Video' : x.file_name || 'File');
                  setQuote(JSON.stringify({ name: x.sender_id === me.id ? 'You' : other.name, text: text.slice(0, 200), dm: true }));
                  window.setTimeout(() => box.current?.focus(), 50);
                }}
              />
              )}
            </React.Fragment>
          );
        })}
        {typers.length > 0 && <TypingBubble />}
        <li ref={end} className="cx-msgs-end" aria-hidden="true" />
      </ol>


      {blocked ? (
        <div className="cx-chat-blocked">
          <p>You blocked {other.name}.</p>
          <button type="button" className="btn btn-light btn-sm" onClick={toggleBlock}>
            Unblock
          </button>
        </div>
      ) : rec ? (
        <div className="cx-chat-compose cx-rec" role="group" aria-label="Recording a voice note">
          <button type="button" className="cx-icon-btn cx-icon-flat" onClick={() => stopRecording(false)} aria-label="Cancel recording">
            <Icon name="trash" />
          </button>
          <span className="cx-rec-dot" aria-hidden="true" />
          <span className="cx-rec-time">{clock(rec.secs)}</span>
          <span className="cx-rec-hint">Recording…</span>
          <button type="button" className="cx-send" onClick={() => stopRecording(true)} aria-label="Send voice note">
            <Icon name="send" size={20} />
          </button>
        </div>
      ) : (
        <div className="cx-group-foot">
        {editing && (
          <div className="cx-replying cx-editing">
            <span>
              <b>Editing message</b>
              <small>{editing.body.slice(0, 120)}</small>
            </span>
            <button type="button" className="cx-icon-btn cx-icon-flat" aria-label="Stop editing" onClick={() => (setEditing(null), setDraft(''))}>
              <Icon name="close" size={18} />
            </button>
          </div>
        )}
        {quote && readQuote(quote) && (
          <div className="cx-replying">
            <span>
              <b>{readQuote(quote)!.dm ? `Replying to ${readQuote(quote)!.name === 'You' ? 'yourself' : readQuote(quote)!.name}` : `Replying privately to ${readQuote(quote)!.name}`}</b>
              <small>{readQuote(quote)!.text}</small>
            </span>
            <button type="button" className="cx-icon-btn cx-icon-flat" aria-label="Cancel reply" onClick={() => setQuote(null)}>
              <Icon name="close" size={18} />
            </button>
          </div>
        )}
        <form
          className="cx-compose cx-chat-compose"
          onSubmit={(e) => {
            e.preventDefault();
            sendText();
          }}
        >
          <button type="button" className="cx-icon-btn cx-icon-flat cx-attach" onClick={() => setAttach(true)} aria-label="Send a photo, video or document">
            <Icon name="clip" />
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            className="sr-only"
            accept="image/*,video/*"
            onChange={(e) => {
              pickFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <AttachSheet open={attach} onClose={() => setAttach(false)} onPick={pickFiles} />
          <label className="sr-only" htmlFor="msg-box">
            Message
          </label>
          {/* Enter adds a new line; only the send button sends */}
          <EmojiButton box={box} value={draft} onValue={setDraft} />
          <MessageField box={box} id="msg-box" rows={1} maxLength={4000} placeholder="Message" value={draft} onChange={(e) => smartChange(draft, e.target, setDraft)} enterKeyHint="enter" />
          {typing ? (
            <button type="submit" className="cx-send" aria-label="Send">
              <Icon name="send" size={20} />
            </button>
          ) : (
            <button type="button" className="cx-send" onClick={startRecording} aria-label="Record a voice note">
              <Icon name="mic" size={20} />
            </button>
          )}
        </form>
        </div>
      )}

      {forwarding && <ForwardSheet m={forwarding} onClose={() => setForwarding(null)} />}
      {infoOf && <MessageInfo m={msgs.find((x) => x.id === infoOf.id) ?? infoOf} onClose={() => setInfoOf(null)} />}

      {rxMore && <EmojiSheet onClose={() => setRxMore(null)} onPick={(e) => (react(rxMore, e), setRxMore(null))} />}
      {held && (
        <div className="cx-sheet-wrap" onClick={() => setHeld(null)}>
          <div className="cx-sheet cx-drag" role="menu" ref={heldSheet} onClick={(e) => e.stopPropagation()}>
            <span className="cx-grab" aria-hidden="true" />
            {!held.deleted_at && (
              <div className="cx-rx-pick" role="group" aria-label="React">
                {DM_EMOJI.map((e) => (
                  <button key={e} type="button" className={held.reactions?.some((r) => r.mine && r.emoji === e) ? 'is-on' : ''} onClick={() => react(held, e)} aria-label={`React ${e}`}>
                    {e}
                  </button>
                ))}
                <button type="button" className="cx-rx-more" onClick={() => (setRxMore(held), setHeld(null))} aria-label="More reactions">
                  <Icon name="plus" size={20} />
                </button>
              </div>
            )}
            {!held.pending && !held.deleted_at && (held.body || held.media_url) && (
              <button type="button" role="menuitem" onClick={() => (setForwarding(held), setHeld(null))}>
                <Icon name="forward" /> Forward
              </button>
            )}
            {held.body && (
              <button type="button" role="menuitem" onClick={() => copy(held)}>
                <Icon name="copy" /> Copy text
              </button>
            )}
            {held.kind && held.kind !== 'text' && held.media_url && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  const m = held;
                  setHeld(null);
                  saveToPhone(m, toast);
                }}
              >
                <Icon name="download" /> Save to phone
              </button>
            )}
            {held.sender_id === me.id && !held.pending && (
              <button type="button" role="menuitem" onClick={() => (setInfoOf(held), setHeld(null))}>
                <Icon name="clock" /> Info
              </button>
            )}
            {held.sender_id === me.id && (held.kind ?? 'text') === 'text' && canUnsend(held.created_at, held.read_at) && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setEditing(held);
                  setDraft(held.body);
                  setHeld(null);
                  window.setTimeout(() => box.current?.focus(), 50);
                }}
              >
                <Icon name="pen" /> Edit
              </button>
            )}
            {held.sender_id === me.id ? (
              canUnsend(held.created_at, held.read_at) ? (
                <button type="button" role="menuitem" className="cx-danger" onClick={() => remove(held)}>
                  <Icon name="trash" /> Delete for everyone
                </button>
              ) : (
                null
              )
            ) : (
              <button type="button" role="menuitem" onClick={() => reportMsg(held)}>
                <Icon name="more" /> Report message
              </button>
            )}
            <button type="button" role="menuitem" onClick={() => setHeld(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {picked.length > 0 && (
        <SendPreview
          items={picked}
          to={other.name}
          caption={caption}
          onCaption={setCaption}
          onRemove={removePicked}
          onAdd={() => fileInput.current?.click()}
          onClose={closePicked}
          onSend={sendPicked}
        />
      )}

      {viewing && <Viewer m={viewing} onClose={() => setViewing(null)} onSave={() => saveToPhone(viewing, toast)} />}
    </div>
  );
}

/* ================= Inbox ================= */
function GroupInboxRow({ p: pinp }: { p: PinProps }) {
  const { api, me } = useConnect();
  const hold = useHold(pinp.onHold);
  useTypingRoom(api, 'g:main', me?.id);
  const typers = useTyping('group');
  // Shown straight away (last known, or just the name) so the group never blinks out while it loads
  // the group's name and picture from last time, so the old default name never flashes
  // Name and last message appear together: from last time straight away, or both when they arrive
  const [p, setP] = useState<{ name: string; photo_url?: string | null; text: string; at: string; unread: number } | null>(
    () => peek<{ name: string; photo_url?: string | null; text: string; at: string; unread: number }>('groupPreview') ?? null,
  );
  useEffect(() => {
    const load = () =>
      api
        .groupPreview()
        .then((v) => {
          if (!v) return;
          setP(v);
          try {
            localStorage.setItem('cx-group-look', JSON.stringify({ name: v.name, photo_url: v.photo_url ?? null }));
          } catch {
            /* storage blocked */
          }
        })
        .catch(() => {});
    load();
    const stop = api.subscribe('group_messages', '', load);
    return stop;
  }, [api]);
  if (!p)
    return (
        <li style={{ order: pinp.order }} aria-busy="true">
          <span className="cx-inbox-row">
            <span className="cx-group-ico cx-group-ico-lg" aria-hidden="true" />
            <span className="cx-inbox-text">
              <span className="cx-skel-line" aria-label="Loading" />
              <span className="cx-skel-line cx-skel-short" />
            </span>
          </span>
        </li>
    );
  return (
      <li style={{ order: pinp.order }}>
        <A path="/messages/group" className={p.unread ? 'cx-inbox-row is-unread' : 'cx-inbox-row'} {...hold}>
          <span className="cx-group-ico cx-group-ico-lg" aria-hidden="true">
            <img src={p.photo_url || '/assets/favicon-128.png'} alt="" width={56} height={56} />
          </span>
          <span className="cx-inbox-text">
            <span className="cx-inbox-top">
              <span className="cx-person-name">{p.name}</span>
              {p.at && <span className="cx-inbox-time">{shortTime(p.at)}</span>}
            </span>
            <span className="cx-inbox-bottom">
              <span className="cx-inbox-last">
                {typers.length ? (
                  <span className="cx-inbox-snippet is-typing">{typingLine(typers)}</span>
                ) : loadDraft('group') ? (
                  <span className="cx-inbox-snippet">
                    <b className="cx-draft">Draft:</b> {loadDraft('group').split('\n')[0]}
                  </span>
                ) : (
                  <span className="cx-inbox-snippet">{p.text}</span>
                )}
              </span>
              <PinMark on={pinp.pinned} />
              {p.unread > 0 && <span className="cx-inbox-count">{p.unread > 99 ? '99+' : p.unread}</span>}
            </span>
          </span>
        </A>
      </li>
  );
}

/** Three bouncing dots under the last message while someone types */
export function TypingBubble({ name }: { name?: string }) {
  const li = useRef<HTMLLIElement>(null);
  // follow it into view if you're already at the bottom
  useEffect(() => {
    const list = li.current?.parentElement;
    if (list && list.scrollHeight - list.scrollTop - list.clientHeight < 160) list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
  }, []);
  return (
    <li ref={li} className="cx-typing-row" aria-label={name ? `${name} is typing` : 'Typing'}>
      <span className="cx-typing-bubble">
        {name && <b>{name}</b>}
        <span className="cx-typing-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </span>
    </li>
  );
}

/* ---------- Pinned chats ---------- */
type PinProps = { order: number; pinned: boolean; onHold: () => void };
/** Hold a row (or right-click it) to pin or unpin; a hold doesn't open the chat */
function useHold(onHold: () => void) {
  const timer = useRef(0);
  const held = useRef(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const cancel = () => {
    window.clearTimeout(timer.current);
    start.current = null;
  };
  return {
    onPointerDown: (e: React.PointerEvent) => {
      held.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = window.setTimeout(() => {
        held.current = true;
        navigator.vibrate?.(15);
        onHold();
      }, 500);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      cancel();
      held.current = true;
      onHold();
    },
    onClickCapture: (e: React.MouseEvent) => {
      if (held.current) {
        e.preventDefault();
        e.stopPropagation();
        held.current = false;
      }
    },
  };
}
function PinMark({ on }: { on: boolean }) {
  return on ? (
    <span className="cx-pin-mark" aria-label="Pinned">
      <Icon name="pin" size={14} />
    </span>
  ) : null;
}

/** The Grand Sensei's own groups I'm in */
function OwnGroupRows({ pin }: { pin: (chat: string) => PinProps }) {
  const { api } = useConnect();
  const [rows, setRows] = useState<GroupRow[]>(() => peek<GroupRow[]>('myGroups') ?? []);
  useEffect(() => {
    const load = () => api.myGroups().then(setRows).catch(() => {});
    load();
    const stop = api.subscribe('group_messages', '', load);
    const t = window.setInterval(() => document.visibilityState === 'visible' && load(), 30000);
    return () => {
      stop();
      window.clearInterval(t);
    };
  }, [api]);
  if (!rows.length) return null;
  return (
    <>
      {rows.map((g) => (
        <OwnGroupRow key={g.id} g={g} p={pin(`g:${g.id}`)} />
      ))}
    </>
  );
}

function OwnGroupRow({ g, p }: { g: GroupRow; p: PinProps }) {
  const { api, me } = useConnect();
  const hold = useHold(p.onHold);
  useTypingRoom(api, `g:${g.id}`, me?.id);
  const typers = useTyping(`g:${g.id}`);
  return (
  <li style={{ order: p.order }}>
    <A path={`/messages/g/${g.id}`} className={g.unread ? 'cx-inbox-row is-unread' : 'cx-inbox-row'} {...hold}>
      <span className="cx-group-ico cx-group-ico-lg" aria-hidden="true">
        {g.photo_url ? <img src={g.photo_url} alt="" width={56} height={56} /> : <span className="cx-group-initial">{g.name.trim().charAt(0).toUpperCase()}</span>}
      </span>
      <span className="cx-inbox-text">
        <span className="cx-inbox-top">
          <span className="cx-person-name">{g.name}</span>
          {g.at && <span className="cx-inbox-time">{shortTime(g.at)}</span>}
        </span>
        <span className="cx-inbox-bottom">
          <span className="cx-inbox-last">
            {typers.length ? (
              <span className="cx-inbox-snippet is-typing">{typingLine(typers)}</span>
            ) : loadDraft(`g:${g.id}`) ? (
              <span className="cx-inbox-snippet">
                <b className="cx-draft">Draft:</b> {loadDraft(`g:${g.id}`).split('\n')[0]}
              </span>
            ) : (
              <span className="cx-inbox-snippet">{g.text}</span>
            )}
          </span>
          <PinMark on={p.pinned} />
          {g.unread > 0 && <span className="cx-inbox-count">{g.unread > 99 ? '99+' : g.unread}</span>}
        </span>
      </span>
    </A>
  </li>
  );
}

function ChatRow({ c, p }: { c: Conversation; p: PinProps }) {
  const hold = useHold(p.onHold);
  const typing = useTyping(c.id).length > 0;
  const unread = c.unread ?? 0;
  const joined = (c.last_kind as string) === 'join';
  const kind = c.last_kind && c.last_kind !== 'text' && !joined && !c.last_deleted ? (c.last_kind as keyof typeof KIND_ICON) : null;
  return (
    <li style={{ order: p.order }}>
      <A path={`/messages/${c.id}`} className={unread ? 'cx-inbox-row is-unread' : 'cx-inbox-row'} {...hold}>
        <span className="cx-av-wrap">
          <Avatar p={c.other} size={56} />
          <OnlineDot id={c.other.id} />
        </span>
        <span className="cx-inbox-text">
          <span className="cx-inbox-top">
            <span className="cx-person-name">
              <span className="cx-name-text">{c.other.name}</span>
              {c.other.is_sensei ? null : c.other.is_student && <BeltBadge p={c.other} small showRole={false} />}
              {joined && unread > 0 && <span className="cx-new-tag">New</span>}
            </span>
            <span className="cx-inbox-time">{shortTime(c.last_message_at)}</span>
          </span>
          <span className="cx-inbox-bottom">
            <span className="cx-inbox-last">
              {c.last_mine && !c.last_deleted && !joined && (
                <span className={c.last_read ? 'cx-tick is-seen' : 'cx-tick'} aria-label={c.last_read ? 'Seen' : c.last_delivered ? 'Delivered' : 'Sent'}>
                  <Icon name={c.last_read || c.last_delivered ? 'ticks' : 'tick'} size={16} />
                </span>
              )}
              {kind && <Icon name={KIND_ICON[kind]} size={16} />}
              {typing ? (
              <span className="cx-inbox-snippet is-typing">typing…</span>
            ) : loadDraft(c.id) ? (
              <span className="cx-inbox-snippet">
                <b className="cx-draft">Draft:</b> {loadDraft(c.id).split('\n')[0]}
              </span>
            ) : (
              <span className={joined && unread > 0 ? 'cx-inbox-snippet is-joined' : 'cx-inbox-snippet'}>{c.last_body || 'Say hello'}</span>
            )}
            </span>
            <PinMark on={p.pinned} />
            {unread > 0 && <span className="cx-inbox-count">{unread > 99 ? '99+' : unread}</span>}
          </span>
        </span>
      </A>
    </li>
  );
}

function OnlineDot({ id }: { id: string }) {
  return useOnline(id) ? <span className="cx-online-dot" aria-label="Online" /> : null;
}

const shortTime = (iso: string) => {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return hhmm(iso);
  const days = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (days < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
};
const KIND_ICON = { voice: 'mic', image: 'image', video: 'video', file: 'file' } as const;

export function Inbox() {
  const { api, me, signedIn, toast } = useConnect();
  const [list, setList] = useState<Conversation[] | null>(() => peek<Conversation[]>('listConversations') ?? null);
  const [people, setPeople] = useState<Profile[]>(() => peek<Profile[]>('listConnections') ?? []);
  const [q, setQ] = useState('');
  const [opening, setOpening] = useState('');
  const [askAlerts, setAskAlerts] = useState(false);
  const [newGroup, setNewGroup] = useState(false);
  // Pinned chats sit at the top, newest pin first
  const [pins, setPins] = useState<string[]>(() => peek<string[]>('listPins') ?? []);
  const [holding, setHolding] = useState<string | null>(null);
  useEffect(() => {
    if (me) api.listPins().then(setPins).catch(() => {});
  }, [api, me?.id]);
  const pinOf = (chat: string): PinProps => {
    const i = pins.indexOf(chat);
    // the newest pin goes on top
    return { order: i < 0 ? 0 : -1 - i, pinned: i >= 0, onHold: () => setHolding(chat) };
  };
  const togglePin = async (chat: string) => {
    setHolding(null);
    const on = !pins.includes(chat);
    if (on && pins.length >= 5 && !me?.is_sensei) return toast('You can pin up to 5 chats.');
    const before = pins;
    setPins(on ? [...pins, chat] : pins.filter((c) => c !== chat));
    try {
      await api.setPin(chat, on);
    } catch (e) {
      setPins(before);
      toast((e as Error).message);
    }
  };
  useEffect(() => {
    let dismissed = false;
    try {
      // "Not now" hides it for 3 days, then it asks again
      dismissed = Date.now() - Number(localStorage.getItem('cx-alerts-later') || 0) < 3 * 864e5;
    } catch {
      /* ignore */
    }
    setAskAlerts(alertsUndecided() && !dismissed);
  }, []);
  const answerAlerts = async (yes: boolean) => {
    setAskAlerts(false);
    try {
      if (!yes) localStorage.setItem('cx-alerts-later', String(Date.now()));
    } catch {
      /* ignore */
    }
    if (yes && (await askForAlerts())) {
      toast('Message alerts are on');
      api.enablePush().catch(() => {});
    }
  };

  useEffect(() => {
    if (!me) return;
    const load = () => api.listConversations().then(setList).catch(() => setList((l) => l ?? []));
    load();
    api.listConnections().then(setPeople).catch(() => {});
    // Live: any new message or tick refreshes the list (a burst counts once)
    let pending = 0;
    const stop = api.subscribe('messages', '', () => {
      window.clearTimeout(pending);
      pending = window.setTimeout(load, 300);
    });
    const t = window.setInterval(() => document.visibilityState === 'visible' && load(), 30000);
    return () => {
      stop();
      window.clearTimeout(pending);
      window.clearInterval(t);
    };
  }, [api, me]);

  if (!signedIn) return <Empty title="Sign in to see your messages" />;
  if (me === undefined || (me && list === null)) return <Loading label="Loading messages" />;
  if (!me) return <Empty title="Finish your profile first" />;

  const term = q.trim().toLowerCase();
  const match = (p: Profile) => !term || p.name.toLowerCase().includes(term) || p.handle.toLowerCase().includes(term);
  const chats = list!.filter((c) => match(c.other));
  const strip = people.filter(match);

  const open = async (p: Profile) => {
    const existing = list!.find((c) => c.other.id === p.id);
    if (existing) return navigate(`/messages/${existing.id}`);
    setOpening(p.id);
    try {
      navigate(`/messages/${await api.openConversation(p.id)}`);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setOpening('');
    }
  };

  return (
    <div className="cx-col cx-inbox-page">
      <div className="cx-inbox-head">
        <h1 className="cx-inbox-title">Messages</h1>
        {me.is_sensei && (
          <button type="button" className="cx-new-group" onClick={() => setNewGroup(true)}>
            <Icon name="people" size={18} />
            New group
          </button>
        )}
      </div>
      {newGroup && <NewGroupSheet onClose={() => setNewGroup(false)} />}

      {askAlerts && (
        <div className="cx-alerts-ask">
          <p>Get notified of new messages, even when Connect is closed.</p>
          <button type="button" className="btn btn-light btn-sm" onClick={() => answerAlerts(false)}>
            Not now
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => answerAlerts(true)}>
            Turn on
          </button>
        </div>
      )}

      <label className="cx-search cx-inbox-search">
        <Icon name="search" size={20} />
        <span className="sr-only">Search messages</span>
        <input type="search" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>

      {strip.length > 0 && (
        <ul className="cx-inbox-people" aria-label="Your connections">
          {strip.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => open(p)} disabled={opening === p.id}>
                <span className="cx-av-wrap">
                  <Avatar p={p} size={60} />
                  <OnlineDot id={p.id} />
                </span>
                <span>{p.name.split(' ')[0]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <ul className="cx-inbox cx-inbox-all">
        {(me.is_student || me.is_sensei || me.is_moderator) && !term && <GroupInboxRow p={pinOf('group')} />}
        {!term && <OwnGroupRows pin={pinOf} />}
        {chats.map((c) => (
          <ChatRow key={c.id} c={c} p={pinOf(c.id)} />
        ))}
      </ul>

      {list!.length === 0 ? (
        <div className="cx-inbox-empty">
          <span className="cx-inbox-empty-ico" aria-hidden="true">
            <Icon name="chat" size={30} />
          </span>
          <p className="cx-inbox-empty-title">No messages yet</p>
          <p>{people.length ? 'Tap someone above to start a chat.' : 'Connect with other members, then message them here.'}</p>
          {!people.length && (
            <A path="/students" className="btn btn-primary btn-sm">
              Find members
            </A>
          )}
        </div>
      ) : chats.length === 0 ? (
        <p className="cx-inbox-none">No chats match “{q}”.</p>
      ) : null}

      {holding && (
        <div className="cx-sheet-wrap" onClick={() => setHolding(null)}>
          <div className="cx-sheet" role="menu" onClick={(e) => e.stopPropagation()}>
            <span className="cx-grab" aria-hidden="true" />
            <button type="button" role="menuitem" onClick={() => togglePin(holding)}>
              <Icon name="pin" /> {pins.includes(holding) ? 'Unpin chat' : 'Pin chat'}
            </button>
            <button type="button" role="menuitem" onClick={() => setHolding(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
