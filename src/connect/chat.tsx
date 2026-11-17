'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useConnect } from './context';
import { hasPaymentTalk, PAYMENT_NOTE } from './safety';
import { navigate } from './router';
import { play } from './sounds';
import { alertsUndecided, askForAlerts } from './alerts';
import type { Attachment, Conversation, Message, Profile } from './types';
import { A, Avatar, Empty, Icon, Loading, BeltBadge } from './ui';

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
const MAX_VOICE_SECONDS = 5 * 60;

const clock = (s: number) => {
  const t = Math.max(0, Math.round(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
const size = (b?: number | null) =>
  !b ? '' : b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(0.1, Math.round((b / 1024) * 10) / 10)} kB`;
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
};

function kindOf(file: File): Attachment['kind'] {
  if (file.type.startsWith('image/') && file.type !== 'image/svg+xml') return 'image';
  if (file.type.startsWith('video/')) return 'video';
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

/* ---------- Voice note player ---------- */
function Voice({ src, duration }: { src: string | null | undefined; duration?: number | null }) {
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
function loadDownloaded(): Set<string> {
  try {
    return new Set(JSON.parse(window.localStorage.getItem(DL_KEY) || '[]') as string[]);
  } catch {
    return new Set();
  }
}
function rememberDownloaded(ids: Set<string>) {
  try {
    window.localStorage.setItem(DL_KEY, JSON.stringify([...ids].slice(-500)));
  } catch {
    /* private mode: remembered for this visit only */
  }
}

const EXT: Record<string, string> = { image: 'jpg', video: 'mp4', voice: 'm4a', file: 'bin' };
function fileNameFor(m: Message, type: string) {
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
function Viewer({ m, onClose, onSave }: { m: Message; onClose: () => void; onSave: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
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
        <img src={m.media_url ?? undefined} alt="" onClick={(e) => e.stopPropagation()} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------
   Before sending photos, videos or files: a review screen. Look at
   what you picked, drop any you don't want, add more, write a caption,
   then send. Nothing uploads until you tap send.
------------------------------------------------------------------- */
type Picked = { key: string; file: File; kind: Attachment['kind']; url: string };

function SendPreview({
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
  const blocked = hasPaymentTalk(caption);
  const tooBig = items.some((x) => x.file.size > MAX_FILE);
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
        {(blocked || tooBig) && (
          <p className="cx-pre-warn" role="alert">
            {blocked ? PAYMENT_NOTE : 'Files can be up to 50 MB. Remove the large one to send.'}
          </p>
        )}
        <div className="cx-pre-send">
          <label className="sr-only" htmlFor="pre-caption">
            Caption
          </label>
          <textarea id="pre-caption" rows={1} maxLength={1000} placeholder="Add a caption" value={caption} onChange={(e) => onCaption(e.target.value)} />
          <button type="button" className="cx-send" disabled={blocked || tooBig} onClick={onSend} aria-label={`Send to ${to}`}>
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

/* ---------- One message ---------- */
export function Bubble({
  m,
  mine,
  ready,
  onHold,
  onRetry,
  onDownload,
  onOpen,
}: {
  m: Message;
  mine: boolean;
  /** Downloaded (or sent by me): show the media itself */
  ready: boolean;
  onHold: (m: Message) => void;
  onRetry?: (m: Message) => void;
  onDownload: (m: Message) => void;
  onOpen: (m: Message) => void;
}) {
  const timer = useRef<number | undefined>(undefined);
  const hold = {
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      onHold(m);
    },
    onTouchStart: () => {
      timer.current = window.setTimeout(() => onHold(m), 450);
    },
    onTouchEnd: () => window.clearTimeout(timer.current),
    onTouchMove: () => window.clearTimeout(timer.current),
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
      className={[
        'cx-msg',
        mine ? 'is-mine' : '',
        kind !== 'text' ? `is-${kind}` : '',
        (kind === 'image' || kind === 'video') && !m.body ? 'is-bare' : '',
        m.pending ? 'is-pending' : '',
        m.failed ? 'is-failed' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      {...hold}
      onClick={m.failed && onRetry ? () => onRetry(m) : undefined}
    >
      {kind === 'voice' && <Voice src={m.media_url} duration={m.duration} />}
      {(kind === 'image' || kind === 'video') &&
        (ready && m.media_url ? (
          kind === 'image' ? (
            <button type="button" className="cx-msg-media" onClick={() => onOpen(m)} aria-label="Open photo">
              <img src={m.media_url} alt="" />
            </button>
          ) : (
            <div className="cx-msg-media">
              <video src={`${m.media_url}#t=0.1`} controls playsInline preload="metadata" />
            </div>
          )
        ) : (
          // Not downloaded yet (WhatsApp-style): nothing is fetched until it's tapped
          <button type="button" className={m.thumb ? 'cx-msg-media cx-msg-dl has-thumb' : 'cx-msg-media cx-msg-dl'} onClick={() => onDownload(m)} disabled={!m.media_url}>
            {m.thumb ? <img className="cx-msg-thumb" src={m.thumb} alt="" /> : <Icon name={kind === 'image' ? 'image' : 'video'} size={30} />}
            <span className="cx-msg-dl-btn">
              <Icon name="download" size={18} />
              {size(m.file_size) || 'Download'}
            </span>
          </button>
        ))}
      {kind === 'file' && (
        <button type="button" className="cx-msg-file" onClick={() => onDownload(m)} disabled={!m.media_url}>
          <span className="cx-msg-file-ico">
            <Icon name="file" />
          </span>
          <span className="cx-msg-file-text">
            <strong>{m.file_name || 'File'}</strong>
            <small>{size(m.file_size)} · Tap to save</small>
          </span>
          <Icon name="download" size={18} />
        </button>
      )}
      {m.pending && m.progress !== undefined && m.progress < 1 && (
        <span className="cx-msg-progress" aria-hidden="true">
          <span style={{ transform: `scaleX(${Math.max(0.05, m.progress)})` }} />
        </span>
      )}
      {m.body && <p>{m.body}</p>}
      <span className="cx-msg-meta">
        <time dateTime={m.created_at}>{hhmm(m.created_at)}</time>
        {mine && <Status m={m} />}
      </span>
    </li>
  );
}

