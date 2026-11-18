'use client';
/* Learn: the Black Belt lessons.
   Lessons open one after another; a student marks a lesson done to open the
   next. Videos are Google Drive files shown in Drive's player, with its
   pop-out button covered and the student's name over the picture. */

import React, { useEffect, useMemo, useState } from 'react';
import { useConnect } from './context';
import { peek } from './cache';
import { navigate } from './router';
import { PHASES, type Lesson, type LessonInput } from './types';
import { A, Empty, Icon, Loading } from './ui';

const MAIN_SITE = process.env.NEXT_PUBLIC_MAIN_SITE_URL || 'https://joinmotiondojo.com';

/* ---------- Video links ---------- */

/** Google Drive file id from any Drive link (or a bare id) */
export function driveId(url: string) {
  const u = url.trim();
  const m = /\/file\/d\/([\w-]{20,})/.exec(u) || /[?&]id=([\w-]{20,})/.exec(u) || /^([\w-]{25,})$/.exec(u);
  return m ? m[1] : null;
}

function youtubeId(url: string) {
  const m = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/.exec(url);
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

const lessonNo = (list: Lesson[], l: Lesson) => list.filter((x) => x.phase === l.phase).indexOf(l) + 1;

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

/* ================= Course outline ================= */
export function Learn() {
  const { api, me, signedIn } = useConnect();
  const { list, setList, error } = useLessons();
  const team = Boolean(me?.is_sensei || me?.is_moderator);
  const learner = Boolean(me && (me.is_student || team));

  const published = useMemo(() => (list ?? []).filter((l) => l.published), [list]);
  const done = published.filter((l) => l.done).length;
  const next = (list ?? []).find((l) => l.open && !l.done && l.published);

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
          <p>Mark a lesson done to open the next one.</p>
        ) : (
          <p>Every lesson in Black Belt in Motion Design.</p>
        )}
        {team && (
          <A path="/learn/new" className="btn btn-primary btn-sm">
            <Icon name="plus" size={18} />
            Add lesson
          </A>
        )}
      </div>

      {learner && !team && published.length > 0 && (
        <section className="cx-ln-progress" aria-label="Your progress">
          <div className="cx-ln-progress-row">
            <b>
              {done} of {published.length} lessons done
            </b>
            <span>{Math.round((done / published.length) * 100)}%</span>
          </div>
          <div className="cx-ln-bar" role="progressbar" aria-valuemin={0} aria-valuemax={published.length} aria-valuenow={done}>
            <span style={{ width: `${(done / published.length) * 100}%` }} />
          </div>
          {next ? (
            <A path={`/learn/${next.id}`} className="cx-ln-next">
              <span className="cx-ln-next-ico">
                <Icon name="play" size={20} filled />
              </span>
              <span>
                <small>{done ? 'Up next' : 'Start here'} · Phase {next.phase}, lesson {lessonNo(list, next)}</small>
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
        PHASES.map((name, i) => {
          const phase = i + 1;
          const items = list.filter((l) => l.phase === phase);
          if (items.length === 0) return null;
          const pub = items.filter((l) => l.published);
          const finished = pub.filter((l) => l.done).length;
          return (
            <section key={phase} className="cx-ln-phase">
              <header>
                <h2>
                  <small>Phase {phase}</small>
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
                  const body = (
                    <>
                      <span className={`cx-ln-mark${l.done ? ' is-done' : l.open ? ' is-open' : ''}`} aria-hidden="true">
                        {l.done ? <Icon name="check" size={18} /> : l.open ? n + 1 : <Icon name="lock" size={16} />}
                      </span>
                      <span className="cx-ln-text">
                        <b>{l.title}</b>
                        <small>
                          {l.duration || (l.has_video ? 'Video' : 'No video yet')}
                          {team && !l.published && <em className="cx-ln-tag">Draft</em>}
                          {team && !l.has_video && <em className="cx-ln-tag">No video</em>}
                        </small>
                      </span>
                      <span className="sr-only">{l.done ? 'Done' : l.open ? 'Open' : 'Locked'}</span>
                    </>
                  );
                  return (
                    <li key={l.id} className={l.open ? '' : 'is-locked'}>
                      {l.open ? (
                        <A path={`/learn/${l.id}`} className="cx-ln-row">
                          {body}
                        </A>
                      ) : (
                        <div className="cx-ln-row" aria-disabled="true">
                          {body}
                        </div>
                      )}
                      {team && (
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
                  );
                })}
              </ol>
            </section>
          );
        })
      )}
    </div>
  );
}

