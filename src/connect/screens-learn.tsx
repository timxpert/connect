'use client';
/* Learn: the Black Belt lessons.
   Lessons open one after another; a student marks a lesson done to open the
   next. Videos are Google Drive files shown in Drive's player, with its
   pop-out button covered and the student's name over the picture. */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useConnect } from './context';
import { peek } from './cache';
import { navigate } from './router';
import { PHASES, type Assignment, type BriefItem, type DeviceRow, type Lesson, type LessonInput, type LessonWork, type LiveRecording, type PhaseRequest } from './types';
import { A, Avatar, Empty, Icon, Loading, Media } from './ui';
import { driveFolderId, timeAgo, toEmbed } from './media';
import { YouTubePlayer, isShort, youtubeId, ytRatio, ytThumb } from './youtube';

const MAIN_SITE = process.env.NEXT_PUBLIC_MAIN_SITE_URL || 'https://joinmotiondojo.com';

/* ---------- Video links ---------- */

/** Google Drive file id from any Drive link (or a bare id) */
export function driveId(url: string) {
  const u = url.trim();
  const m = /\/file\/d\/([\w-]{20,})/.exec(u) || /[?&]id=([\w-]{20,})/.exec(u) || /^([\w-]{25,})$/.exec(u);
  return m ? m[1] : null;
}


/** The address the player loads, or null if the link isn't one we can play */
export function embedSrc(url: string) {
  const d = driveId(url);
  if (d) return { src: `https://drive.google.com/file/d/${d}/preview`, drive: true };
  const y = youtubeId(url);
  if (y) return { src: `https://www.youtube-nocookie.com/embed/${y}?rel=0&modestbranding=1`, drive: false };
  return null;
}

/* ---------- Helpers ---------- */

/** Phase 0 is the orientation: open to every member, whatever their phase */
const phaseLabel = (p: number) => (p === 0 ? 'Orientation' : `Phase ${p}`);
const phaseName = (p: number) => (p === 0 ? 'Watch this first' : PHASES[p - 1]);
/** Lessons in course order: phase by phase, in the order set on each phase */
const courseOrder = (list: Lesson[]) => [0, 1, 2, 3, 4].flatMap((p) => list.filter((l) => l.phase === p));
/** A lesson's number in the whole course (1, 2, 3… across sections and phases); drafts have none */
const lessonNo = (list: Lesson[], l: Lesson) => (l.published ? courseOrder(list).filter((x) => x.published).findIndex((x) => x.id === l.id) + 1 : 0);
/** Course progress: each phase (1–4) is a quarter, filled lesson by lesson; phases before yours count as done */
function courseProgress(list: Lesson[], cur: number | null) {
  let pct = 0;
  for (let p = 1; p <= PHASES.length; p++) {
    const pub = list.filter((l) => l.phase === p && l.published);
    const share = 100 / PHASES.length;
    if (cur && p < cur) pct += share;
    else if (pub.length) pct += (share * pub.filter((l) => l.done).length) / pub.length;
  }
  return Math.min(100, pct);
}

function useLessons() {
  const { api, me } = useConnect();
  const [list, setList] = useState<Lesson[] | null>(() => peek<Lesson[]>('listLessons') ?? null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    api
      .listLessons()
      .then((l) => live && setList(l))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [api, me?.id]);
  return { list, setList, error };
}

/** Plain text with links made clickable and line breaks kept */
function Notes({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return (
    <div className="cx-ln-notes">
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noopener noreferrer">
            {p.replace(/^https?:\/\/(www\.)?/, '').slice(0, 48)}
          </a>
        ) : (
          <React.Fragment key={i}>{p}</React.Fragment>
        ),
      )}
    </div>
  );
}

/* ---------- Phase assignments ---------- */
type PhaseStatus = 'locked' | 'due' | 'pending' | 'changes' | 'approved' | 'placed' | 'team';

function useAssignments(on: boolean) {
  const { api } = useConnect();
  const [list, setList] = useState<Assignment[]>([]);
  useEffect(() => {
    if (on) api.myAssignments().then(setList).catch(() => {});
  }, [api, on]);
  return list;
}

/** Where a student is with a phase's assignment */
function phaseStatus(lessons: Lesson[], mine: Assignment[], phase: number, cur?: number | null): PhaseStatus {
  const latest = mine.filter((a) => a.phase === phase).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (mine.some((a) => a.phase === phase && a.status === 'approved')) return 'approved';
  if (latest?.status === 'pending') return 'pending';
  // the Grand Sensei placed them in a later phase: no assignment needed here
  if (cur && phase < cur) return 'placed';
  const pub = lessons.filter((l) => l.phase === phase && l.published);
  if (pub.length === 0 || pub.some((l) => !l.done)) return 'locked';
  return latest?.status === 'changes' ? 'changes' : 'due';
}

function AssignmentRow({ phase, status }: { phase: number; status: PhaseStatus }) {
  const text: Record<PhaseStatus, string> = {
    locked: 'Finish the lessons above to hand it in',
    due: 'Ready to hand in',
    pending: 'Waiting for review',
    changes: 'Changes asked',
    approved: 'Approved',
    placed: 'Not needed',
    team: 'Edit the brief',
  };
  const open = status !== 'locked' && status !== 'placed';
  const body = (
    <>
      <span className={`cx-ln-mark${status === 'approved' || status === 'placed' ? ' is-done' : status === 'due' || status === 'changes' ? ' is-open' : ''}`} aria-hidden="true">
        {status === 'approved' || status === 'placed' ? <Icon name="check" size={18} /> : status === 'locked' ? <Icon name="lock" size={16} /> : <Icon name="send" size={16} />}
      </span>
      <span className="cx-ln-text">
        <b>Phase {phase} assignment</b>
        <small>{text[status]}</small>
      </span>
    </>
  );
  return (
    <div className={`cx-ln-assign${open ? '' : ' is-locked'} is-${status}`}>
      {open ? (
        <A path={`/learn/assignment/${phase}`} className="cx-ln-row">
          {body}
        </A>
      ) : (
        <div className="cx-ln-row" aria-disabled="true">
          {body}
        </div>
      )}
    </div>
  );
}