/* ---------- The chat ---------- */
export function Chat({ id }: { id: string }) {
  const { api, me, signedIn, toast, ask } = useConnect();
  const [conv, setConv] = useState<Conversation | null | undefined>(undefined);
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [local, setLocal] = useState<Message[]>([]); // still sending
  const [draft, setDraft] = useState('');
  const [blocked, setBlocked] = useState(false);
  const [menu, setMenu] = useState(false);
  const [held, setHeld] = useState<Message | null>(null);
  const [rec, setRec] = useState<{ start: number; secs: number } | null>(null);
  const end = useRef<HTMLLIElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const recorder = useRef<{ mr: MediaRecorder; chunks: Blob[]; stream: MediaStream; cancel: boolean } | null>(null);
  const retries = useRef(new Map<string, { a: Attachment; caption: string }>());
  const [downloaded, setDownloaded] = useState<Set<string>>(() => new Set());
  const [viewing, setViewing] = useState<Message | null>(null);
  useEffect(() => setDownloaded(loadDownloaded()), []);

  const load = useCallback(async () => {
    const list = await api.listMessages(id);
    setMsgs(list);
    if (me && list.some((m) => m.sender_id !== me.id && !m.read_at && !m.deleted_at)) api.markRead(id).catch(() => {});
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
    const t = window.setInterval(() => document.visibilityState === 'visible' && load().catch(() => {}), 20000);
    return () => {
      stop();
      window.clearInterval(t);
    };
  }, [api, id, me, load]);

  const all = [...msgs, ...local];
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [all.length]);

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

  const [picked, setPicked] = useState<Picked[]>([]);
  const [caption, setCaption] = useState('');

  if (!signedIn) return <Empty title="Sign in to see your messages" />;
  if (me === undefined || conv === undefined) return <Loading />;
  if (!me) return <Empty title="Finish your profile first" />;
  if (conv === null) return <Empty title="Conversation not found" />;

  const other = conv.other;

  /* sending text */
  const sendText = async () => {
    const body = draft.trim();
    if (!body || hasPaymentTalk(body)) return;
    setDraft('');
    play('send');
    const tmp: Message = { id: `tmp-${Date.now()}`, conversation_id: id, sender_id: me.id, body, created_at: new Date().toISOString(), kind: 'text', pending: true };
    setLocal((l) => [...l, tmp]);
    try {
      const m = await api.sendMessage(id, body);
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
    if (a.file.size > MAX_FILE) return toast('Files can be up to 50 MB.');
    if (caption && hasPaymentTalk(caption)) return toast(PAYMENT_NOTE);
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
    upload(tmp, thumb ? { ...a, thumb } : a, caption);
  };

  const upload = async (tmp: Message, a: Attachment, caption: string) => {
    retries.current.set(tmp.id, { a, caption });
    try {
      const m = await api.sendAttachment(id, a, caption, (p) => setLocal((l) => l.map((x) => (x.id === tmp.id ? { ...x, progress: p } : x))));
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
  const pickFiles = (files: FileList | null) => {
    if (!files?.length) return;
    if (!picked.length) {
      // Whatever was typed becomes the caption
      setCaption(draft.trim());
      setDraft('');
    }
    const add = Array.from(files).map((f, n) => ({ key: `${Date.now()}-${n}-${f.name}`, file: f, kind: kindOf(f), url: URL.createObjectURL(f) }));
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
    if (hasPaymentTalk(text)) return;
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
  const download = (m: Message) => {
    if (m.kind === 'file') return saveToPhone(m, toast);
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
    toast('Thanks. A moderator will take a look.');
  };

  /* header menu */
  const reportUser = async () => {
    setMenu(false);
    const reason = await ask({ title: `Report ${other.name}`, body: 'A moderator will look at it. They won’t know who reported them.', input: 'What’s wrong?', confirm: 'Send report' });
    if (!reason) return;
    await api.report('profile', other.id, reason);
    toast('Thanks. A moderator will take a look.');
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
              {other.name}
              {other.is_student && <BeltBadge p={other} small />}
            </span>
            <span className="cx-person-meta">@{other.handle}</span>
          </span>
        </A>
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

      <ol className="cx-msgs">
        <li className="cx-chat-note">Never send money or bank details on Connect. Report anyone who asks.</li>
        {all.map((m) => {
          const day = dayLabel(m.created_at);
          const showDay = day !== lastDay;
          lastDay = day;
          return (
            <React.Fragment key={m.id}>
              {showDay && <li className="cx-day">{day}</li>}
              <Bubble
                m={m}
                mine={m.sender_id === me.id}
                ready={m.sender_id === me.id || downloaded.has(m.id)}
                onHold={(x) => !x.pending && !x.id.startsWith('tmp-') && setHeld(x)}
                onRetry={retry}
                onDownload={download}
                onOpen={setViewing}
              />
            </React.Fragment>
          );
        })}
        <li ref={end} className="cx-msgs-end" aria-hidden="true" />
      </ol>

      {hasPaymentTalk(draft) && (
        <p className="cx-safety" role="alert">
          {PAYMENT_NOTE}
        </p>
      )}

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
        <form
          className="cx-compose cx-chat-compose"
          onSubmit={(e) => {
            e.preventDefault();
            sendText();
          }}
        >
          <button type="button" className="cx-icon-btn cx-icon-flat cx-attach" onClick={() => fileInput.current?.click()} aria-label="Attach a photo, video or file">
            <Icon name="clip" />
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            className="sr-only"
            accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.aep,.prproj,.psd,.ai,.xml"
            onChange={(e) => {
              pickFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <label className="sr-only" htmlFor="msg-box">
            Message
          </label>
          {/* Enter adds a new line; only the send button sends */}
          <textarea ref={box} id="msg-box" rows={1} maxLength={4000} placeholder="Message" value={draft} onChange={(e) => setDraft(e.target.value)} enterKeyHint="enter" />
          {typing ? (
            <button type="submit" className="cx-send" disabled={hasPaymentTalk(draft)} aria-label="Send">
              <Icon name="send" size={20} />
            </button>
          ) : (
            <button type="button" className="cx-send" onClick={startRecording} aria-label="Record a voice note">
              <Icon name="mic" size={20} />
            </button>
          )}
        </form>
      )}

      {held && (
        <div className="cx-sheet-wrap" onClick={() => setHeld(null)}>
          <div className="cx-sheet" role="menu" onClick={(e) => e.stopPropagation()}>
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
            {held.sender_id === me.id ? (
              <button type="button" role="menuitem" className="cx-danger" onClick={() => remove(held)}>
                <Icon name="trash" /> Delete for everyone
              </button>
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
  const [list, setList] = useState<Conversation[] | null>(null);
  const [people, setPeople] = useState<Profile[]>([]);
  const [q, setQ] = useState('');
  const [opening, setOpening] = useState('');
  const [askAlerts, setAskAlerts] = useState(false);
  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem('cx-alerts-asked') === '1';
    } catch {
      /* ignore */
    }
    setAskAlerts(alertsUndecided() && !dismissed);
  }, []);
  const answerAlerts = async (yes: boolean) => {
    setAskAlerts(false);
    try {
      localStorage.setItem('cx-alerts-asked', '1');
    } catch {
      /* ignore */
    }
    if (yes && (await askForAlerts())) toast('Message alerts are on');
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
      <h1 className="cx-inbox-title">Messages</h1>

      {askAlerts && (
        <div className="cx-alerts-ask">
          <p>Get an alert on this device when someone messages you.</p>
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
                <Avatar p={p} size={60} />
                <span>{p.name.split(' ')[0]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

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
      ) : (
        <ul className="cx-inbox">
          {chats.map((c) => {
            const unread = c.unread ?? 0;
            const kind = c.last_kind && c.last_kind !== 'text' && !c.last_deleted ? c.last_kind : null;
            return (
              <li key={c.id}>
                <A path={`/messages/${c.id}`} className={unread ? 'cx-inbox-row is-unread' : 'cx-inbox-row'}>
                  <Avatar p={c.other} size={56} />
                  <span className="cx-inbox-text">
                    <span className="cx-inbox-top">
                      <span className="cx-person-name">
                        {c.other.name}
                        {c.other.is_sensei ? null : c.other.is_student && <BeltBadge p={c.other} small />}
                      </span>
                      <span className="cx-inbox-time">{shortTime(c.last_message_at)}</span>
                    </span>
                    <span className="cx-inbox-bottom">
                      <span className="cx-inbox-last">
                        {c.last_mine && !c.last_deleted && (
                          <span className={c.last_read ? 'cx-tick is-seen' : 'cx-tick'} aria-label={c.last_read ? 'Seen' : c.last_delivered ? 'Delivered' : 'Sent'}>
                            <Icon name={c.last_read || c.last_delivered ? 'ticks' : 'tick'} size={16} />
                          </span>
                        )}
                        {kind && <Icon name={KIND_ICON[kind]} size={16} />}
                        <span className="cx-inbox-snippet">{c.last_body || 'Say hello'}</span>
                      </span>
                      {unread > 0 && <span className="cx-inbox-count">{unread > 99 ? '99+' : unread}</span>}
                    </span>
                  </span>
                </A>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
