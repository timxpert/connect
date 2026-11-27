'use client';
/* Polls and live classes (Google Meet) in the groups. The team creates them
   from the + menu; everyone votes or joins from the card in the chat. */

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useConnect } from './context';
import { useDragToClose } from './drag';
import type { GroupMessage, Profile } from './types';
import { A, Avatar, Icon } from './ui';
import { youtubeId, ytThumb } from './youtube';
import { readLive, readPoll, type Live } from './special';

/* ---------- Showing a poll ---------- */
export function PollCard({ m, people, onVote }: { m: GroupMessage; people: Profile[]; onVote: (options: number[]) => void }) {
  const { me } = useConnect();
  const [who, setWho] = useState(false);
  const poll = readPoll(m.body);
  if (!poll) return <p>Poll</p>;
  const votes = m.votes ?? [];
  const voters = new Set(votes.map((v) => v.user_id)).size;
  const mine = new Set(votes.filter((v) => v.user_id === me?.id).map((v) => v.option));
  const top = Math.max(1, ...poll.o.map((_, i) => votes.filter((v) => v.option === i).length));
  const pick = (i: number) => {
    const next = new Set(mine);
    if (poll.multi) {
      if (next.has(i)) next.delete(i);
      else next.add(i);
    } else if (next.has(i)) next.clear();
    else {
      next.clear();
      next.add(i);
    }
    onVote([...next]);
  };
  const nameOf = (id: string) => (id === me?.id ? 'You' : people.find((p) => p.id === id)?.name ?? 'Member');
  return (
    <div className="cx-poll" onClick={(e) => e.stopPropagation()}>
      <p className="cx-poll-q">
        <Icon name="poll" size={16} /> {poll.q}
      </p>
      <small className="cx-poll-hint">{poll.multi ? 'Pick one or more' : 'Pick one'}</small>
      <ul>
        {poll.o.map((label, i) => {
          const n = votes.filter((v) => v.option === i).length;
          return (
            <li key={i}>
              <button type="button" className={mine.has(i) ? 'is-on' : ''} onClick={() => pick(i)} aria-pressed={mine.has(i)}>
                <span className={poll.multi ? 'cx-poll-box' : 'cx-poll-dot'} aria-hidden="true">
                  {mine.has(i) && <Icon name="check" size={13} />}
                </span>
                <span className="cx-poll-label">{label}</span>
                <span className="cx-poll-n">{n}</span>
                <span className="cx-poll-bar" style={{ transform: `scaleX(${n / top})` }} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
      <button type="button" className="cx-poll-who" onClick={() => setWho(true)} disabled={!voters}>
        {voters === 0 ? 'No votes yet' : voters === 1 ? '1 vote · See who voted' : `${voters} votes · See who voted`}
      </button>
      {who && (
        <div className="cx-sheet-wrap" onClick={() => setWho(false)}>
          <div className="cx-sheet cx-rx-who" role="dialog" aria-label="Votes" onClick={(e) => e.stopPropagation()}>
            <span className="cx-grab" aria-hidden="true" />
            <h2 className="cx-fwd-title">{poll.q}</h2>
            <ul data-scroll>
              {poll.o.map((label, i) => {
                const ids = votes.filter((v) => v.option === i).map((v) => v.user_id);
                return (
                  <li key={i} className="cx-poll-group">
                    <b>
                      {label} <small>{ids.length === 1 ? '1 vote' : `${ids.length} votes`}</small>
                    </b>
                    {ids.map((id) => {
                      const p = people.find((x) => x.id === id);
                      return (
                        <span key={id} className="cx-poll-voter">
                          {p ? <Avatar p={p} size={28} /> : <span className="cx-rx-who-blank" />}
                          {nameOf(id)}
                        </span>
                      );
                    })}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- Showing a live class ---------- */
const fmtDay = (d: Date) => d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
const fmtTime = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
function until(ms: number) {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr${m % 60 ? ` ${m % 60} min` : ''}`;
  const d = Math.round(h / 24);
  return d === 1 ? '1 day' : `${d} days`;
}
const gcal = (l: Live) => {
  const z = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const a = new Date(l.at);
  const b = new Date(a.getTime() + l.mins * 60000);
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(`Motion Dojo: ${l.t}`)}&dates=${z(a)}/${z(b)}&details=${encodeURIComponent(`Join on Google Meet: ${l.link}`)}&location=${encodeURIComponent(l.link)}`;
};

export function LiveCard({ m, team = false, onRecording }: { m: GroupMessage; team?: boolean; onRecording?: (video: string, onLearn: boolean) => Promise<void> }) {
  const [adding, setAdding] = useState(false);
  const live = readLive(m.body);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(t);
  }, []);
  if (!live) return <p>Live class</p>;
  const start = new Date(live.at).getTime();
  const end = start + live.mins * 60000;
  const state = now >= end ? 'ended' : now >= start ? 'live' : 'soon';
  const canJoin = now >= start - 15 * 60000 && now < end;
  const day = `${fmtDay(new Date(start))} · ${fmtTime(new Date(start))}`;
  if (state === 'ended' && live.rec) {
    return (
      <div className="cx-live" onClick={(e) => e.stopPropagation()}>
        <A path={`/learn/live/${m.id}`} className="cx-live-rec" aria-label={`Watch the recording of ${live.t}`}>
          <img src={ytThumb(live.rec)} alt="" referrerPolicy="no-referrer" />
          <span className="cx-live-rec-play" aria-hidden="true">
            <Icon name="play" size={22} filled />
          </span>
        </A>
        <span className="cx-live-tag">Recording</span>
        <p className="cx-live-title">{live.t}</p>
        <p className="cx-live-when">
          <Icon name="clock" size={15} /> {day}
        </p>
        <div className="cx-live-btns">
          <A path={`/learn/live/${m.id}`} className="btn btn-primary btn-sm">
            Watch recording
          </A>
          {team && onRecording && (
            <button type="button" className="btn btn-light btn-sm" onClick={() => setAdding(true)}>
              Change
            </button>
          )}
        </div>
        {adding && onRecording && <RecordingSheet title={live.t} onClose={() => setAdding(false)} onSave={onRecording} />}
      </div>
    );
  }
  return (
    <div className="cx-live" onClick={(e) => e.stopPropagation()}>
      <span className={`cx-live-tag is-${state}`}>{state === 'live' ? 'Live now' : state === 'ended' ? 'Ended' : `Starts in ${until(start - now)}`}</span>
      <p className="cx-live-title">{live.t}</p>
      {!live.call && (
        <p className="cx-live-when">
          <Icon name="clock" size={15} /> {fmtDay(new Date(start))} · {fmtTime(new Date(start))} · {live.mins >= 60 ? `${live.mins / 60} hr` : `${live.mins} min`}
        </p>
      )}
      <p className="cx-live-where">
        <Icon name="cam" size={15} /> Google Meet
      </p>
      {state !== 'ended' && (
        <div className="cx-live-btns">
          {canJoin ? (
            <a className="btn btn-primary btn-sm" href={live.link} target="_blank" rel="noreferrer">
              {live.call ? 'Join call' : 'Join class'}
            </a>
          ) : (
            <span className="cx-live-note">Join opens 15 min before</span>
          )}
          {!live.call && (
            <a className="btn btn-light btn-sm" href={gcal(live)} target="_blank" rel="noreferrer">
              Add to calendar
            </a>
          )}
        </div>
      )}
      {state === 'ended' && !live.call && team && onRecording && (
        <div className="cx-live-btns">
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>
            Add the recording
          </button>
        </div>
      )}
      {adding && onRecording && <RecordingSheet title={live.t} onClose={() => setAdding(false)} onSave={onRecording} />}
    </div>
  );
}

/** After the class: paste the YouTube link */
function RecordingSheet({ title, onClose, onSave }: { title: string; onClose: () => void; onSave: (video: string, onLearn: boolean) => Promise<void> }) {
  const sheet = useDragToClose<HTMLDivElement>(onClose);
  const [link, setLink] = useState('');
  const [learn, setLearn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const video = youtubeId(link.trim());
  const save = async () => {
    if (!video) return;
    setBusy(true);
    setErr('');
    try {
      await onSave(video, learn);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return createPortal(
    <div className="cx-sheet-wrap" onClick={onClose}>
      <div className="cx-sheet cx-drag cx-invite cx-make" role="dialog" aria-label="Add the recording" ref={sheet} onClick={(e) => e.stopPropagation()}>
        <span className="cx-grab" aria-hidden="true" />
        <h2 className="cx-fwd-title">Add the recording</h2>
        <div className="cx-make-body" data-scroll>
          <p className="cx-fwd-note">{title}</p>
          <label className="cx-invite-label" htmlFor="rec-link">
            YouTube link
          </label>
          <input id="rec-link" className="cx-invite-name" inputMode="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://youtu.be/…" autoFocus />
          <p className="cx-fwd-note">Upload the class to YouTube as Unlisted, then paste the link here. Unlisted videos don’t show up in YouTube search.</p>
          {link.trim() && !video && <p className="cx-fwd-note cx-make-err">Paste a YouTube link.</p>}
          {err && <p className="cx-fwd-note cx-make-err">{err}</p>}
          <label className="cx-make-check">
            <input type="checkbox" checked={learn} onChange={(e) => setLearn(e.target.checked)} />
            Also add it to Learn
          </label>
        </div>
        <button type="button" className="btn btn-primary cx-addp-go" disabled={!video || busy} onClick={save}>
          {busy ? 'Saving…' : 'Share recording'}
        </button>
      </div>
    </div>,
    document.body,
  );
}

/* ---------- Making them ---------- */
export function PollSheet({ onClose, onSend }: { onClose: () => void; onSend: (body: string) => Promise<void> }) {
  const sheet = useDragToClose<HTMLDivElement>(onClose);
  const [q, setQ] = useState('');
  const [o, setO] = useState(['', '']);
  const [multi, setMulti] = useState(false);
  const [busy, setBusy] = useState(false);
  const opts = o.map((x) => x.trim()).filter(Boolean);
  const ok = q.trim() && opts.length >= 2;
  const send = async () => {
    setBusy(true);
    try {
      await onSend(JSON.stringify({ q: q.trim().slice(0, 300), o: opts.slice(0, 12).map((x) => x.slice(0, 100)), multi }));
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="cx-sheet-wrap" onClick={onClose}>
      <div className="cx-sheet cx-drag cx-invite cx-make" role="dialog" aria-label="New poll" ref={sheet} onClick={(e) => e.stopPropagation()}>
        <span className="cx-grab" aria-hidden="true" />
        <h2 className="cx-fwd-title">New poll</h2>
        <div className="cx-make-body" data-scroll>
          <label className="cx-invite-label" htmlFor="poll-q">
            Question
          </label>
          <input id="poll-q" className="cx-invite-name" maxLength={300} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Which lesson should we do next?" autoFocus />
          <span className="cx-invite-label">Answers</span>
          {o.map((x, i) => (
            <span key={i} className="cx-make-opt">
              <input
                className="cx-invite-name"
                maxLength={100}
                value={x}
                placeholder={`Answer ${i + 1}`}
                onChange={(e) => {
                  const next = o.map((y, j) => (j === i ? e.target.value : y));
                  // a new empty box appears as you fill the last one
                  if (i === o.length - 1 && e.target.value && o.length < 12) next.push('');
                  setO(next);
                }}
              />
              {o.length > 2 && (
                <button type="button" className="cx-icon-btn cx-icon-flat" aria-label={`Remove answer ${i + 1}`} onClick={() => setO(o.filter((_, j) => j !== i))}>
                  <Icon name="close" size={16} />
                </button>
              )}
            </span>
          ))}
          <label className="cx-make-check">
            <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} />
            Allow more than one answer
          </label>
        </div>
        <button type="button" className="btn btn-primary cx-addp-go" disabled={!ok || busy} onClick={send}>
          {busy ? 'Sending…' : 'Send poll'}
        </button>
      </div>
    </div>
  );
}

const pad = (n: number) => String(n).padStart(2, '0');
/** now: a group call starting straight away (no day or time to pick) */
export function LiveSheet({ onClose, onSend, now = false }: { onClose: () => void; onSend: (body: string) => Promise<void>; now?: boolean }) {
  const sheet = useDragToClose<HTMLDivElement>(onClose);
  const soon = new Date(Date.now() + 2 * 3600000);
  soon.setMinutes(0, 0, 0);
  const [t, setT] = useState(now ? 'Group call' : '');
  const [day, setDay] = useState(`${soon.getFullYear()}-${pad(soon.getMonth() + 1)}-${pad(soon.getDate())}`);
  const [time, setTime] = useState(`${pad(soon.getHours())}:00`);
  const [mins, setMins] = useState(60);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const at = now ? new Date() : new Date(`${day}T${time}`);
  // the Meet app copies links without "https://", so that's added when missing
  const meetLink = (() => {
    const v = link.trim().replace(/^http:\/\//i, 'https://');
    return /^https:\/\//i.test(v) ? v : `https://${v}`;
  })();
  const goodLink = /^https:\/\/meet\.google\.com\/[a-z0-9-]+/i.test(meetLink);
  const ok = t.trim() && !Number.isNaN(at.getTime()) && goodLink;
  const send = async () => {
    setBusy(true);
    try {
      await onSend(JSON.stringify({ t: t.trim().slice(0, 120), at: at.toISOString(), mins: now ? 60 : mins, link: meetLink, ...(now ? { call: true } : {}) }));
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="cx-sheet-wrap" onClick={onClose}>
      <div className="cx-sheet cx-drag cx-invite cx-make" role="dialog" aria-label="New live class" ref={sheet} onClick={(e) => e.stopPropagation()}>
        <span className="cx-grab" aria-hidden="true" />
        <h2 className="cx-fwd-title">{now ? 'Group call' : 'Live class'}</h2>
        <div className="cx-make-body" data-scroll>
          <label className="cx-invite-label" htmlFor="live-t">
            Title
          </label>
          <input id="live-t" className="cx-invite-name" maxLength={120} value={t} onChange={(e) => setT(e.target.value)} placeholder="Phase 2: easing Q&A" autoFocus />
          {!now && (
          <span className="cx-make-row">
            <label>
              <span className="cx-invite-label">Day</span>
              <input type="date" className="cx-invite-name" value={day} onChange={(e) => setDay(e.target.value)} />
            </label>
            <label>
              <span className="cx-invite-label">Time</span>
              <input type="time" className="cx-invite-name" value={time} onChange={(e) => setTime(e.target.value)} />
            </label>
          </span>
          )}
{!now && (
          <>
          <label className="cx-invite-label" htmlFor="live-len">
            How long
          </label>
          <select id="live-len" className="cx-invite-name" value={mins} onChange={(e) => setMins(Number(e.target.value))}>
            {[30, 45, 60, 90, 120].map((n) => (
              <option key={n} value={n}>
                {n < 60 ? `${n} minutes` : n === 60 ? '1 hour' : `${n / 60} hours`}
              </option>
            ))}
          </select>
          </>
          )}
          <label className="cx-invite-label" htmlFor="live-link">
            Google Meet link
          </label>
          <input id="live-link" className="cx-invite-name" inputMode="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://meet.google.com/abc-defg-hij" />
          <p className="cx-fwd-note">
            No link yet?{' '}
            <a href="https://meet.google.com/new" target="_blank" rel="noreferrer">
              Open Google Meet
            </a>
            {' '}and copy the link. Free group calls end after 60 minutes.
          </p>
          {link.trim() && !goodLink && <p className="cx-fwd-note cx-make-err">Paste a meet.google.com link.</p>}
        </div>
        <button type="button" className="btn btn-primary cx-addp-go" disabled={!ok || busy} onClick={send}>
          {busy ? 'Sending…' : now ? 'Start call' : 'Send'}
        </button>
      </div>
    </div>
  );
}