/* ================= Course outline ================= */
export function Learn() {
  const { api, me, signedIn } = useConnect();
  const { list, setList, error } = useLessons();
  const team = Boolean(me?.is_sensei || me?.is_moderator);
  const learner = Boolean(me && (me.is_student || team));

  // students: progress counts from the phase they're in
  const cur = !team && me?.is_student ? (me.phase ?? null) : null;
  const published = useMemo(() => (list ?? []).filter((l) => l.published && (!cur || l.phase >= cur)), [list, cur]);
  const done = published.filter((l) => l.done).length;
  const pct = useMemo(() => courseProgress(list ?? [], cur), [list, cur]);
  const next = published.find((l) => l.open && !l.done);
  // the orientation comes first: nothing else opens until it's watched
  const oriented = (list ?? []).filter((l) => l.phase === 0 && l.published).every((l) => l.done);
  const mine = useAssignments(learner && !team);
  const status = (phase: number) => phaseStatus(list ?? [], mine, phase, cur);
  const unplaced = Boolean(me?.is_student && !team && !me.phase);
  const due = PHASES.map((_, i) => i + 1).find((p) => ['due', 'changes'].includes(status(p)));
  const waiting = PHASES.map((_, i) => i + 1).find((p) => status(p) === 'pending');

  const move = async (l: Lesson, dir: -1 | 1) => {
    await api.moveLesson(l.id, dir).catch(() => {});
    setList(await api.listLessons());
  };

  if (error) return <Empty title="Lessons can’t load right now">{<p>{error}</p>}</Empty>;
  if (!list) return <Loading label="Loading lessons" />;

  return (
    <div className="cx-col cx-learn">
      <div className="cx-intro">
        <h1 className="cx-h1">Learn</h1>
        {learner ? (
          unplaced ? null : !team && !oriented ? (
            <p>Watch the orientation to the end first. Your other lessons open after it.</p>
          ) : (
            <p>{cur ? `Phase ${cur}. Finish a lesson to open the next.` : 'Finish a lesson to open the next.'}</p>
          )
        ) : (
          <p>Every lesson in Black Belt in Motion Design.</p>
        )}
        {me?.is_sensei && (
          <A path="/learn/new" className="btn btn-primary btn-sm">
            <Icon name="plus" size={18} />
            Add lesson
          </A>
        )}
      </div>

      {unplaced && (
        <section className="cx-ln-progress" aria-label="Your phase">
          <p className="cx-ln-finished">
            {me?.phase_request ? `Phase ${me.phase_request} is waiting for confirmation.` : 'Choose your phase to open your lessons.'}
          </p>
        </section>
      )}

      {learner && !team && !unplaced && published.length > 0 && (
        <section className="cx-ln-progress" aria-label="Course progress">
          <div className="cx-ln-progress-row">
            <b>Course progress</b>
            <span>{Math.floor(pct)}%</span>
          </div>
          <div className="cx-ln-bar" role="progressbar" aria-label="Course progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(pct)}>
            <span style={{ width: `${pct}%` }} />
          </div>
          <p className="cx-ln-count">
            {done} of {published.length} lessons done
          </p>
          {!next && due ? (
            <A path={`/learn/assignment/${due}`} className="cx-ln-next">
              <span className="cx-ln-next-ico">
                <Icon name="send" size={20} />
              </span>
              <span>
                <small>{status(due) === 'changes' ? 'Changes asked' : 'Up next'} · Phase {due} assignment</small>
                <b>Hand in your project</b>
              </span>
            </A>
          ) : !next && waiting ? (
            <p className="cx-ln-finished">Your phase {waiting} assignment is waiting for review. The next phase opens when it’s approved.</p>
          ) : next ? (
            <A path={`/learn/${next.id}`} className="cx-ln-next">
              <span className="cx-ln-next-ico">
                <Icon name="play" size={20} filled />
              </span>
              <span>
                <small>{done ? 'Up next' : 'Start here'} · lesson {lessonNo(list, next)} · {phaseLabel(next.phase)}</small>
                <b>{next.title}</b>
              </span>
            </A>
          ) : done === published.length ? (
            <p className="cx-ln-finished">You’ve done every lesson there is so far.</p>
          ) : null}
        </section>
      )}

      {!signedIn || (me && !learner) ? (
        <div className="cx-ln-join">
          <p>Join Black Belt to watch the lessons.</p>
          <a href={`${MAIN_SITE}/blackbelt`} className="btn btn-lime btn-sm">
            Become a member
          </a>
        </div>
      ) : null}

      {list.length === 0 ? (
        <Empty title="No lessons yet">{team && <p>Add the first lesson and students will see it here.</p>}</Empty>
      ) : (
        [0, 1, 2, 3, 4].map((phase) => {
          const name = phaseName(phase);
          const items = list.filter((l) => l.phase === phase);
          if (items.length === 0) return null;
          const pub = items.filter((l) => l.published);
          const finished = pub.filter((l) => l.done).length;
          return (
            <section key={phase} className="cx-ln-phase">
              <header>
                <h2>
                  <small>{phaseLabel(phase)}</small>
                  {name}
                </h2>
                {learner && pub.length > 0 && (
                  <span className={finished === pub.length ? 'is-done' : ''}>
                    {finished}/{pub.length}
                  </span>
                )}
              </header>
              <ol className="cx-ln-list">
                {items.map((l, n) => {
                  // sections: a heading where a new one starts; numbers run on through the whole course
                  const sec = (l.section ?? '').trim();
                  const newSec = sec && sec !== (items[n - 1]?.section ?? '').trim();
                  const num = lessonNo(list, l) || '–';
                  const body = (
                    <>
                      <span className={`cx-ln-mark${l.done ? ' is-done' : l.open ? ' is-open' : ''}`} aria-hidden="true">
                        {l.done ? <Icon name="check" size={18} /> : l.open ? <Icon name="play" size={14} filled /> : <Icon name="lock" size={16} />}
                      </span>
                      <span className="cx-ln-text">
                        <b>
                          <span className="cx-ln-no">{num}.</span> {l.title}
                        </b>
                        <small>
                          {[l.duration || (l.has_video ? 'Video' : 'No video yet'), l.size_mb ? `${l.size_mb} MB` : ''].filter(Boolean).join(' · ')}
                          {team && !l.published && <em className="cx-ln-tag">Draft</em>}
                          {team && !l.has_video && <em className="cx-ln-tag">No video</em>}
                        </small>
                      </span>
                      <span className="sr-only">{l.done ? 'Done' : l.open ? 'Open' : 'Locked'}</span>
                    </>
                  );
                  return (
                    <React.Fragment key={l.id}>
                    {newSec && <li className="cx-ln-section">{sec}</li>}
                    <li className={l.open ? '' : 'is-locked'}>
                      {l.open ? (
                        <A path={`/learn/${l.id}`} className="cx-ln-row">
                          {body}
                        </A>
                      ) : (
                        <div className="cx-ln-row" aria-disabled="true">
                          {body}
                        </div>
                      )}
                      {me?.is_sensei && (
                        <span className="cx-ln-order">
                          <button type="button" aria-label={`Move “${l.title}” up`} disabled={n === 0} onClick={() => move(l, -1)}>
                            <Icon name="up" size={16} />
                          </button>
                          <button type="button" aria-label={`Move “${l.title}” down`} disabled={n === items.length - 1} onClick={() => move(l, 1)}>
                            <Icon name="down" size={16} />
                          </button>
                        </span>
                      )}
                    </li>
                    </React.Fragment>
                  );
                })}
              </ol>
              {phase > 0 && pub.length > 0 && (learner || team) && <AssignmentRow phase={phase} status={team ? 'team' : status(phase)} />}
            </section>
          );
        })
      )}

      {learner && <Recordings />}
    </div>
  );
}

const recDate = (iso: string) => new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });

/** Live classes that were recorded, newest first */
function Recordings() {
  const { api } = useConnect();
  const [list, setList] = useState<LiveRecording[] | null>(() => peek<LiveRecording[]>('listLiveRecordings') ?? null);
  useEffect(() => {
    let live = true;
    api
      .listLiveRecordings()
      .then((r) => live && setList(r))
      .catch(() => live && setList([]));
    return () => {
      live = false;
    };
  }, [api]);
  if (!list || list.length === 0) return null;
  return (
    <section className="cx-ln-phase cx-ln-recs">
      <header>
        <h2>Live class recordings</h2>
      </header>
      <ol className="cx-ln-list">
        {list.map((r) => (
          <li key={r.message_id}>
            <A path={`/learn/live/${r.message_id}`} className="cx-ln-row">
              <img className="cx-ln-rec-thumb" src={ytThumb(r.video)} alt="" referrerPolicy="no-referrer" />
              <span className="cx-ln-text">
                <b>{r.title}</b>
                <small>{recDate(r.held_at)}</small>
              </span>
            </A>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** One recording */
export function RecordingScreen({ id }: { id: string }) {
  const { api, me } = useConnect();
  const [rec, setRec] = useState<LiveRecording | null | undefined>(() => peek<LiveRecording | null>('getLiveRecording', id));
  useEffect(() => {
    let live = true;
    api
      .getLiveRecording(id)
      .then((r) => live && setRec(r))
      .catch(() => live && setRec(null));
    return () => {
      live = false;
    };
  }, [api, id]);
  const back = (
    <A path="/learn" className="cx-back">
      <Icon name="back" size={20} />
      Learn
    </A>
  );
  if (rec === undefined) return <Loading label="Loading recording" />;
  if (!rec)
    return (
      <div className="cx-col">
        {back}
        <Empty title="Recording not found" />
      </div>
    );
  const mark = me ? `${me.name} · @${me.handle}` : '';
  return (
    <div className="cx-col cx-lesson">
      {back}
      <div className="cx-ln-split">
        <Player url={`https://youtu.be/${rec.video}`} title={rec.title} mark={mark} />
        <div className="cx-ln-body">
          <div className="cx-ln-head">
            <p className="cx-ln-where">Live class · {recDate(rec.held_at)}</p>
            <h1 className="cx-h1">{rec.title}</h1>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================= One lesson ================= */

/** The student's name drifting over the video, so a screen recording shows who made it */
function Watermark({ text }: { text: string }) {
  const [spot, setSpot] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setSpot((s) => (s + 1) % 4), 45000);
    return () => window.clearInterval(t);
  }, []);
  return (
    <span key={spot} className={`cx-wm cx-wm-${spot}`} aria-hidden="true">
      {text}
    </span>
  );
}

/** The video's shape (width / height), read from its Drive thumbnail.
    YouTube Shorts are tall; other YouTube links are wide. Null until known. */
function useVideoRatio(url: string) {
  const [ratio, setRatio] = useState<number | null>(null);
  useEffect(() => {
    setRatio(null);
    const d = driveId(url);
    if (!d) {
      const y = youtubeId(url);
      if (!y) return;
      if (isShort(url)) return setRatio(9 / 16);
      // YouTube only tells us reliably when a video is tall; otherwise the lesson's shape setting decides
      let live = true;
      ytRatio(y).then((r) => live && r && r < 1 && setRatio(r));
      return () => {
        live = false;
      };
    }
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    img.onload = () => img.naturalWidth && img.naturalHeight && setRatio(img.naturalWidth / img.naturalHeight);
    img.src = driveThumb(d);
    return () => {
      img.onload = null;
    };
  }, [url]);
  return ratio;
}
/** YouTube can't tell us a video's shape, so the editor saves it on the link: …#ar=4:3 */
const SHAPES: [string, number, number][] = [
  ['Tall (phone)', 9, 16],
  ['Wide', 16, 9],
  ['Slides (4:3)', 4, 3],
  ['Square', 1, 1],
];
function shapeOf(url: string) {
  const m = /#ar=(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)/.exec(url);
  return m ? Number(m[1]) / Number(m[2]) : null;
}
const driveThumb = (id: string) => `https://drive.google.com/thumbnail?id=${id}&sz=w720`;

function Player({ url, title, mark, size, autoload = false, portrait = false, onRatio, onWatched }: { url: string; title: string; mark: string; size?: number | null; autoload?: boolean; portrait?: boolean; onRatio?: (r: number) => void; onWatched?: (share: number) => void }) {
  const e = embedSrc(url);
  // the video's own shape when we can read it; otherwise the lesson's setting
  const found = useVideoRatio(url);
  const ratio = shapeOf(url) ?? found ?? (portrait ? 9 / 16 : 16 / 9);
  useEffect(() => {
    if (found) onRatio?.(found);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [found]);
  const shape = ratio < 1 ? ' is-portrait' : '';
  const style = { '--ar': String(ratio) } as React.CSSProperties;
  const d = driveId(url);
  const y = d ? null : youtubeId(url);
  // Nothing loads until the student taps play, so opening a lesson to read
  // the notes costs almost no data
  const [on, setOn] = useState(autoload);
  if (!e) {
    return (
      <div className={`cx-player is-empty${shape}`} style={style}>
        <Icon name="video" size={30} />
        <span>No video yet</span>
      </div>
    );
  }
  if (!on) {
    return (
      <button type="button" className={`cx-player cx-player-cover${shape}`} style={style} onClick={() => setOn(true)}>
        {(d || y) && <img className="cx-player-poster" src={d ? driveThumb(d) : ytThumb(y!)} alt="" referrerPolicy="no-referrer" onError={(ev) => (ev.currentTarget.style.display = 'none')} />}
        <span className="cx-player-play" aria-hidden="true">
          <Icon name="play" size={28} filled />
        </span>
        <b className="cx-player-label">{size ? `About ${size} MB` : 'Play video'}</b>
      </button>
    );
  }
  if (y) return <YouTubePlayer id={y} className={`cx-player is-on${shape}`} style={style} watermark={<Watermark text={mark} />} onWatched={onWatched} />;
  return (
    <div className={`cx-player is-on${shape}`} style={style} onContextMenu={(ev) => ev.preventDefault()}>
      {/* Drive and YouTube players need to know which site they are on, or they stay black */}
      <iframe src={e.src} title={title} allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
      {/* Drive's player has a pop-out button in the top right that opens the file itself: cover it */}
      {e.drive && <span className="cx-player-shield" aria-hidden="true" />}
      <Watermark text={mark} />
    </div>
  );
}

export function LessonScreen({ id }: { id: string }) {
  const { api, me, signedIn } = useConnect();
  const team = Boolean(me?.is_sensei || me?.is_moderator);
  const { list, setList } = useLessons();
  const [lesson, setLesson] = useState<Lesson | null>(() => peek<Lesson>('getLesson', id) ?? null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [ratio, setRatio] = useState<number | null>(null);

  useEffect(() => {
    if (me === undefined) return;
    let live = true;
    api
      .getLesson(id)
      .then((l) => live && setLesson(l))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [api, id, me]);

  const order = useMemo(() => (list ?? []).filter((l) => l.published || team), [list, team]);
  const i = order.findIndex((l) => l.id === id);
  const prev = i > 0 ? order[i - 1] : null;
  const next = i >= 0 && i < order.length - 1 ? order[i + 1] : null;

  // The orientation can't be ticked off by hand: it ticks itself once the
  // student has really watched it (skipped parts don't count)
  const mustWatch = Boolean(lesson && lesson.phase === 0 && !lesson.done && !team && youtubeId(lesson.video_url ?? ''));
  const [watched, setWatched] = useState(0);
  const ticking = useRef(false);
  const watchedSome = useCallback(
    (share: number) => {
      setWatched(share);
      if (share < 0.92 || ticking.current || !lesson) return;
      ticking.current = true;
      api
        .setLessonDone(lesson.id, true)
        .then(async () => {
          setLesson((l) => (l ? { ...l, done: true } : l));
          setList(await api.listLessons());
        })
        .catch(() => (ticking.current = false));
    },
    [api, lesson],
  );

  const toggleDone = async () => {
    if (!lesson) return;
    setBusy(true);
    try {
      await api.setLessonDone(lesson.id, !lesson.done);
      setLesson({ ...lesson, done: !lesson.done });
      setList(await api.listLessons());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const back = (
    <A path="/learn" className="cx-back">
      <Icon name="back" size={20} />
      All lessons
    </A>
  );

  if (error === 'members_only' || (!signedIn && me !== undefined)) {
    return (
      <div className="cx-col">
        {back}
        <Empty title="This lesson is for Black Belt members">
          <p>Join Black Belt to watch it.</p>
          <a href={`${MAIN_SITE}/blackbelt`} className="btn btn-lime btn-sm">
            Become a member
          </a>
        </Empty>
      </div>
    );
  }
  if (error === 'locked') {
    return (
      <div className="cx-col">
        {back}
        <Empty title="This lesson isn’t open yet">
          <p>Mark the lesson before it as done to open this one.</p>
        </Empty>
      </div>
    );
  }
  if (error === 'not_found') {
    return (
      <div className="cx-col">
        {back}
        <Empty title="Lesson not found" />
      </div>
    );
  }
  if (!lesson) return error ? <Empty title="Something went wrong">{<p>{error}</p>}</Empty> : <Loading label="Loading lesson" />;

  const n = list ? lessonNo(list, list.find((l) => l.id === lesson.id) ?? lesson) : 0;
  const mark = me ? `${me.name} · @${me.handle}` : '';

  return (
    <div className={`cx-col cx-lesson${(ratio ?? (lesson.portrait !== false ? 0.5625 : 1.78)) < 1 ? ' is-portrait' : ''}`}>
      {back}
      <div className="cx-ln-split">
      <Player url={lesson.video_url ?? ''} title={lesson.title} mark={mark} size={lesson.size_mb} portrait={lesson.portrait !== false} onRatio={setRatio} onWatched={mustWatch ? watchedSome : undefined} />
      <div className="cx-ln-body">

      <div className="cx-ln-head">
        <p className="cx-ln-where">
          {lesson.phase === 0 ? 'Orientation' : `Phase ${lesson.phase} · ${lesson.section?.trim() || PHASES[lesson.phase - 1]}`}
          {n > 0 && ` · Lesson ${n}`}
          {lesson.duration && ` · ${lesson.duration}`}
          {!lesson.published && <em className="cx-ln-tag">Draft</em>}
        </p>
        <h1 className="cx-h1">{lesson.title}</h1>
        {lesson.summary && <p className="cx-ln-summary">{lesson.summary}</p>}
      </div>

      <div className="cx-ln-actions">
        {mustWatch ? (
          <p className="cx-ln-watch">
            <Icon name="lock" size={16} />
            Watch to the end to open your lessons · {Math.floor(watched * 100)}% watched
          </p>
        ) : (
          <button type="button" className={`btn btn-sm ${lesson.done ? 'cx-ln-done' : 'btn-primary'}`} onClick={toggleDone} disabled={busy || (lesson.phase === 0 && lesson.done && !team)} aria-pressed={lesson.done}>
            <Icon name="check" size={18} />
            {lesson.done ? 'Done' : 'Mark as done'}
          </button>
        )}
        {lesson.done && next && (next.open || team) && (
          <A path={`/learn/${next.id}`} className="btn btn-lime btn-sm">
            Next lesson
            <Icon name="out" size={16} />
          </A>
        )}
        {me?.is_sensei && (
          <A path={`/learn/${lesson.id}/edit`} className="btn btn-sm cx-ln-edit">
            Edit lesson
          </A>
        )}
      </div>

      {lesson.images && lesson.images.length > 0 && (
        <section className="cx-ln-block">
          <h2>Pictures</h2>
          <div className="cx-ln-pics">
            {lesson.images.map((src) => (
              <a key={src} href={src} target="_blank" rel="noopener noreferrer">
                <img src={src} alt="" loading="lazy" decoding="async" />
              </a>
            ))}
          </div>
        </section>
      )}

      {lesson.notes && (
        <section className="cx-ln-block">
          <h2>Notes</h2>
          <Notes text={lesson.notes} />
        </section>
      )}

      {lesson.files && lesson.files.length > 0 && (
        <section className="cx-ln-block">
          <h2>Files</h2>
          <ul className="cx-ln-files">
            {lesson.files.map((f) => (
              <li key={f.url + f.name}>
                <a href={f.url} target="_blank" rel="noopener noreferrer">
                  <Icon name="download" size={18} />
                  {f.name || 'File'}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <LessonWorkBlock lessonId={lesson.id} />

      <nav className="cx-ln-pager" aria-label="Lessons">
        {prev ? (
          <A path={`/learn/${prev.id}`}>
            <small>Previous</small>
            <b>{prev.title}</b>
          </A>
        ) : (
          <span />
        )}
        {next &&
          (next.open || team ? (
            <A path={`/learn/${next.id}`} className="is-next">
              <small>Next</small>
              <b>{next.title}</b>
            </A>
          ) : (
            <span className="is-next is-locked">
              <small>
                <Icon name="lock" size={14} /> Next
              </small>
              <b>{next.title}</b>
            </span>
          ))}
      </nav>
      </div>
      </div>
    </div>
  );
}

/* ================= Work handed in on a lesson ================= */
/** The Grand Sensei turns it on for a lesson; students hand in a link with a
    short note (and can change it); only the Grand Sensei sees everyone's. */
function LessonWorkBlock({ lessonId }: { lessonId: string }) {
  const { api, me, toast } = useConnect();
  // only the Grand Sensei sees everyone's work
  const team = Boolean(me?.is_sensei);
  const learner = Boolean(me?.is_student);
  const [open, setOpen] = useState<boolean | null>(null);
  const [mine, setMine] = useState<LessonWork | null>(null);
  const [all, setAll] = useState<LessonWork[]>([]);
  const [editing, setEditing] = useState(false);
  const [link, setLink] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    api.lessonWorkOpen(lessonId).then((o) => live && setOpen(o)).catch(() => live && setOpen(false));
    if (learner) api.myLessonWork(lessonId).then((w) => live && setMine(w)).catch(() => {});
    if (team) api.lessonWorkAll(lessonId).then((w) => live && setAll(w)).catch(() => {});
    return () => {
      live = false;
    };
  }, [api, lessonId, learner, team]);

  if (open === null) return null;
  const toggle = async () => {
    try {
      await api.setLessonWorkOpen(lessonId, !open);
      setOpen(!open);
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = link.trim();
    setError('');
    if (!url) return setError('Paste the link to your work.');
    if (!toEmbed(url) && !driveFolderId(url)) return setError('Use a Google Drive file or folder link, or a YouTube, Instagram, TikTok or Vimeo link.');
    setBusy(true);
    try {
      await api.handInLessonWork(lessonId, url, note.trim());
      setMine(await api.myLessonWork(lessonId));
      setEditing(false);
      setLink('');
      setNote('');
      toast('Handed in');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    await api.removeLessonWork(lessonId).catch(() => {});
    setMine(null);
  };

  return (
    <>
      {me?.is_sensei && (
        <label className="cx-check cx-work-switch">
          <input type="checkbox" checked={open} onChange={toggle} />
          <span>Students hand in work for this lesson</span>
        </label>
      )}
      {open && learner && !me?.is_sensei && (
        <section className="cx-ln-block cx-work">
          <h2>Hand in your work</h2>
          {mine && !editing ? (
            <div className="cx-work-mine">
              <Media post={{ kind: 'video', media_url: mine.url, caption: mine.note }} />
              {mine.note && <p className="cx-work-note">{mine.note}</p>}
              <p className="cx-work-meta">
                Handed in {timeAgo(mine.created_at)}
                <button type="button" className="cx-link-btn" onClick={() => (setEditing(true), setLink(mine.url), setNote(mine.note))}>
                  Change
                </button>
                <button type="button" className="cx-link-btn" onClick={remove}>
                  Remove
                </button>
              </p>
            </div>
          ) : (
            <form className="cx-form cx-work-form" onSubmit={send} noValidate>
              <label className="field">
                <span>Link to your work</span>
                <input value={link} inputMode="url" placeholder="https://drive.google.com/…" onChange={(e) => setLink(e.target.value)} />
                <small>A Google Drive file or folder (shared with “Anyone with the link”), or YouTube, Instagram, TikTok or Vimeo.</small>
              </label>
              <label className="field">
                <span>A note (optional)</span>
                <textarea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
              {error && (
                <p className="cx-error" role="alert">
                  {error}
                </p>
              )}
              <div className="cx-work-btns">
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy ? 'Sending…' : 'Hand in'}
                </button>
                {editing && (
                  <button type="button" className="btn btn-light" onClick={() => setEditing(false)}>
                    Cancel
                  </button>
                )}
              </div>
            </form>
          )}
        </section>
      )}
      {open && team && (
        <section className="cx-ln-block cx-work">
          <h2>Students’ work{all.length ? ` · ${all.length}` : ''}</h2>
          {all.length === 0 ? (
            <p className="cx-muted">No one has handed in work for this lesson yet.</p>
          ) : (
            <div className="cx-work-list">
              {all.map((w) => (
                <div key={w.id} className="cx-work-item">
                  {w.student && (
                    <A path={`/u/${w.student.handle}`} className="cx-asg-who">
                      <Avatar p={w.student} size={36} />
                      <span>
                        <b>{w.student.name}</b>
                        <small>{timeAgo(w.created_at)}</small>
                      </span>
                    </A>
                  )}
                  <Media post={{ kind: 'video', media_url: w.url, caption: w.note }} />
                  {w.note && <p className="cx-work-note">{w.note}</p>}
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </>
  );
}

/* ================= Add / edit a lesson (team) ================= */
const EMPTY: LessonInput = { phase: 1, title: '', summary: '', duration: '', video_url: '', size_mb: null, notes: '', files: [], published: true, portrait: true, images: [], section: '' };

/** Team: pictures that are part of the lesson */
function PicturesField({ images, onChange }: { images: string[]; onChange: (fn: (cur: string[]) => string[]) => void }) {
  const { api, toast } = useConnect();
  const [busy, setBusy] = useState(false);
  const pick = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      for (const file of Array.from(files).slice(0, 10 - images.length)) {
        const url = await api.uploadImage(file, 'posts');
        onChange((cur) => [...cur, url].slice(0, 10));
      }
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="field">
      <span>Pictures</span>
      <div className="cx-ln-pics is-edit">
        {images.map((src) => (
          <span key={src} className="cx-ln-pic">
            <img src={src} alt="" />
            <button type="button" aria-label="Remove picture" onClick={() => onChange((cur) => cur.filter((x) => x !== src))}>
              <Icon name="close" size={16} />
            </button>
          </span>
        ))}
        {images.length < 10 && (
          <label className={`cx-ln-pic-add${busy ? ' is-busy' : ''}`}>
            <input type="file" accept="image/*" multiple className="sr-only" disabled={busy} onChange={(e) => (pick(e.target.files), (e.target.value = ''))} />
            <Icon name={busy ? 'clock' : 'plus'} size={22} />
            <span className="sr-only">Add pictures</span>
          </label>
        )}
      </div>
    </div>
  );
}

export function LessonEditor({ id }: { id?: string }) {
  const { api, me } = useConnect();
  // only the Grand Sensei adds or changes lessons
  const team = Boolean(me?.is_sensei);
  const [f, setF] = useState<LessonInput | null>(id ? null : EMPTY);
  const { list: lessonsAll } = useLessons();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState(false);

  useEffect(() => {
    if (!id || !team) return;
    api
      .getLesson(id)
      .then((l) => setF({ id: l.id, phase: l.phase, title: l.title, summary: l.summary, duration: l.duration, video_url: l.video_url ?? '', size_mb: l.size_mb ?? null, notes: l.notes ?? '', files: l.files ?? [], published: l.published, portrait: l.portrait ?? true, images: l.images ?? [], section: l.section ?? '' }))
      .catch((e: Error) => setError(e.message));
  }, [api, id, team]);

  if (me === undefined) return <Loading />;
  if (!team) return <Empty title="Only the Motion Dojo team can edit lessons" />;
  if (!f) return error ? <Empty title="Lesson not found">{<p>{error}</p>}</Empty> : <Loading label="Loading lesson" />;

  const set = <K extends keyof LessonInput>(k: K, v: LessonInput[K]) => setF({ ...f, [k]: v });
  const video = f.video_url.trim();
  const playable = !video || Boolean(embedSrc(video));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!f.title.trim()) return setError('Give the lesson a title.');
    if (!playable) return setError('That video link isn’t a Google Drive file link. In Drive, open the video, tap Share, then Copy link.');
    setBusy(true);
    try {
      const files = f.files.filter((x) => x.url.trim()).map((x) => ({ name: x.name.trim() || 'File', url: x.url.trim() }));
      const saved = await api.saveLesson({ ...f, files });
      navigate(`/learn/${saved.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!f.id) return;
    if (!sure) return setSure(true);
    setBusy(true);
    try {
      await api.deleteLesson(f.id);
      navigate('/learn');
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="cx-col cx-ln-editor">
      <A path={f.id ? `/learn/${f.id}` : '/learn'} className="cx-back">
        <Icon name="back" size={20} />
        {f.id ? 'Back to the lesson' : 'All lessons'}
      </A>
      <h1 className="cx-h1">{f.id ? 'Edit lesson' : 'Add a lesson'}</h1>

      <form className="cx-form" onSubmit={save} noValidate>
        <label className="field">
          <span>Phase</span>
          <select value={f.phase} onChange={(e) => set('phase', Number(e.target.value))}>
            <option value={0}>Orientation (everyone can watch)</option>
            {PHASES.map((p, i) => (
              <option key={p} value={i + 1}>
                Phase {i + 1}: {p}
              </option>
            ))}
          </select>
          {!f.id && <small>Added to the end of the phase.</small>}
        </label>
        <label className="field">
          <span>Section</span>
          <input value={f.section} maxLength={80} list="cx-sections" onChange={(e) => set('section', e.target.value)} placeholder="None" />
          <datalist id="cx-sections">
            {[...new Set((lessonsAll ?? []).filter((l) => l.phase === f.phase && l.section).map((l) => l.section!.trim()))].map((x) => (
              <option key={x} value={x} />
            ))}
          </datalist>
        </label>
        <label className="field">
          <span>Title</span>
          <input value={f.title} maxLength={140} onChange={(e) => set('title', e.target.value)} placeholder="Keyframes and easing" />
        </label>
        <label className="field">
          <span>Video link</span>
          <input value={f.video_url} inputMode="url" onChange={(e) => set('video_url', e.target.value)} placeholder="YouTube or Google Drive link" />
          <small className={playable ? '' : 'cx-ln-bad'}>
            {!playable
              ? 'This isn’t a YouTube or Google Drive video link yet.'
              : youtubeId(video)
                ? 'YouTube: upload as Unlisted, then Share → Copy link.'
                : 'Drive: Share → Anyone with the link (Viewer), copy the link.'}
          </small>
        </label>
        {youtubeId(video) && !isShort(video) && (
          <fieldset className="cx-fieldset">
            <legend>Video shape</legend>
            <div className="cx-chips" role="radiogroup" aria-label="Video shape">
              {SHAPES.map(([label, w, h]) => {
                const on = Math.abs((shapeOf(f.video_url) ?? (f.portrait ? 9 / 16 : 16 / 9)) - w / h) < 0.01;
                return (
                  <button
                    key={label}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    className={on ? 'cx-chip is-on' : 'cx-chip'}
                    onClick={() => setF((cur) => (cur ? { ...cur, portrait: w < h, video_url: `${cur.video_url.replace(/#.*$/, '').trim()}#ar=${w}:${h}` } : cur))}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}
        {video && playable && (
          <div className="cx-ln-preview">
            <Player url={video} title="Preview" mark={`${me?.name ?? ''} · preview`} size={f.size_mb} portrait={f.portrait} onRatio={(r) => setF((cur) => (cur ? { ...cur, portrait: r < 1 } : cur))} />
          </div>
        )}
        <PicturesField images={f.images} onChange={(fn) => setF((cur) => (cur ? { ...cur, images: fn(cur.images) } : cur))} />
        <label className="field">
          <span>Video size (MB)</span>
          <input
            inputMode="numeric"
            value={f.size_mb ?? ''}
            placeholder="85"
            onChange={(e) => {
              const n = parseInt(e.target.value.replace(/\D/g, ''), 10);
              set('size_mb', Number.isFinite(n) ? n : null);
            }}
          />
          <small>Shown before they play, so they know the data it uses.</small>
        </label>
        <label className="field">
          <span>Length</span>
          <input value={f.duration} maxLength={20} onChange={(e) => set('duration', e.target.value)} placeholder="12 min" />
        </label>
        <label className="field">
          <span>Short description</span>
          <textarea rows={2} maxLength={300} value={f.summary} onChange={(e) => set('summary', e.target.value)} />
          <small>Shown under the title. Optional.</small>
        </label>
        <label className="field">
          <span>Notes</span>
          <textarea rows={6} maxLength={8000} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
          <small>Steps, the exercise, links. Optional.</small>
        </label>

        <fieldset className="cx-fieldset">
          <legend>Files</legend>
          {f.files.map((x, k) => (
            <div key={k} className="cx-ln-file-row">
              <input aria-label="File name" placeholder="Project file" value={x.name} onChange={(e) => set('files', f.files.map((y, j) => (j === k ? { ...y, name: e.target.value } : y)))} />
              <input aria-label="File link" placeholder="https://drive.google.com/…" inputMode="url" value={x.url} onChange={(e) => set('files', f.files.map((y, j) => (j === k ? { ...y, url: e.target.value } : y)))} />
              <button type="button" className="cx-icon-btn" aria-label="Remove file" onClick={() => set('files', f.files.filter((_, j) => j !== k))}>
                <Icon name="close" size={18} />
              </button>
            </div>
          ))}
          <button type="button" className="btn btn-sm cx-ln-add" onClick={() => set('files', [...f.files, { name: '', url: '' }])}>
            <Icon name="plus" size={16} />
            Add a file link
          </button>
        </fieldset>

        <label className="cx-check">
          <input type="checkbox" checked={f.published} onChange={(e) => set('published', e.target.checked)} />
          <span>Show to students</span>
        </label>

        {error && (
          <p className="cx-error" role="alert">
            {error}
          </p>
        )}

        <div className="cx-ln-form-actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : f.id ? 'Save changes' : 'Add lesson'}
          </button>
          {f.id && (
            <button type="button" className="btn cx-ln-delete" onClick={remove} disabled={busy}>
              {sure ? 'Tap again to delete' : 'Delete lesson'}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

/* ================= Phase assignment ================= */

const statusText: Record<Assignment['status'], string> = { pending: 'Waiting for review', approved: 'Approved', changes: 'Changes asked' };

function Submission({ a, showStudent = false }: { a: Assignment; showStudent?: boolean }) {
  return (
    <div className="cx-asg">
      {showStudent && a.student && (
        <A path={`/u/${a.student.handle}`} className="cx-asg-who">
          <Avatar p={a.student} size={36} />
          <span>
            <b>{a.student.name}</b>
            <small>
              Phase {a.phase} · {timeAgo(a.created_at)}
            </small>
          </span>
        </A>
      )}
      <Media post={{ kind: a.kind, media_url: a.media_url, caption: a.caption }} />
      {a.caption && <p className="cx-asg-caption">{a.caption}</p>}
      {!showStudent && (
        <p className={`cx-asg-status is-${a.status}`}>
          {statusText[a.status]} · {timeAgo(a.reviewed_at ?? a.created_at)}
        </p>
      )}
      {a.feedback && (
        <blockquote className="cx-asg-feedback">
          <small>Feedback</small>
          {a.feedback}
        </blockquote>
      )}
    </div>
  );
}

/** A readable name for a link: "Google Drive folder" rather than the address */
function linkLabel(i: BriefItem): { title: string; where: string } {
  if (i.kind !== 'link') return { title: i.name || 'Document', where: 'Download' };
  let host = '';
  try {
    host = new URL(i.url).hostname.replace(/^www\./, '');
  } catch {
    host = i.url;
  }
  if (driveFolderId(i.url)) return { title: i.name || 'Files for this assignment', where: 'Google Drive folder' };
  if (host === 'drive.google.com' || host === 'docs.google.com') return { title: i.name || 'File for this assignment', where: 'Google Drive' };
  return { title: i.name || host, where: host };
}

/* ---------- Brief attachments: pictures, documents and links ---------- */
function BriefItemsView({ items }: { items: BriefItem[] }) {
  const { me } = useConnect();
  const pics = items.filter((i) => i.kind === 'image');
  const videos = items.filter((i) => i.kind === 'video');
  const rest = items.filter((i) => i.kind !== 'image' && i.kind !== 'video');
  if (!items.length) return null;
  return (
    <>
      {videos.map((v) => (
        <figure key={v.url} className="cx-brief-video">
          <Player url={v.url} title={v.name || 'Video to recreate'} mark={me ? `${me.name} · @${me.handle}` : ''} portrait={!/#ar=(16:9|4:3|1:1)/.test(v.url)} />
          {v.name && <figcaption>{v.name}</figcaption>}
        </figure>
      ))}
      {pics.length > 0 && (
        <div className="cx-ln-pics cx-brief-pics">
          {pics.map((p) => (
            <a key={p.url} href={p.url} target="_blank" rel="noopener noreferrer">
              <img src={p.url} alt={p.name} loading="lazy" decoding="async" />
            </a>
          ))}
        </div>
      )}
      {rest.length > 0 && (
        <ul className="cx-brief-links">
          {rest.map((i) => {
            const { title, where } = linkLabel(i);
            return (
              <li key={i.url}>
                <a href={i.url} target="_blank" rel="noopener noreferrer">
                  <span className="cx-brief-link-ico" aria-hidden="true">
                    <Icon name={i.kind === 'link' ? 'link' : 'file'} size={18} />
                  </span>
                  <span className="cx-brief-link-text">
                    <b>{title}</b>
                    <small>{where}</small>
                  </span>
                  <Icon name={i.kind === 'link' ? 'out' : 'download'} size={18} />
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function BriefItemsEditor({ items, onChange }: { items: BriefItem[]; onChange: (fn: (cur: BriefItem[]) => BriefItem[]) => void }) {
  const { api, toast } = useConnect();
  const [busy, setBusy] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const upload = async (files: FileList | null, kind: 'image' | 'file') => {
    if (!files?.length) return;
    try {
      for (const file of Array.from(files)) {
        setBusy(0);
        const link = await api.uploadBriefFile(file, (p) => setBusy(p));
        onChange((cur) => [...cur, { kind, url: link, name: file.name.slice(0, 120) }]);
      }
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const addLink = () => {
    let u = url.trim();
    if (!u) return;
    if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
    // YouTube and Drive videos play right in the brief
    const video = Boolean(embedSrc(u));
    if (video && youtubeId(u) && !isShort(u)) u = `${u.replace(/#.*$/, '')}#ar=${shape}`;
    onChange((cur) => [...cur, { kind: video ? 'video' : 'link', url: u, name: name.trim().slice(0, 120) }]);
    setUrl('');
    setName('');
    setAdding(false);
  };
  const [shape, setShape] = useState('9:16');
  const isYt = Boolean(youtubeId(url)) && !isShort(url);
  return (
    <div className="field">
      <span>Attachments</span>
      {items.length > 0 && (
        <ul className="cx-brief-edit">
          {items.map((i, n) => (
            <li key={i.url + n}>
              {i.kind === 'image' ? <img src={i.url} alt="" /> : <Icon name={i.kind === 'link' ? 'link' : i.kind === 'video' ? 'video' : 'file'} size={20} />}
              <span>{i.name || i.url}</span>
              <button type="button" aria-label="Remove" onClick={() => onChange((cur) => cur.filter((_, k) => k !== n))}>
                <Icon name="close" size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <div className="cx-brief-link">
          <input value={url} inputMode="url" placeholder="Link, or a YouTube or Drive video" onChange={(e) => setUrl(e.target.value)} autoFocus />
          <input value={name} placeholder="Name (optional)" maxLength={120} onChange={(e) => setName(e.target.value)} />
          {isYt && (
            <div className="cx-chips" role="radiogroup" aria-label="Video shape">
              {SHAPES.map(([label, w, h]) => (
                <button key={label} type="button" role="radio" aria-checked={shape === `${w}:${h}`} className={shape === `${w}:${h}` ? 'cx-chip is-on' : 'cx-chip'} onClick={() => setShape(`${w}:${h}`)}>
                  {label}
                </button>
              ))}
            </div>
          )}
          <div className="cx-brief-btns">
            <button type="button" className="btn btn-primary btn-sm" onClick={addLink}>
              Add
            </button>
            <button type="button" className="btn btn-light btn-sm" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="cx-brief-btns">
          <label className="btn btn-light btn-sm">
            <input type="file" accept="image/*" multiple className="sr-only" disabled={busy !== null} onChange={(e) => (upload(e.target.files, 'image'), (e.target.value = ''))} />
            <Icon name="image" size={18} /> Picture
          </label>
          <label className="btn btn-light btn-sm">
            <input type="file" multiple className="sr-only" disabled={busy !== null} onChange={(e) => (upload(e.target.files, 'file'), (e.target.value = ''))} />
            <Icon name="file" size={18} /> Document
          </label>
          <button type="button" className="btn btn-light btn-sm" onClick={() => setAdding(true)}>
            <Icon name="link" size={18} /> Link
          </button>
          {busy !== null && <small>Uploading {Math.round(busy * 100)}%</small>}
        </div>
      )}
    </div>
  );
}

export function AssignmentScreen({ phase }: { phase: number }) {
  const { api, me } = useConnect();
  const team = Boolean(me?.is_sensei || me?.is_moderator);
  // only the Grand Sensei changes the brief; moderators who are students hand in like everyone
  const editor = Boolean(me?.is_sensei);
  const learner = Boolean(me?.is_student);
  const { list } = useLessons();
  const [mine, setMine] = useState<Assignment[] | null>(null);
  const [brief, setBrief] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [items, setItems] = useState<BriefItem[]>([]);
  const [link, setLink] = useState('');
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.getBriefs().then((b) => {
      setBrief(b[phase] ?? '');
      setDraft(b[phase] ?? '');
    }).catch(() => setBrief(''));
    api.getBriefItems().then((b) => setItems(b[phase] ?? [])).catch(() => {});
    if (learner) api.myAssignments().then(setMine).catch(() => setMine([]));
    else setMine([]);
  }, [api, phase, learner]);

  const back = (
    <A path="/learn" className="cx-back">
      <Icon name="back" size={20} />
      All lessons
    </A>
  );
  if (me === undefined || !list || mine === null || brief === null) return <Loading />;
  if (!learner && !team) {
    return (
      <div className="cx-col">
        {back}
        <Empty title="Assignments are for Black Belt members" />
      </div>
    );
  }

  const status = editor ? 'team' : phaseStatus(list, mine, phase);
  const history = mine.filter((a) => a.phase === phase);
  const approvedPost = history.find((a) => a.status === 'approved')?.post_id;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const url = link.trim();
    if (!url) return setError('Paste the link to your project.');
    if (!toEmbed(url) && !driveFolderId(url)) return setError('Use a Google Drive file or folder link, or a YouTube, Instagram, TikTok or Vimeo link.');
    setBusy(true);
    try {
      await api.submitAssignment(phase, 'video', url, caption.trim());
      setLink('');
      setCaption('');
      setMine(await api.myAssignments());
    } catch (err) {
      const m = (err as Error).message;
      setError(m === 'finish_lessons' ? `Finish every lesson in phase ${phase} first.` : m === 'already_sent' ? 'You’ve already handed this in.' : m);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cx-col cx-ln-assignment">
      {back}
      <p className="cx-ln-where">
        Phase {phase} · {PHASES[phase - 1]}
      </p>
      <h1 className="cx-h1">Phase {phase} assignment</h1>

      {editor ? (
        <form
          className="cx-form"
          onSubmit={async (e) => {
            e.preventDefault();
            await api.saveBrief(phase, draft.trim(), items).then(() => setSaved(true)).catch((err: Error) => setError(err.message));
          }}
        >
          <label className="field">
            <span>What students should hand in</span>
            <textarea rows={6} maxLength={4000} value={draft} onChange={(e) => (setDraft(e.target.value), setSaved(false))} />
          </label>
          <BriefItemsEditor
            items={items}
            onChange={(fn) => {
              setItems(fn);
              setSaved(false);
            }}
          />
          {error && <p className="cx-error">{error}</p>}
          <div className="cx-ln-form-actions">
            <button type="submit" className="btn btn-primary">
              {saved ? 'Saved' : 'Save brief'}
            </button>
            <A path="/reviews" className="btn cx-ln-edit">
              Review assignments
            </A>
          </div>
        </form>
      ) : (
        <>
          {brief ? <Notes text={brief} /> : <p className="cx-ln-summary">Hand in the project you made in this phase.</p>}
          <BriefItemsView items={items} />

          {!learner && team && (
            <A path="/reviews" className="btn cx-ln-edit">
              Review assignments
            </A>
          )}
          {learner && status === 'locked' && <p className="cx-asg-state">Finish every lesson in phase {phase} to hand it in.</p>}
          {learner && status === 'pending' && <p className="cx-asg-state">Handed in. The next phase opens when it’s approved.</p>}
          {learner && status === 'approved' && (
            <p className="cx-asg-state is-ok">
              <Icon name="check" size={18} />
              <span>
                Approved. {phase < 4 ? `Phase ${phase + 1} is open.` : 'You’ve finished Black Belt.'}{' '}
                {approvedPost && <A path={`/p/${approvedPost}`}>See it on the feed</A>}
              </span>
            </p>
          )}

          {learner && (status === 'due' || status === 'changes') && (
            <form className="cx-form cx-asg-form" onSubmit={submit} noValidate>
              <label className="field">
                <span>Link to your project</span>
                <input value={link} inputMode="url" placeholder="https://drive.google.com/…" onChange={(e) => setLink(e.target.value)} />
                <small>A Google Drive file or folder (shared with “Anyone with the link”), or YouTube, Instagram, TikTok or Vimeo.</small>
              </label>
              <label className="field">
                <span>About your project</span>
                <textarea rows={3} maxLength={1000} value={caption} onChange={(e) => setCaption(e.target.value)} />
                <small>Goes on the feed with your project once approved.</small>
              </label>
              {error && (
                <p className="cx-error" role="alert">
                  {error}
                </p>
              )}
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? 'Sending…' : 'Hand it in'}
              </button>
            </form>
          )}

          {history.length > 0 && (
            <section className="cx-ln-block">
              <h2>What you handed in</h2>
              <div className="cx-asg-list">
                {history.map((a) => (
                  <Submission key={a.id} a={a} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}


/* ================= Phase check (team) ================= */
/** Students who said which phase they're in. Confirm it, put them in another
    phase, or decline so they choose again. */
function PhaseChecks() {
  const { api, ask, toast } = useConnect();
  const [list, setList] = useState<PhaseRequest[] | null>(null);
  const [other, setOther] = useState('');
  const [busy, setBusy] = useState('');

  const load = () => api.phaseRequests().then(setList).catch(() => setList([]));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  const first = (r: PhaseRequest) => r.name.split(' ')[0];
  const place = async (r: PhaseRequest, phase: number | null) => {
    if (phase === null && !(await ask({ title: `Decline ${first(r)}’s phase?`, body: 'They’ll choose again.', confirm: 'Decline', danger: true }))) return;
    setBusy(r.id);
    try {
      await api.setStudentPhase(r.id, phase);
      toast(phase === null ? 'Declined' : `${first(r)}: phase ${phase}`);
      setOther('');
      await load();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy('');
    }
  };
  const confirmAll = async () => {
    if (!list?.length || !(await ask({ title: `Confirm all ${list.length}?`, body: 'Everyone gets the phase they chose.', confirm: 'Confirm all' }))) return;
    setBusy('all');
    for (const r of list) await api.setStudentPhase(r.id, r.phase_request).catch(() => {});
    setBusy('');
    toast('Phases confirmed');
    await load();
  };

  if (!list || list.length === 0) return null;
  return (
    <section className="cx-ln-block cx-phase-checks" aria-label="Phase check">
      <div className="cx-phase-checks-head">
        <h2>Phases to confirm · {list.length}</h2>
        {list.length > 1 && (
          <button type="button" className="btn btn-light btn-sm" disabled={busy !== ''} onClick={confirmAll}>
            Confirm all
          </button>
        )}
      </div>
      <ul>
        {list.map((r) => (
          <li key={r.id} className="cx-phase-check">
            <div className="cx-phase-check-who">
              <Avatar p={r} size={40} />
              <span>
                <b>{r.name}</b>
                <small>
                  Phase {r.phase_request} · {timeAgo(r.phase_request_at)}
                </small>
              </span>
            </div>
            {other === r.id ? (
              <div className="cx-phase-check-btns">
                
                {PHASES.map((_, i) => (
                  <button key={i} type="button" className="cx-chip" disabled={busy === r.id} onClick={() => place(r, i + 1)}>
                    Phase {i + 1}
                  </button>
                ))}
                <button type="button" className="cx-text-btn" onClick={() => setOther('')}>
                  Cancel
                </button>
              </div>
            ) : (
              <div className="cx-phase-check-btns">
                <button type="button" className="btn btn-primary btn-sm" disabled={busy === r.id} onClick={() => place(r, r.phase_request)}>
                  Confirm
                </button>
                <button type="button" className="btn btn-light btn-sm" disabled={busy === r.id} onClick={() => setOther(r.id)}>
                  Change
                </button>
                <button type="button" className="btn btn-light btn-sm cx-danger" disabled={busy === r.id} onClick={() => place(r, null)}>
                  Decline
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ================= Reviews (team) ================= */
export function Reviews() {
  const { api, me } = useConnect();
  const team = Boolean(me?.is_sensei || me?.is_moderator);
  const [list, setList] = useState<Assignment[] | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (team) api.reviewQueue().then(setList).catch((e: Error) => setError(e.message));
  }, [api, team]);

  if (me === undefined) return <Loading />;
  if (!team) return <Empty title="Only the Motion Dojo team can review assignments" />;
  if (error) return <Empty title="Reviews can’t load">{<p>{error}</p>}</Empty>;
  if (!list) return <Loading label="Loading assignments" />;

  const waiting = list.filter((a) => a.status === 'pending');
  const done = list.filter((a) => a.status !== 'pending').slice(0, 30);

  const review = async (a: Assignment, approve: boolean) => {
    const note = (notes[a.id] ?? '').trim();
    if (!approve && !note) return setError('Write what to change before sending it back.');
    setBusy(a.id);
    setError('');
    try {
      await api.reviewAssignment(a.id, approve, note);
      setList(await api.reviewQueue());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="cx-col cx-reviews">
      <div className="cx-intro">
        <h1 className="cx-h1">Assignment reviews</h1>
        <p>{waiting.length ? `${waiting.length} assignments waiting.` : 'No assignments waiting.'}</p>
      </div>
      <PhaseChecks />
      {error && <p className="cx-error">{error}</p>}
      <div className="cx-asg-list">
        {waiting.map((a) => (
          <div key={a.id} className="cx-asg-review">
            <Submission a={a} showStudent />
            <label className="field">
              <span>Note to {a.student?.name ?? 'the student'}</span>
              <textarea rows={2} maxLength={2000} value={notes[a.id] ?? ''} onChange={(e) => setNotes({ ...notes, [a.id]: e.target.value })} />
              <small>Needed when asking for changes.</small>
            </label>
            <div className="cx-ln-form-actions">
              <button type="button" className="btn btn-primary" disabled={busy === a.id} onClick={() => review(a, true)}>
                Approve
              </button>
              <button type="button" className="btn cx-ln-edit" disabled={busy === a.id} onClick={() => review(a, false)}>
                Ask for changes
              </button>
            </div>
          </div>
        ))}
      </div>
      {done.length > 0 && (
        <section className="cx-ln-block cx-reviewed">
          <h2>Reviewed</h2>
          <ul>
            {done.map((a) => (
              <li key={a.id}>
                <b>{a.student?.name}</b> · Phase {a.phase} · <span className={`cx-asg-status is-${a.status}`}>{statusText[a.status]}</span>
                {a.post_id && (
                  <>
                    {' · '}
                    <A path={`/p/${a.post_id}`}>Post</A>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/* ================= Student devices (team) ================= */
export function Devices() {
  const { api, me, toast, ask } = useConnect();
  const team = Boolean(me?.is_sensei || me?.is_moderator);
  const [rows, setRows] = useState<DeviceRow[] | null>(null);
  const [roles, setRoles] = useState<Record<string, string>>({});
  useEffect(() => {
    api.teamRoles().then(setRoles).catch(() => {});
  }, [api]);
  // Grand Sensei: add a student to the team with a role, change it, or take them off
  const setRole = async (r: DeviceRow, off = false) => {
    const first = r.name.split(' ')[0];
    let role: string | null = null;
    if (!off) {
      const v = await ask({ title: roles[r.user_id] ? `${first}’s role` : `Make ${first} part of the team`, body: 'Their role shows next to their belt, and they can moderate.', input: 'Community manager', value: roles[r.user_id] ?? '', confirm: 'Save' });
      if (v === null) return;
      role = v.trim().slice(0, 40) || null;
      if (!role) return;
    } else if (!(await ask({ title: `Remove ${first} from the team?`, body: 'They stay a student.', confirm: 'Remove', danger: true }))) return;
    try {
      await api.setTeamRole(r.user_id, role);
      setRoles((cur) => {
        const next = { ...cur };
        if (role) next[r.user_id] = role;
        else delete next[r.user_id];
        return next;
      });
      toast(role ? `${first} is now ${role}` : `${first} is off the team`);
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const [error, setError] = useState('');
  const [sure, setSure] = useState('');
  const [busy, setBusy] = useState('');
  const [fresh, setFresh] = useState<{ id: string; code: string } | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    if (team) api.teamDevices().then(setRows).catch((e: Error) => setError(e.message));
  }, [api, team]);

  if (me === undefined) return <Loading />;
  if (!team) return <Empty title="Only the Motion Dojo team can see this" />;
  if (error) return <Empty title="Students can’t load">{<p>{error}</p>}</Empty>;
  if (!rows) return <Loading label="Loading students" />;

  const refresh = async () => setRows(await api.teamDevices());
  const reset = async (r: DeviceRow) => {
    if (sure !== r.user_id) return setSure(r.user_id);
    setSure('');
    try {
      const code = await api.resetMemberId(r.user_id);
      setFresh({ id: r.user_id, code });
      await refresh();
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const ban = async (r: DeviceRow, on: boolean) => {
    if (
      on &&
      !(await ask({
        title: `Ban ${r.name} from Connect?`,
        body: 'They’re signed out everywhere, can’t sign in again, leave the group and Members, and their posts are hidden. You can unban them later.',
        confirm: 'Ban',
        danger: true,
      }))
    )
      return;
    setBusy(r.user_id);
    try {
      await api.banUser(r.user_id, on);
      toast(on ? `${r.name} is banned` : `${r.name} can sign in again`);
      await refresh();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy('');
    }
  };
  const remove = async (r: DeviceRow) => {
    const typed = await ask({
      title: `Delete ${r.name}’s account?`,
      body: `This deletes their account, everything they posted and their member ID. It can’t be undone; they’d have to enrol again. Type DELETE to confirm.`,
      input: 'DELETE',
      confirm: 'Delete',
      danger: true,
    });
    if ((typed || '').trim().toUpperCase() !== 'DELETE') return;
    setBusy(r.user_id);
    try {
      await api.removeUser(r.user_id);
      toast(`${r.name}’s account was deleted`);
      await refresh();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  const match = (r: DeviceRow) => !q || `${r.name} ${r.handle} ${r.email}`.toLowerCase().includes(q.toLowerCase());
  const active = rows.filter((r) => !r.banned && match(r));
  const banned = rows.filter((r) => r.banned && match(r));
  const seen = (r: DeviceRow) =>
    r.label ? `${r.label}, last active ${r.last_seen_at ? (timeAgo(r.last_seen_at) === 'just now' ? 'just now' : `${timeAgo(r.last_seen_at)} ago`) : 'never'}` : 'Not signed in';

  return (
    <div className="cx-col cx-devices">
      <div className="cx-intro">
        <h1 className="cx-h1">Students</h1>
        <p>Each student can be signed in on one device. If an account changes device often, the member ID may have been shared.</p>
      </div>
      <label className="cx-search">
        <Icon name="search" size={20} />
        <input type="search" placeholder="Search by name or email" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <ul className="cx-dev-list">
        {active.map((r) => (
          <li key={r.user_id}>
            <span className="cx-dev-main">
              <b>
                <A path={`/u/${r.handle}`}>{r.name}</A>
              </b>
              <small>{r.email}</small>
              <small>{seen(r)}</small>
              <small className={r.changes_7d >= 4 ? 'cx-dev-many' : ''}>
                {r.changes_7d === 1 ? 'Signed in on 1 device this week' : `Changed device ${r.changes_7d} times this week`}
              </small>
            </span>
            {fresh?.id === r.user_id && (
              <span className="cx-dev-code">
                New ID: <b>{fresh.code}</b>. Send it to {r.name}. The old one no longer works.
              </span>
            )}
            {roles[r.user_id] && <span className="cx-role-tag">{roles[r.user_id]}</span>}
            <span className="cx-dev-actions">
              {me?.is_sensei && (
                <button type="button" className="btn btn-sm cx-dev-act" onClick={() => setRole(r)} disabled={busy === r.user_id}>
                  {roles[r.user_id] ? 'Change role' : 'Make team'}
                </button>
              )}
              {me?.is_sensei && roles[r.user_id] && (
                <button type="button" className="btn btn-sm cx-dev-act" onClick={() => setRole(r, true)} disabled={busy === r.user_id}>
                  Remove from team
                </button>
              )}
              <button type="button" className="btn btn-sm cx-dev-act" onClick={() => reset(r)} disabled={busy === r.user_id}>
                {sure === r.user_id ? 'Tap again to reset' : 'Reset member ID'}
              </button>
              <button type="button" className="btn btn-sm cx-dev-act" onClick={() => ban(r, true)} disabled={busy === r.user_id}>
                Ban from Connect
              </button>
              <button type="button" className="btn btn-sm cx-dev-act cx-ln-delete" onClick={() => remove(r)} disabled={busy === r.user_id}>
                Delete account
              </button>
            </span>
          </li>
        ))}
        {active.length === 0 && <li className="cx-gi-none">{q ? `No one matches “${q}”.` : 'No students yet.'}</li>}
      </ul>

      {banned.length > 0 && (
        <section className="cx-ln-block cx-dev-banned">
          <h2>Banned from Connect</h2>
          <ul className="cx-dev-list">
            {banned.map((r) => (
              <li key={r.user_id}>
                <span className="cx-dev-main">
                  <b>{r.name}</b>
                  <small>{r.email}</small>
                </span>
                <span className="cx-dev-actions">
                  <button type="button" className="btn btn-sm cx-dev-act" onClick={() => ban(r, false)} disabled={busy === r.user_id}>
                    Unban
                  </button>
                  <button type="button" className="btn btn-sm cx-dev-act cx-ln-delete" onClick={() => remove(r)} disabled={busy === r.user_id}>
                    Delete account
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
