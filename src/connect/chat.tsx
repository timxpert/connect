'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useConnect } from './context';
import { hasPaymentTalk, PAYMENT_NOTE } from './safety';
import { navigate } from './router';
import { play } from './sounds';
import type { Attachment, Conversation, Message, Profile } from './types';
import { A, Avatar, Empty, Icon, Loading, NinjaBadge } from './ui';

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
  !b ? '' : b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
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
  if (m.failed) return <span className="cx-tick is-failed">Not sent</span>;
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
          preload="metadata"
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

/* ---------- One message ---------- */
function Bubble({ m, mine, onHold }: { m: Message; mine: boolean; onHold: (m: Message) => void }) {
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
    <li className={['cx-msg', mine ? 'is-mine' : '', kind !== 'text' ? `is-${kind}` : '', m.pending ? 'is-pending' : ''].filter(Boolean).join(' ')} {...hold}>
      {kind === 'voice' && <Voice src={m.media_url} duration={m.duration} />}
      {kind === 'image' && (
        <a className="cx-msg-media" href={m.media_url ?? undefined} target="_blank" rel="noopener noreferrer">
          {m.media_url ? <img src={m.media_url} alt="" /> : <span className="cx-msg-media-ph" />}
        </a>
      )}
      {kind === 'video' && <div className="cx-msg-media">{m.media_url ? <video src={`${m.media_url}#t=0.1`} controls playsInline preload="metadata" /> : <span className="cx-msg-media-ph" />}</div>}
      {kind === 'file' && (
        <a className="cx-msg-file" href={m.media_url ?? undefined} target="_blank" rel="noopener noreferrer" download={m.file_name ?? undefined}>
          <span className="cx-msg-file-ico">
            <Icon name="file" />
          </span>
          <span className="cx-msg-file-text">
            <strong>{m.file_name || 'File'}</strong>
            <small>{size(m.file_size)}</small>
          </span>
        </a>
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
    const t = window.setInterval(() => document.visibilityState === 'visible' && load().catch(() => {}), 3000);
    return () => window.clearInterval(t);
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
    try {
      const m = await api.sendAttachment(id, a, caption, (p) => setLocal((l) => l.map((x) => (x.id === tmp.id ? { ...x, progress: p } : x))));
      setMsgs((xs) => [...xs, m]);
      setLocal((l) => l.filter((x) => x.id !== tmp.id));
    } catch (e) {
      setLocal((l) => l.map((x) => (x.id === tmp.id ? { ...x, failed: true, pending: false } : x)));
      toast((e as Error).message);
    }
  };

  const pickFiles = (files: FileList | null) => {
    if (!files) return;
    const caption = draft.trim();
    Array.from(files)
      .slice(0, 10)
      .forEach((f, i) => sendFile({ file: f, kind: kindOf(f) }, i === 0 ? caption : ''));
    if (caption) setDraft('');
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
              {other.is_student && <NinjaBadge p={other} small />}
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
              <Bubble m={m} mine={m.sender_id === me.id} onHold={(x) => !x.pending && !x.id.startsWith('tmp-') && setHeld(x)} />
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

  useEffect(() => {
    if (!me) return;
    const load = () => api.listConversations().then(setList).catch(() => setList((l) => l ?? []));
    load();
    api.listConnections().then(setPeople).catch(() => {});
    const t = window.setInterval(() => document.visibilityState === 'visible' && load(), 10000);
    return () => window.clearInterval(t);
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
          <p>{people.length ? 'Tap someone above to start a chat.' : 'Connect with other Ninjas, then message them here.'}</p>
          {!people.length && (
            <A path="/students" className="btn btn-primary btn-sm">
              Find Ninjas
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
                        {c.other.is_sensei ? null : c.other.is_student && <NinjaBadge p={c.other} small />}
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
