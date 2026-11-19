'use client';
/* The Dojo group: one chat for every student and the team.
   Text, photos, videos (made smaller before sending), voice notes, replies
   and reactions. The team can pin a message, remove any message, mute a
   student for a while and switch the group to announcements only. */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useConnect } from './context';
import { peek } from './cache';
import { useDragToClose } from './drag';
import { navigate } from './router';
import { useOnline } from './presence';
import { play } from './sounds';
import { compressVideo, MAX_VIDEO_SECONDS, videoSeconds } from './compress';
import { AttachSheet, Bubble, canUnsend, TOO_LATE, clock, dayLabel, kindOf, openFile, loadDownloaded, makeThumb, MAX_VOICE_SECONDS, rememberDownloaded, saveToPhone, SendPreview, Viewer, type Picked } from './chat';
import { ForwardSheet } from './forward';
import type { Attachment, GroupHistory, GroupInfo, GroupMessage, GroupReader, Profile } from './types';
import { A, Avatar, BeltBadge, Empty, Icon, Loading } from './ui';

const MAX_FILE = 50 * 1024 * 1024;
const EMOJI = ['👍', '❤️', '😂', '🔥', '👏', '🙏'];
const HISTORY: [GroupHistory, string][] = [
  ['all', 'Everything'],
  ['14d', 'The last 14 days'],
  ['100', 'The last 100 messages'],
  ['none', 'Only messages after they join'],
];

const snippet = (m: GroupMessage) =>
  m.deleted_at ? 'Deleted message' : m.kind === 'voice' ? 'Voice message' : m.kind === 'image' ? m.body || 'Photo' : m.kind === 'video' ? m.body || 'Video' : m.kind === 'file' ? m.body || m.file_name || 'Document' : m.body;

/** "Ada, Tunde, Kemi, You": the people in the group, for the header */
function memberNames(people: Profile[], me: string) {
  if (!people.length) return '';
  const others = people
    .filter((p) => p.id !== me)
    .sort((a, b) => Number(b.is_sensei || b.is_moderator) - Number(a.is_sensei || a.is_moderator) || a.name.localeCompare(b.name))
    .map((p) => p.name.trim().split(/\s+/)[0]);
  return [...others.slice(0, 30), 'You'].join(', ');
}

function whoName(m: GroupMessage) {
  const n = m.sender?.name ?? 'Member';
  if (m.sender?.is_sensei) return /sensei/i.test(n) ? n : `${n} · Grand Sensei`;
  return m.sender?.is_moderator ? `${n} · Team` : n;
}