/* ================= One lesson ================= */

/** The student's name drifting over the video, so a screen recording shows who made it */
function Watermark({ text }: { text: string }) {
  const [spot, setSpot] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setSpot((s) => (s + 1) % 4), 12000);
    return () => window.clearInterval(t);
  }, []);
  return (
    <span className={`cx-wm cx-wm-${spot}`} aria-hidden="true">
      {text}
    </span>
  );
}

function Player({ url, title, mark }: { url: string; title: string; mark: string }) {
  const e = embedSrc(url);
  if (!e) {
    return (
      <div className="cx-player is-empty">
        <Icon name="video" size={30} />
        <span>No video yet</span>
      </div>
    );
  }
  return (
    <div className="cx-player" onContextMenu={(ev) => ev.preventDefault()}>
      <iframe src={e.src} title={title} allow="autoplay; encrypted-media; fullscreen" allowFullScreen loading="lazy" referrerPolicy="no-referrer" />
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
    <div className="cx-col cx-lesson">
      {back}
      <Player url={lesson.video_url ?? ''} title={lesson.title} mark={mark} />

      <div className="cx-ln-head">
        <p className="cx-ln-where">
          Phase {lesson.phase} · {PHASES[lesson.phase - 1]}
          {n > 0 && ` · Lesson ${n}`}
          {lesson.duration && ` · ${lesson.duration}`}
          {!lesson.published && <em className="cx-ln-tag">Draft</em>}
        </p>
        <h1 className="cx-h1">{lesson.title}</h1>
        {lesson.summary && <p className="cx-ln-summary">{lesson.summary}</p>}
      </div>

      <div className="cx-ln-actions">
        <button type="button" className={`btn btn-sm ${lesson.done ? 'cx-ln-done' : 'btn-primary'}`} onClick={toggleDone} disabled={busy} aria-pressed={lesson.done}>
          <Icon name="check" size={18} />
          {lesson.done ? 'Done' : 'Mark as done'}
        </button>
        {lesson.done && next && (next.open || team) && (
          <A path={`/learn/${next.id}`} className="btn btn-lime btn-sm">
            Next lesson
            <Icon name="out" size={16} />
          </A>
        )}
        {team && (
          <A path={`/learn/${lesson.id}/edit`} className="btn btn-sm cx-ln-edit">
            Edit lesson
          </A>
        )}
      </div>

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
  );
}

/* ================= Add / edit a lesson (team) ================= */
const EMPTY: LessonInput = { phase: 1, title: '', summary: '', duration: '', video_url: '', notes: '', files: [], published: true };

export function LessonEditor({ id }: { id?: string }) {
  const { api, me } = useConnect();
  const team = Boolean(me?.is_sensei || me?.is_moderator);
  const [f, setF] = useState<LessonInput | null>(id ? null : EMPTY);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState(false);

  useEffect(() => {
    if (!id || !team) return;
    api
      .getLesson(id)
      .then((l) => setF({ id: l.id, phase: l.phase, title: l.title, summary: l.summary, duration: l.duration, video_url: l.video_url ?? '', notes: l.notes ?? '', files: l.files ?? [], published: l.published }))
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
            {PHASES.map((p, i) => (
              <option key={p} value={i + 1}>
                Phase {i + 1}: {p}
              </option>
            ))}
          </select>
          {!f.id && <small>It goes at the end of this phase. You can move it on the lessons page.</small>}
        </label>
        <label className="field">
          <span>Title</span>
          <input value={f.title} maxLength={140} onChange={(e) => set('title', e.target.value)} placeholder="Keyframes and easing" />
        </label>
        <label className="field">
          <span>Google Drive video link</span>
          <input value={f.video_url} inputMode="url" onChange={(e) => set('video_url', e.target.value)} placeholder="https://drive.google.com/file/d/…/view" />
          <small className={playable ? '' : 'cx-ln-bad'}>
            {playable
              ? 'In Drive: Share, set General access to “Anyone with the link” as Viewer, then in the settings untick “Viewers can download”. Copy the link and paste it here.'
              : 'This isn’t a Google Drive file link yet.'}
          </small>
        </label>
        {video && playable && (
          <div className="cx-ln-preview">
            <Player url={video} title="Preview" mark={`${me?.name ?? ''} · preview`} />
          </div>
        )}
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