export function GroupChat() {
  const { api, me, signedIn, toast, ask } = useConnect();
  const [info, setInfo] = useState<GroupInfo | null | undefined>(() => peek<GroupInfo | null>('groupInfo'));
  const [msgs, setMsgs] = useState<GroupMessage[]>(() => peek<GroupMessage[]>('listGroupMessages') ?? []);
  const [local, setLocal] = useState<GroupMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<GroupMessage | null>(null);
  const [held, setHeld] = useState<GroupMessage | null>(null);
  const [forwarding, setForwarding] = useState<GroupMessage | null>(null);
  const [readers, setReaders] = useState<GroupReader[]>([]);
  const [seenOf, setSeenOf] = useState<GroupMessage | null>(null);
  const [menu, setMenu] = useState(false);
  const [rec, setRec] = useState<{ start: number; secs: number } | null>(null);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [caption, setCaption] = useState('');
  const [downloaded, setDownloaded] = useState<Set<string>>(() => new Set());
  const [viewing, setViewing] = useState<GroupMessage | null>(null);
  const [error, setError] = useState('');
  const [people, setPeople] = useState<Profile[]>([]);
  const [caret, setCaret] = useState(0);
  const placeCaret = useRef<number | null>(null);
  const end = useRef<HTMLLIElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [attach, setAttach] = useState(false);
  const recorder = useRef<{ mr: MediaRecorder; chunks: Blob[]; stream: MediaStream; cancel: boolean } | null>(null);
  const heldSheet = useDragToClose<HTMLDivElement>(() => setHeld(null), Boolean(held));
  useEffect(() => setDownloaded(loadDownloaded()), []);

  const team = Boolean(me?.is_sensei || me?.is_moderator);

  // after picking a mention, put the cursor right after it
  useEffect(() => {
    const pos = placeCaret.current;
    if (pos === null || !box.current) return;
    placeCaret.current = null;
    box.current.focus();
    box.current.setSelectionRange(pos, pos);
  }, [draft]);

  // people to @mention: members, plus anyone who has posted in the group (the team)
  useEffect(() => {
    if (me) api.groupMembers().then(setPeople).catch(() => {});
  }, [api, me]);

  // the first message I hadn't read when I opened the group
  const [unreadFrom, setUnreadFrom] = useState<string | null | undefined>(undefined);
  const firstLoad = useRef(true);
  const load = useCallback(async () => {
    const [list, i, lastRead] = await Promise.all([api.listGroupMessages(), api.groupInfo(), firstLoad.current ? api.groupLastRead().catch(() => null) : Promise.resolve(null)]);
    if (firstLoad.current && me) {
      firstLoad.current = false;
      setUnreadFrom(list.find((m) => m.sender_id !== me.id && !m.deleted_at && (!lastRead || m.created_at > lastRead))?.id ?? null);
    }
    setMsgs(list);
    setInfo(i);
    api.groupReaders().then(setReaders).catch(() => {});
    api
      .markGroupRead()
      .then(() => window.dispatchEvent(new Event('cx:counts')))
      .catch(() => {});
  }, [api, me]);

  useEffect(() => {
    if (!me) return;
    load().catch((e: Error) => setError(e.message));
    const stops = [
      api.subscribe('group_messages', '', () => load().catch(() => {})),
      api.subscribe('group_reactions', '', () => load().catch(() => {})),
      api.subscribe('group_settings', '', () => load().catch(() => {})),
    ];
    const t = window.setInterval(() => document.visibilityState === 'visible' && load().catch(() => {}), 30000);
    // read counts change when other people open the group
    const r = window.setInterval(() => document.visibilityState === 'visible' && api.groupReaders().then(setReaders).catch(() => {}), 12000);
    return () => {
      stops.forEach((s) => s());
      window.clearInterval(t);
      window.clearInterval(r);
    };
  }, [api, me, load]);

  /** Members (not me) who opened the group after this message arrived */
  const seenBy = (m: GroupMessage) => readers.filter((r) => r.id !== m.sender_id && r.read_at >= m.created_at);

  const all = [...msgs, ...local];
  // Open where you left off: at the first message you haven't read (under an
  // "Unread messages" line), or at the newest one if you've read everything.
  // New messages after that glide into view. Only the message list moves.
  const opened = useRef(false);
  useEffect(() => {
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

  if (!signedIn) return <Empty title="Sign in to see the group" />;
  if (me === undefined || info === undefined) return error ? <Empty title="The group can’t load">{<p>{error}</p>}</Empty> : <Loading />;
  if (!me || info === null) return <NotInGroup onBack={() => load().catch(() => {})} />;

  const muted = info.muted_until && new Date(info.muted_until).getTime() > Date.now();
  const canSend = !muted && (team || !info.announce_only);
  const byId = new Map(all.map((m) => [m.id, m]));
  const pinned = info.pinned_id ? byId.get(info.pinned_id) : undefined;

  const jump = (mid: string) => {
    const el = document.getElementById(`gm-${mid}`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add('is-flash');
    window.setTimeout(() => el.classList.remove('is-flash'), 1200);
  };

  /* sending */
  const sendText = async () => {
    const body = draft.trim();
    if (!body) return;
    const reply = replyTo?.id ?? null;
    setDraft('');
    setReplyTo(null);
    play('send');
    const tmp: GroupMessage = { id: `tmp-${Date.now()}`, conversation_id: 'group', sender_id: me.id, body, created_at: new Date().toISOString(), kind: 'text', reply_to: reply, pending: true };
    setLocal((l) => [...l, tmp]);
    try {
      const m = await api.sendGroupMessage(body, reply);
      setMsgs((xs) => [...xs, m]);
    } catch (e) {
      setDraft(body);
      toast((e as Error).message);
    } finally {
      setLocal((l) => l.filter((x) => x.id !== tmp.id));
    }
    box.current?.focus();
  };

  const setProgress = (id: string, p: number) => setLocal((l) => l.map((x) => (x.id === id ? { ...x, progress: p } : x)));
  const failLocal = (id: string) => setLocal((l) => l.map((x) => (x.id === id ? { ...x, failed: true, pending: false } : x)));

  const sendFile = async (a: Attachment, text = '') => {
    if (a.kind !== 'video' && a.file.size > MAX_FILE) return toast('Files can be up to 50 MB.');
    if (a.kind === 'video') {
      const secs = await videoSeconds(a.file);
      if (secs && !a.duration) a = { ...a, duration: Math.round(secs) };
    }
    if (a.kind === 'video' && (a.duration ?? 0) > MAX_VIDEO_SECONDS) return toast('Videos can be up to 3 minutes. Share a Google Drive link for longer ones.');
    const reply = replyTo?.id ?? null;
    setReplyTo(null);
    const tmp: GroupMessage = {
      id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      conversation_id: 'group',
      sender_id: me.id,
      body: text,
      created_at: new Date().toISOString(),
      kind: a.kind,
      media_url: URL.createObjectURL(a.file),
      file_name: a.file.name,
      file_size: a.file.size,
      duration: a.duration,
      reply_to: reply,
      pending: true,
      progress: 0,
    };
    setLocal((l) => [...l, tmp]);
    play('send');
    const thumb = await makeThumb(a.file, a.kind);
    let file = a.file;
    if (a.kind === 'video') {
      file = await compressVideo(a.file, (p) => setProgress(tmp.id, p * 0.5));
      if (file.size > MAX_FILE) {
        failLocal(tmp.id);
        return toast('This video is still over 50 MB. Share a Google Drive link instead.');
      }
    }
    const from = a.kind === 'video' ? 0.5 : 0;
    try {
      const m = await api.sendGroupAttachment({ ...a, file, ...(thumb ? { thumb } : {}) }, text, reply, (p) => setProgress(tmp.id, from + p * (1 - from)));
      setMsgs((xs) => [...xs, m]);
      setLocal((l) => l.filter((x) => x.id !== tmp.id));
    } catch (e) {
      failLocal(tmp.id);
      toast((e as Error).message);
    }
  };

  const pickFiles = (files: FileList | File[] | null, asDocument = false) => {
    if (!files?.length) return;
    if (!picked.length) {
      setCaption(draft.trim());
      setDraft('');
    }
    // videos are always videos; from Document, photos go as files too
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
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch {
      return toast('Allow microphone access to record a voice note.');
    }
    const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'].find((t) => MediaRecorder.isTypeSupported?.(t));
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
      sendFile({ file: new File(r.chunks, `voice-${Date.now()}.${ext}`, { type: mime.split(';')[0] }), kind: 'voice', duration: Math.round(secs * 10) / 10 });
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

  const download = (m: GroupMessage) =>
    setDownloaded((d) => {
      const next = new Set(d).add(m.id);
      rememberDownloaded(next);
      return next;
    });

  /* holding a message */
  const react = async (m: GroupMessage, emoji: string) => {
    setHeld(null);
    const mine = m.reactions?.find((r) => r.mine);
    const next = mine?.emoji === emoji ? null : emoji;
    // show it at once
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
    await api.reactGroup(m.id, next).catch((e: Error) => toast(e.message));
  };
  const remove = async (m: GroupMessage) => {
    setHeld(null);
    const theirs = m.sender_id !== me.id;
    if (!(await ask({ title: theirs ? `Delete ${m.sender?.name ?? 'this member'}’s message?` : 'Delete this message?', body: 'Everyone in the group will see “This message was deleted”.', confirm: 'Delete', danger: true }))) return;
    setMsgs((xs) => xs.map((x) => (x.id === m.id ? { ...x, deleted_at: new Date().toISOString(), body: '', media_url: null, reactions: [] } : x)));
    await api.deleteGroupMessage(m.id).catch((e: Error) => toast(e.message));
  };
  const replyPrivately = async (m: GroupMessage) => {
    setHeld(null);
    try {
      const cid = await api.openConversation(m.sender_id);
      try {
        sessionStorage.setItem(`cx-quote-${cid}`, JSON.stringify({ name: m.sender?.name ?? 'Member', text: snippet(m).slice(0, 300) }));
      } catch {
        /* ignore */
      }
      navigate(`/messages/${cid}`);
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const copy = async (m: GroupMessage) => {
    setHeld(null);
    try {
      await navigator.clipboard.writeText(m.body);
      toast('Copied');
    } catch {
      /* ignore */
    }
  };
  const pin = async (m: GroupMessage | null) => {
    setHeld(null);
    setInfo({ ...info, pinned_id: m?.id ?? null });
    await api.setGroupSettings({ pinned_id: m?.id ?? null }).catch((e: Error) => toast(e.message));
  };
  const mute = async (m: GroupMessage) => {
    setHeld(null);
    const name = m.sender?.name ?? 'this member';
    if (!(await ask({ title: `Mute ${name} for 24 hours?`, body: 'They can still read the group but can’t send messages until then.', confirm: 'Mute' }))) return;
    await api
      .muteInGroup(m.sender_id, 24)
      .then(() => toast(`${name} is muted for 24 hours`))
      .catch((e: Error) => toast(e.message));
  };
  const reportMsg = async (m: GroupMessage) => {
    setHeld(null);
    const reason = await ask({ title: 'Report this message', body: 'A moderator will look at it. They won’t know who reported it.', input: 'What’s wrong?', confirm: 'Send report' });
    if (!reason) return;
    await api.report('message', m.id, reason);
    toast('Reported. A moderator will look at it.');
  };

  /* @mentions: suggestions while typing @name */
  const before = draft.slice(0, caret);
  const at = /(^|\s)@([A-Za-z0-9_]{0,30})$/.exec(before);
  const term = at ? at[2].toLowerCase() : null;
  const pool = new Map<string, Profile>();
  for (const p of people) pool.set(p.id, p);
  for (const m of msgs) if (m.sender && !pool.has(m.sender.id)) pool.set(m.sender.id, m.sender);
  pool.delete(me.id);
  const suggestions =
    term === null ? [] : [...pool.values()].filter((p) => p.handle.toLowerCase().startsWith(term) || p.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(term))).slice(0, 5);
  const mention = (p: Profile) => {
    const start = before.length - (at ? at[2].length + 1 : 0);
    const next = `${draft.slice(0, start)}@${p.handle} ${draft.slice(caret)}`;
    setDraft(next);
    const pos = start + p.handle.length + 2;
    setCaret(pos);
    placeCaret.current = pos;
  };



  const typing = draft.trim().length > 0;
  let lastDay = '';
  let lastSender = '';

  return (
    <div className="cx-col cx-chat cx-group">
      <header className="cx-chat-head">
        <A path="/messages" className="cx-icon-btn cx-icon-flat" aria-label="All messages">
          <Icon name="back" />
        </A>
        <A path="/messages/group/info" className="cx-person" aria-label="Group info">
          <GroupPhoto url={info.photo_url} size={40} />
          <span className="cx-person-text">
            <span className="cx-person-name">{info.name || storedName()}</span>
            <span className="cx-person-meta cx-group-names">{memberNames(people, me.id) || `${info.members} members`}</span>
          </span>
        </A>
        {pinned && team && (
          <div className="cx-menu cx-chat-more">
            <button type="button" className="cx-icon-btn cx-icon-flat" aria-label="Group options" aria-expanded={menu} onClick={() => setMenu((x) => !x)}>
              <Icon name="more" />
            </button>
            {menu && (
              <>
                <div className="cx-menu-scrim" onClick={() => setMenu(false)} aria-hidden="true" />
                <div className="cx-menu-list" role="menu">
                  <A path="/messages/group/info" role="menuitem">
                    Group info
                  </A>
                  <button type="button" role="menuitem" onClick={() => (setMenu(false), pin(null))}>
                    Unpin message
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </header>

      {pinned && !pinned.deleted_at && (
        <button type="button" className="cx-pinned" onClick={() => jump(pinned.id)}>
          <Icon name="bookmark" size={16} />
          <span>
            <b>{pinned.sender?.name ?? 'Pinned'}</b> {snippet(pinned)}
          </span>
        </button>
      )}

      <ol className="cx-msgs">
        {all.length === 0 && <li className="cx-day">No messages yet</li>}
        {all.map((m) => {
          const day = dayLabel(m.created_at);
          const showDay = day !== lastDay;
          if (showDay) lastSender = '';
          lastDay = day;
          // "Ada Okafor joined the group" (sent automatically when a student joins)
          if ((m.kind as string) === 'join') {
            lastSender = '';
            return (
              <React.Fragment key={m.id}>
                {showDay && <li className="cx-day">{day}</li>}
                <li className="cx-day cx-joined">{m.sender_id === me.id ? 'You joined the group' : `${m.sender?.name ?? 'Someone'} joined the group`}</li>
              </React.Fragment>
            );
          }
          const mine = m.sender_id === me.id;
          const showWho = !mine && m.sender_id !== lastSender;
          lastSender = m.sender_id;
          const parent = m.reply_to ? byId.get(m.reply_to) : undefined;
          return (
            <React.Fragment key={m.id}>
              {showDay && <li className="cx-day">{day}</li>}
              {m.id === unreadFrom && <li className="cx-unread">Unread messages</li>}
              <Bubble
                  domId={`gm-${m.id}`}
                  m={m}
                  mine={mine}
                  ready={mine || downloaded.has(m.id)}
                  who={showWho ? { name: whoName(m) } : null}
                  quote={parent ? { name: parent.sender_id === me.id ? 'You' : parent.sender?.name ?? 'Member', text: snippet(parent).slice(0, 120), onClick: () => jump(parent.id) } : null}
                  reactions={m.reactions}
                  onReact={(e) => react(m, e)}
                  noTicks
                  seen={mine ? seenBy(m).length : undefined}
                  onSeen={() => setSeenOf(m)}
                  onHold={(x) => !x.pending && !x.id.startsWith('tmp-') && !x.deleted_at && setHeld(x as GroupMessage)}
                  onDownload={(x) => download(x as GroupMessage)}
                  onOpen={(x) => (x.kind === 'file' ? openFile(x, toast) : setViewing(x as GroupMessage))}
                />
            </React.Fragment>
          );
        })}
        <li ref={end} className="cx-msgs-end" aria-hidden="true" />
      </ol>

      {!canSend ? (
        <div className="cx-chat-blocked">
          <p>{muted ? `You’re muted in the group until ${new Date(info.muted_until!).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}.` : 'Only the team can post right now.'}</p>
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
          {suggestions.length > 0 && (
            <ul className="cx-mentions" role="listbox" aria-label="Mention someone">
              {suggestions.map((p) => (
                <li key={p.id}>
                  <button type="button" role="option" aria-selected="false" onMouseDown={(e) => e.preventDefault()} onClick={() => mention(p)}>
                    <Avatar p={p} size={30} />
                    <span>
                      <b>{p.name}</b>
                      <small>@{p.handle}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {replyTo && (
            <div className="cx-replying">
              <span>
                <b>Replying to {replyTo.sender_id === me.id ? 'yourself' : replyTo.sender?.name}</b>
                <small>{snippet(replyTo).slice(0, 120)}</small>
              </span>
              <button type="button" className="cx-icon-btn cx-icon-flat" aria-label="Cancel reply" onClick={() => setReplyTo(null)}>
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
            <label className="sr-only" htmlFor="group-box">
              Message
            </label>
            <textarea
              ref={box}
              id="group-box"
              rows={1}
              maxLength={4000}
              placeholder="Message the group"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setCaret(e.target.selectionStart ?? e.target.value.length);
              }}
              onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
              enterKeyHint="enter"
            />
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

      {seenOf && <SeenBy m={seenOf} readers={seenBy(seenOf)} onClose={() => setSeenOf(null)} />}

      {held && (
        <div className="cx-sheet-wrap" onClick={() => setHeld(null)}>
          <div className="cx-sheet cx-drag" role="menu" ref={heldSheet} onClick={(e) => e.stopPropagation()}>
            <span className="cx-grab" aria-hidden="true" />
            <div className="cx-rx-pick" role="group" aria-label="React">
              {EMOJI.map((e) => (
                <button key={e} type="button" className={held.reactions?.some((r) => r.mine && r.emoji === e) ? 'is-on' : ''} onClick={() => react(held, e)} aria-label={`React ${e}`}>
                  {e}
                </button>
              ))}
            </div>
            {canSend && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setReplyTo(held);
                  setHeld(null);
                  window.setTimeout(() => box.current?.focus(), 50);
                }}
              >
                <Icon name="back" /> Reply
              </button>
            )}
            {!held.pending && !held.deleted_at && (held.body || held.media_url) && (
              <button type="button" role="menuitem" onClick={() => (setForwarding(held), setHeld(null))}>
                <Icon name="forward" /> Forward
              </button>
            )}
            {held.sender_id === me.id && (
              <button type="button" role="menuitem" onClick={() => (setSeenOf(held), setHeld(null))}>
                <Icon name="ticks" /> Seen by {seenBy(held).length}
              </button>
            )}
            {held.sender_id !== me.id && (
              <button type="button" role="menuitem" onClick={() => replyPrivately(held)}>
                <Icon name="chat" /> Reply privately
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
            {team && (
              <button type="button" role="menuitem" onClick={() => pin(info.pinned_id === held.id ? null : held)}>
                <Icon name="bookmark" /> {info.pinned_id === held.id ? 'Unpin' : 'Pin to the top'}
              </button>
            )}
            {team && held.sender_id !== me.id && !held.sender?.is_sensei && !held.sender?.is_moderator && (
              <>
                <button type="button" role="menuitem" onClick={() => mute(held)}>
                  <Icon name="close" /> Mute {held.sender?.name} for 24 hours
                </button>
                <button type="button" role="menuitem" className="cx-danger" onClick={() => (setHeld(null), outOfGroup(api, ask, toast, held.sender!, false))}>
                  <Icon name="out" /> Remove {held.sender?.name} from the group
                </button>
                <button type="button" role="menuitem" className="cx-danger" onClick={() => (setHeld(null), outOfGroup(api, ask, toast, held.sender!, true))}>
                  <Icon name="close" /> Ban {held.sender?.name} from the group
                </button>
              </>
            )}
            {team || (held.sender_id === me.id && canUnsend(held.created_at, held.seen_at)) ? (
              <button type="button" role="menuitem" className="cx-danger" onClick={() => remove(held)}>
                <Icon name="trash" /> {held.sender_id === me.id ? 'Delete for everyone' : 'Delete message'}
              </button>
            ) : held.sender_id === me.id ? (
              <p className="cx-sheet-note">{TOO_LATE}</p>
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
          to={info.name || 'the group'}
          caption={caption}
          onCaption={setCaption}
          onRemove={(key) =>
            setPicked((p) => {
              const gone = p.find((x) => x.key === key);
              if (gone) URL.revokeObjectURL(gone.url);
              return p.filter((x) => x.key !== key);
            })
          }
          onAdd={() => fileInput.current?.click()}
          onClose={closePicked}
          onSend={sendPicked}
        />
      )}

      {viewing && <Viewer m={viewing} onClose={() => setViewing(null)} onSave={() => saveToPhone(viewing, toast)} />}
    </div>
  );
}

/** The group's picture: the photo the team chose, or the Motion Dojo logo */
function SeenBy({ m, readers, onClose }: { m: GroupMessage; readers: GroupReader[]; onClose: () => void }) {
  const sheet = useDragToClose<HTMLDivElement>(onClose);
  const sorted = [...readers].sort((a, b) => (a.read_at < b.read_at ? -1 : 1));
  return (
    <div className="cx-sheet-wrap" onClick={onClose}>
      <div className="cx-sheet cx-drag cx-seen" role="dialog" aria-label="Seen by" ref={sheet} onClick={(e) => e.stopPropagation()}>
        <span className="cx-grab" aria-hidden="true" />
        <h2 className="cx-fwd-title">Seen by {readers.length}</h2>
        {m.body && <p className="cx-seen-msg">{m.body.slice(0, 140)}</p>}
        {sorted.length ? (
          <ul className="cx-fwd-list" data-scroll>
            {sorted.map((r) => (
              <li key={r.id} className="cx-fwd-row">
                <Avatar p={{ name: r.name, avatar_url: r.avatar_url, handle: '' }} size={38} />
                <span className="cx-fwd-name">{r.name}</span>
                <small>{dayLabel(r.read_at) === 'Today' ? clock2(r.read_at) : `${dayLabel(r.read_at)}, ${clock2(r.read_at)}`}</small>
              </li>
            ))}
          </ul>
        ) : (
          <p className="cx-fwd-note">No one has seen it yet.</p>
        )}
      </div>
    </div>
  );
}

const clock2 = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** The group's name as last seen on this phone (so the old default never flashes) */
function storedName(): string {
  try {
    return (JSON.parse(localStorage.getItem('cx-group-look') || 'null') as { name?: string } | null)?.name || '';
  } catch {
    return '';
  }
}

export function GroupPhoto({ url, size }: { url?: string | null; size: number }) {
  return (
    <span className="cx-group-ico" style={{ width: size, height: size }} aria-hidden="true">
      <img src={url || '/assets/favicon-128.png'} alt="" width={size} height={size} />
    </span>
  );
}

/* ================= Group info ================= */
/** Team: take someone out of the group. Ban: they can't join again by themselves. */
async function outOfGroup(
  api: ReturnType<typeof useConnect>['api'],
  ask: ReturnType<typeof useConnect>['ask'],
  toast: (t: string) => void,
  p: Profile,
  ban: boolean,
  done?: () => void,
) {
  const ok = await ask({
    title: ban ? `Ban ${p.name} from the group?` : `Remove ${p.name} from the group?`,
    body: ban
      ? 'They leave the group and can’t join again until you let them back. They stay on Connect.'
      : 'They leave the group but can join again. They stay on Connect.',
    confirm: ban ? 'Ban' : 'Remove',
    danger: true,
  });
  if (!ok) return;
  try {
    await api.removeFromGroup(p.id, ban);
    toast(ban ? `${p.name} is banned from the group` : `${p.name} was removed from the group`);
    done?.();
  } catch (e) {
    toast((e as Error).message);
  }
}

/** Shown instead of the chat to someone who isn't in the group */
function NotInGroup({ onBack }: { onBack: () => void }) {
  const { api, toast } = useConnect();
  const [status, setStatus] = useState<'member' | 'removed' | 'banned' | 'none' | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.groupStatus().then(setStatus).catch(() => setStatus('none'));
  }, [api]);
  if (!status) return <Loading />;
  if (status === 'removed')
    return (
      <Empty title="You were removed from the group">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api.rejoinGroup();
              onBack();
            } catch (e) {
              toast((e as Error).message);
              setBusy(false);
            }
          }}
        >
          Join again
        </button>
      </Empty>
    );
  if (status === 'banned') return <Empty title="You can’t join the group right now" />;
  return <Empty title="The group is for Black Belt members" />;
}

function MemberRow({ p, me, onMenu }: { p: Profile; me: string; onMenu?: (p: Profile) => void }) {
  const online = useOnline(p.id);
  return (
    <li className="cx-gi-row">

      <A path={`/u/${p.handle}`} className="cx-gi-member">
        <span className="cx-av-wrap">
          <Avatar p={p} size={44} />
          {online && <span className="cx-online-dot" aria-label="Online" />}
        </span>
        <span className="cx-gi-text">
          <b>
            {p.id === me ? 'You' : p.name}
            {p.is_student && !p.is_sensei && <BeltBadge p={p} small />}
          </b>
          <small>@{p.handle}</small>
        </span>
        {p.is_sensei ? <em className="cx-gi-role">Grand Sensei</em> : p.is_moderator ? <em className="cx-gi-role">Team</em> : null}
      </A>
      {onMenu && p.id !== me && !p.is_sensei && !p.is_moderator && (
        <button type="button" className="cx-icon-btn cx-icon-flat" aria-label={`Options for ${p.name}`} onClick={() => onMenu(p)}>
          <Icon name="more" />
        </button>
      )}
    </li>
  );
}

export function GroupInfoScreen() {
  const { api, me, toast, ask } = useConnect();
  const team = Boolean(me?.is_sensei || me?.is_moderator);
  const [info, setInfo] = useState<GroupInfo | null | undefined>(() => peek<GroupInfo | null>('groupInfo'));
  const [members, setMembers] = useState<Profile[] | null>(null);
  const [media, setMedia] = useState<GroupMessage[]>([]);
  const [tab, setTab] = useState<'members' | 'media' | 'settings'>('members');
  const [q, setQ] = useState('');
  const [viewing, setViewing] = useState<GroupMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const [removed, setRemoved] = useState<{ profile: Profile; banned: boolean }[]>([]);
  const [acting, setActing] = useState<Profile | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const sheet = useDragToClose<HTMLDivElement>(() => setActing(null), Boolean(acting));
  const reloadMembers = () => {
    api.groupMembers().then(setMembers).catch(() => setMembers([]));
    if (me?.is_sensei || me?.is_moderator) api.groupRemoved().then(setRemoved).catch(() => {});
    api.groupInfo().then((i) => i && setInfo(i)).catch(() => {});
  };

  useEffect(() => {
    if (!me) return;
    api.groupInfo().then(setInfo).catch(() => setInfo(null));
    reloadMembers();
    api
      .listGroupMessages()
      .then((l) => setMedia(l.filter((m) => !m.deleted_at && (m.kind === 'image' || m.kind === 'video') && m.media_url).reverse()))
      .catch(() => {});
  }, [api, me]);

  if (me === undefined || info === undefined) return <Loading />;
  if (!me || info === null) return <Empty title="The group is for Black Belt members" />;

  const save = async (s: Parameters<typeof api.setGroupSettings>[0], done?: string) => {
    setInfo({ ...info, ...s });
    await api
      .setGroupSettings(s)
      .then(() => done && toast(done))
      .catch((e: Error) => toast(e.message));
  };
  const rename = async () => {
    const name = ((await ask({ title: 'Group name', input: info.name || 'Dojo group', confirm: 'Save' })) || '').trim().slice(0, 60);
    if (name) save({ name });
  };
  const changePhoto = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const url = await api.uploadImage(file, 'avatars');
      await save({ photo_url: url }, 'Group photo updated');
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const term = q.trim().toLowerCase();
  const list = (members ?? [])
    .filter((p) => !term || p.name.toLowerCase().includes(term) || p.handle.toLowerCase().includes(term))
    // the team first, then everyone by name
    .sort((a, b) => Number(b.is_sensei || b.is_moderator) - Number(a.is_sensei || a.is_moderator) || a.name.localeCompare(b.name));

  return (
    <div className="cx-col cx-gi">
      <A path="/messages/group" className="cx-back">
        <Icon name="back" size={20} />
        Back to the group
      </A>

      <div className="cx-gi-head">
        <GroupPhoto url={info.photo_url} size={96} />
        <h1>{info.name || storedName()}</h1>
        <p>{info.members} members</p>
        {team && (
          <div className="cx-gi-actions">
            <button type="button" className="btn btn-light btn-sm" onClick={() => photoInput.current?.click()} disabled={busy}>
              {busy ? 'Uploading…' : 'Change photo'}
            </button>
            <button type="button" className="btn btn-light btn-sm" onClick={rename}>
              Rename
            </button>
            <input ref={photoInput} type="file" accept="image/*" className="sr-only" onChange={(e) => (changePhoto(e.target.files?.[0]), (e.target.value = ''))} />
          </div>
        )}
      </div>

      <div className="cx-gi-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'members'} onClick={() => setTab('members')}>
          Members
        </button>
        <button type="button" role="tab" aria-selected={tab === 'media'} onClick={() => setTab('media')}>
          Media{media.length ? ` (${media.length})` : ''}
        </button>
        {team && (
          <button type="button" role="tab" aria-selected={tab === 'settings'} onClick={() => setTab('settings')}>
            Settings
          </button>
        )}
      </div>

      {tab === 'members' &&
        (!members ? (
          <Loading label="Loading members" />
        ) : (
          <>
            <label className="cx-search cx-gi-search">
              <Icon name="search" size={20} />
              <input type="search" placeholder="Search members" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
            <ul className="cx-gi-list">
              {list.map((p) => (
                <MemberRow key={p.id} p={p} me={me.id} onMenu={team ? setActing : undefined} />
              ))}
              {list.length === 0 && <li className="cx-gi-none">No one matches “{q}”.</li>}
            </ul>
            {team && removed.length > 0 && (
              <section className="cx-gi-removed">
                <h2>Not in the group</h2>
                <ul className="cx-gi-list">
                  {removed.map(({ profile: p, banned }) => (
                    <li key={p.id} className="cx-gi-row">
                      <A path={`/u/${p.handle}`} className="cx-gi-member">
                        <Avatar p={p} size={44} />
                        <span className="cx-gi-text">
                          <b>{p.name}</b>
                          <small>{banned ? 'Banned' : 'Removed'}</small>
                        </span>
                      </A>
                      <button
                        type="button"
                        className="btn btn-light btn-sm"
                        onClick={async () => {
                          await api.addToGroup(p.id).then(() => toast(`${p.name} is back in the group`)).catch((e: Error) => toast(e.message));
                          reloadMembers();
                        }}
                      >
                        Add back
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>

        ))}

      {tab === 'media' &&
        (media.length === 0 ? (
          <Empty title="No photos or videos yet" />
        ) : (
          <ul className="cx-gi-media">
            {media.map((m) => (
              <li key={m.id}>
                <button type="button" onClick={() => setViewing(m)} aria-label={m.kind === 'video' ? 'Play video' : 'Open photo'}>
                  {m.kind === 'image' ? <img src={m.thumb || m.media_url!} alt="" loading="lazy" /> : m.thumb ? <img src={m.thumb} alt="" /> : <Icon name="video" size={26} />}
                  {m.kind === 'video' && (
                    <span className="cx-gi-play">
                      <Icon name="play" size={16} filled />
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        ))}

      {tab === 'settings' && team && (
        <div className="cx-gi-settings">
          <section>
            <h2>Who can post</h2>
            <div className="cx-look-seg cx-gi-seg" role="radiogroup">
              <button type="button" role="radio" aria-checked={!info.announce_only} className={!info.announce_only ? 'is-on' : ''} onClick={() => save({ announce_only: false }, 'Everyone can post')}>
                Everyone
              </button>
              <button type="button" role="radio" aria-checked={info.announce_only} className={info.announce_only ? 'is-on' : ''} onClick={() => save({ announce_only: true }, 'Only the team can post')}>
                Only the team
              </button>
            </div>
          </section>
          <section>
            <h2>What new members can see</h2>
            <ul className="cx-gi-options" role="radiogroup">
              {HISTORY.map(([value, label]) => (
                <li key={value}>
                  <button type="button" role="radio" aria-checked={(info.history ?? 'all') === value} onClick={() => save({ history: value })}>
                    <span>{label}</span>
                    {(info.history ?? 'all') === value && <Icon name="check" size={20} />}
                  </button>
                </li>
              ))}
            </ul>
          </section>
          {info.photo_url && (
            <button type="button" className="btn btn-sm cx-ln-delete" onClick={() => save({ photo_url: null }, 'Group photo removed')}>
              Remove group photo
            </button>
          )}
        </div>
      )}

      {acting && (
        <div className="cx-sheet-wrap" onClick={() => setActing(null)}>
          <div className="cx-sheet cx-drag" role="menu" ref={sheet} onClick={(e) => e.stopPropagation()}>
            <span className="cx-grab" aria-hidden="true" />
            <p className="cx-sheet-title">{acting.name}</p>
            <button type="button" role="menuitem" onClick={() => navigate(`/u/${acting.handle}`)}>
              <Icon name="user" /> View profile
            </button>
            <button
              type="button"
              role="menuitem"
              className="cx-danger"
              onClick={() => {
                const p = acting;
                setActing(null);
                outOfGroup(api, ask, toast, p, false, reloadMembers);
              }}
            >
              <Icon name="out" /> Remove from the group
            </button>
            <button
              type="button"
              role="menuitem"
              className="cx-danger"
              onClick={() => {
                const p = acting;
                setActing(null);
                outOfGroup(api, ask, toast, p, true, reloadMembers);
              }}
            >
              <Icon name="close" /> Ban from the group
            </button>
            <button type="button" role="menuitem" onClick={() => setActing(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {viewing && <Viewer m={viewing} onClose={() => setViewing(null)} onSave={() => saveToPhone(viewing, toast)} />}
    </div>
  );
}
