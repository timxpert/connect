'use client';

/* Dojo Challenge and the Members tab.
   - Challenge: a short brief every couple of weeks. Students hand in a link
     (TikTok, Instagram, YouTube or Drive), so nothing is stored in Connect.
     The Grand Sensei picks one entry and writes a short note.
   - Members (members only): the people list, with who handed in and streaks.
   - Projects (visitors): approved final projects, I and II.
   Visitors only ever see the picked entry and the count. */
import React, { useEffect, useMemo, useState } from 'react';
import { isMember, useConnect } from './context';
import { peek } from './cache';
import { isTall, toEmbed } from './media';
import { A, Avatar, BeltBadge, Empty, Icon, Loading, PostCard } from './ui';
import { youtubeId, ytThumb } from './youtube';
import type { Challenge, ChallengeEntry, ChallengeStat, Post } from './types';

const MAIN_SITE = process.env.NEXT_PUBLIC_MAIN_SITE_URL || 'https://joinmotiondojo.com';
const isOpen = (c: Challenge) => new Date(c.ends_at).getTime() > Date.now();
const endsLabel = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
const daysLeft = (iso: string) => {
  const d = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
  return d <= 1 ? 'Last day' : `${d} days left`;
};

/* ---------- The tabs at the top of the Members page ---------- */
export function MembersTabs({ tab }: { tab: 'challenge' | 'members' | 'projects' }) {
  const { me } = useConnect();
  const member = isMember(me);
  const second = member ? { path: '/students/members', label: 'Members', key: 'members' } : { path: '/students/projects', label: 'Projects', key: 'projects' };
  return (
    <nav className="cx-seg" aria-label="Members page">
      <A path="/students" className={tab === 'challenge' ? 'is-on' : ''} aria-current={tab === 'challenge' ? 'page' : undefined}>
        Challenge
      </A>
      <A path={second.path} className={tab === second.key ? 'is-on' : ''} aria-current={tab === second.key ? 'page' : undefined}>
        {second.label}
      </A>
    </nav>
  );
}

/* ---------- A handed-in video: nothing loads until it's tapped ---------- */
export function EntryVideo({ url, title }: { url: string; title: string }) {
  const [on, setOn] = useState(false);
  const embed = toEmbed(url);
  const tall = isTall(url);
  const y = youtubeId(url);
  if (!embed) {
    return (
      <a className="cx-entry-video is-link" href={url} target="_blank" rel="noopener noreferrer">
        <Icon name="video" size={24} /> Watch the video
      </a>
    );
  }
  if (!on) {
    return (
      <button type="button" className={`cx-entry-video${tall ? ' is-tall' : ''}`} onClick={() => setOn(true)} aria-label={`Play ${title}`}>
        {y && <img src={ytThumb(y)} alt="" referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.style.display = 'none')} />}
        <span className="cx-entry-play" aria-hidden="true">
          <Icon name="play" size={22} filled />
        </span>
      </button>
    );
  }
  return (
    <div className={`cx-entry-video is-on${tall ? ' is-tall' : ''}`}>
      <iframe src={embed} title={title} allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
    </div>
  );
}

function useChallenges() {
  const { api } = useConnect();
  const [list, setList] = useState<Challenge[] | null>(() => peek<Challenge[]>('listChallenges') ?? null);
  const [stats, setStats] = useState<ChallengeStat[]>(() => peek<ChallengeStat[]>('challengeStats') ?? []);
  const load = () => {
    api.listChallenges().then(setList).catch(() => setList([]));
    api.challengeStats().then(setStats).catch(() => {});
  };
  useEffect(load, [api]);
  return { list, stats, reload: load };
}

/* ---------- Challenge tab ---------- */
export function ChallengeTab() {
  const { api, me, signedIn, toast } = useConnect();
  const team = Boolean(me?.is_sensei || me?.is_moderator);
  const student = Boolean(me?.is_student);
  const insider = isMember(me);
  const { list, stats, reload } = useChallenges();
  const [entries, setEntries] = useState<ChallengeEntry[]>([]);
  const [pickEntry, setPickEntry] = useState<ChallengeEntry | null>(null);
  const [editing, setEditing] = useState<Challenge | 'new' | null>(null);
  const [handing, setHanding] = useState(false);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);

  const current = useMemo(() => (list ?? []).filter(isOpen).sort((a, b) => a.ends_at.localeCompare(b.ends_at))[0] ?? null, [list]);
  const closed = useMemo(() => (list ?? []).filter((c) => !isOpen(c)), [list]);
  const last = closed[0] ?? null;
  const earlier = closed.slice(1).filter((c) => c.pick_id);

  useEffect(() => {
    if (current && insider) api.listEntries(current.id).then(setEntries).catch(() => setEntries([]));
    else setEntries([]);
  }, [api, current, insider]);
  useEffect(() => {
    if (last?.pick_id) api.listEntries(last.id).then((r) => setPickEntry(r.find((e) => e.id === last.pick_id) ?? null)).catch(() => setPickEntry(null));
    else setPickEntry(null);
  }, [api, last]);

  if (list === null) return <Loading label="Loading the challenge" />;

  const mine = entries.find((e) => e.user_id === me?.id);
  const myStat = stats.find((s) => s.user_id === me?.id);
  const students = stats.length;

  const handIn = async () => {
    if (!current) return;
    const url = link.trim();
    if (!toEmbed(url)) return toast('Paste a TikTok, Instagram, YouTube or Google Drive link to your video.');
    setBusy(true);
    try {
      await api.submitEntry(current.id, url);
      setLink('');
      setHanding(false);
      toast('Handed in');
      setEntries(await api.listEntries(current.id));
      reload();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const takeBack = async () => {
    if (!mine || !current) return;
    setBusy(true);
    try {
      await api.removeEntry(mine.id);
      setEntries(await api.listEntries(current.id));
      reload();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cx-challenge">
      {editing && <ChallengeForm c={editing === 'new' ? null : editing} onDone={() => (setEditing(null), reload())} />}

      {current ? (
        <section className="cx-ch-card" aria-labelledby="ch-title">
          <span className="cx-ch-when">
            Challenge {current.number} · ends {endsLabel(current.ends_at)}
          </span>
          <h1 id="ch-title">{current.title}</h1>
          {current.brief && <p className="cx-ch-brief">{current.brief}</p>}

          {insider && (
            <div className="cx-ch-count">
              {entries.length > 0 && (
                <span className="cx-ch-faces" aria-hidden="true">
                  {entries.slice(0, 6).map((e) => e.user && <Avatar key={e.id} p={e.user} size={28} />)}
                </span>
              )}
              <span>
                <b>
                  {entries.length}
                  {students ? ` of ${students}` : ''}
                </b>{' '}
                handed in · {daysLeft(current.ends_at)}
              </span>
            </div>
          )}

          {student &&
            (mine ? (
              <div className="cx-ch-mine">
                <span className="cx-ch-mine-text">
                  <b>Handed in</b>
                  <span>The pick comes out after {endsLabel(current.ends_at)}</span>
                </span>
                <button type="button" className="cx-ch-ghost" onClick={() => (setLink(mine.url), setHanding(true))} disabled={busy}>
                  Change
                </button>
                <button type="button" className="cx-ch-ghost" onClick={takeBack} disabled={busy}>
                  Take back
                </button>
              </div>
            ) : null)}
          {student && (handing || !mine) && (
            handing ? (
              <form
                className="cx-ch-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  handIn();
                }}
              >
                <label className="sr-only" htmlFor="ch-link">
                  Link to your video
                </label>
                <input id="ch-link" inputMode="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="TikTok, Instagram, YouTube or Drive link" autoFocus />
                <div className="cx-ch-form-btns">
                  <button type="submit" className="cx-ch-cta" disabled={busy || !link.trim()}>
                    {busy ? 'Sending…' : 'Hand in'}
                  </button>
                  <button type="button" className="cx-ch-ghost" onClick={() => (setHanding(false), setLink(''))}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <button type="button" className="cx-ch-cta" onClick={() => setHanding(true)}>
                Hand in your entry
              </button>
            )
          )}
          {!insider && (
            <a className="cx-ch-cta" href={`${MAIN_SITE}/blackbelt`}>
              Join Black Belt to take part
            </a>
          )}
          {team && (
            <div className="cx-ch-team">
              <A path={`/challenge/${current.id}`} className="cx-ch-ghost">
                See entries
              </A>
              <button type="button" className="cx-ch-ghost" onClick={() => setEditing(current)}>
                Edit
              </button>
            </div>
          )}
        </section>
      ) : (
        <section className="cx-ch-card is-empty">
          <h1>No challenge right now</h1>
          <p className="cx-ch-brief">{team ? 'Set the next one. Every student gets a notification.' : 'The next one is coming soon.'}</p>
          {team && (
            <button type="button" className="cx-ch-cta" onClick={() => setEditing('new')}>
              New challenge
            </button>
          )}
          {!insider && (
            <a className="cx-ch-cta" href={`${MAIN_SITE}/blackbelt`}>
              Join Black Belt to take part
            </a>
          )}
        </section>
      )}
      {team && current && (
        <button type="button" className="cx-ch-new" onClick={() => setEditing('new')}>
          <Icon name="plus" size={18} /> New challenge
        </button>
      )}

      {student && myStat && (
        <section className="cx-ch-streak">
          <FlameIcon />
          <span>
            <b>{myStat.streak === 0 ? 'No streak yet' : myStat.streak === 1 ? '1 challenge in a row' : `${myStat.streak} challenges in a row`}</b>
            <span>
              {current && !mine
                ? `Hand in by ${endsLabel(current.ends_at)} to ${myStat.streak ? `make it ${myStat.streak + 1}` : 'start one'}`
                : myStat.picks
                  ? `Picked ${myStat.picks === 1 ? 'once' : `${myStat.picks} times`}`
                  : 'Keep it going'}
            </span>
          </span>
        </section>
      )}

      {last && (
        <section className="cx-ch-last" aria-labelledby="ch-last">
          <h2 id="ch-last">Last challenge: {last.title}</h2>
          {pickEntry ? (
            <article className="cx-ch-pick">
              <EntryVideo url={pickEntry.url} title={`${pickEntry.user?.name ?? 'Student'}’s entry`} />
              <div className="cx-ch-pick-text">
                {pickEntry.user && (
                  <A path={`/u/${pickEntry.user.handle}`} className="cx-ch-who">
                    <Avatar p={pickEntry.user} size={36} />
                    <span>
                      <b>{pickEntry.user.name}</b>
                      <BeltBadge p={pickEntry.user} small />
                    </span>
                  </A>
                )}
                {last.pick_note && (
                  <p>
                    “{last.pick_note}” <span>Grand Sensei</span>
                  </p>
                )}
              </div>
            </article>
          ) : (
            <p className="cx-ch-quiet">{team ? 'No pick yet.' : 'The pick is coming.'}</p>
          )}
          <div className="cx-ch-links">
            <span>{last.entries === 1 ? '1 student handed in' : `${last.entries} students handed in`}</span>
            {insider && (
              <A path={`/challenge/${last.id}`}>{team && !last.pick_id ? 'Choose the pick' : 'See all entries'}</A>
            )}
          </div>
        </section>
      )}

      {earlier.length > 0 && (
        <section className="cx-ch-earlier" aria-labelledby="ch-earlier">
          <h2 id="ch-earlier">Earlier challenges</h2>
          <ul>
            {earlier.map((c) => (
              <li key={c.id}>
                <A path={`/challenge/${c.id}`}>
                  <b>{c.title}</b>
                  <span>
                    Challenge {c.number} · {c.entries} handed in
                  </span>
                  <Icon name="forward" size={18} />
                </A>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!signedIn && (
        <p className="cx-ch-quiet">
          Already a member? <A path="/login">Sign in</A>
        </p>
      )}
    </div>
  );
}

function FlameIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ef6c1a" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3c1 4 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-3.5 2-5 1 1.5 2 1.5 2.5.5C12 7 11.5 5 12 3z" />
    </svg>
  );
}

/* ---------- Team: new or edit challenge ---------- */
function ChallengeForm({ c, onDone }: { c: Challenge | null; onDone: () => void }) {
  const { api, toast, ask } = useConnect();
  const twoWeeks = new Date(Date.now() + 13 * 86400000).toISOString().slice(0, 10);
  const [title, setTitle] = useState(c?.title ?? '');
  const [brief, setBrief] = useState(c?.brief ?? '');
  const [ends, setEnds] = useState(c ? c.ends_at.slice(0, 10) : twoWeeks);
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return toast('Give the challenge a name.');
    setBusy(true);
    try {
      // ends at 23:59 on the chosen day
      await api.saveChallenge({ id: c?.id, title, brief, ends_at: new Date(`${ends}T23:59:00`).toISOString() });
      toast(c ? 'Saved' : 'Challenge posted. Students have been told.');
      onDone();
    } catch (err) {
      toast((err as Error).message);
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!c || !(await ask({ title: `Delete “${c.title}”?`, body: 'Its entries go too.', confirm: 'Delete', danger: true }))) return;
    await api.deleteChallenge(c.id).catch((err: Error) => toast(err.message));
    onDone();
  };
  return (
    <form className="cx-form cx-ch-edit" onSubmit={save}>
      <h2>{c ? `Edit challenge ${c.number}` : 'New challenge'}</h2>
      <label className="field">
        <span>Name</span>
        <input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="Logo bounce" autoFocus />
      </label>
      <label className="field">
        <span>Brief</span>
        <textarea rows={3} maxLength={1000} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="Drop a logo in and settle it with a bounce. 5 seconds, keyframes only." />
      </label>
      <label className="field">
        <span>Last day</span>
        <input type="date" value={ends} onChange={(e) => setEnds(e.target.value)} required />
      </label>
      <div className="cx-ch-form-btns">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {c ? 'Save' : 'Post challenge'}
        </button>
        <button type="button" className="btn btn-light" onClick={onDone}>
          Cancel
        </button>
        {c && (
          <button type="button" className="btn btn-light cx-danger" onClick={remove}>
            Delete
          </button>
        )}
      </div>
    </form>
  );
}

/* ---------- All entries of one challenge ---------- */
export function ChallengeScreen({ id }: { id: string }) {
  const { api, me, toast, ask } = useConnect();
  const team = Boolean(me?.is_sensei || me?.is_moderator);
  const [c, setC] = useState<Challenge | null | undefined>(() => peek<Challenge[]>('listChallenges')?.find((x) => x.id === id));
  const [entries, setEntries] = useState<ChallengeEntry[] | null>(null);
  const load = () => {
    api
      .listChallenges()
      .then((l) => setC(l.find((x) => x.id === id) ?? null))
      .catch(() => setC(null));
    api.listEntries(id).then(setEntries).catch(() => setEntries([]));
  };
  useEffect(load, [api, id]);

  if (c === null) return <Empty title="This challenge isn’t here any more" />;
  if (!c || !entries) return <Loading label="Loading entries" />;

  const pick = async (e: ChallengeEntry) => {
    const note = await ask({ title: `Pick ${e.user?.name ?? 'this entry'}?`, body: 'Add a short note on why. Everyone sees it.', input: c.pick_id === e.id ? c.pick_note : '', confirm: 'Pick' });
    if (note === null) return;
    await api.pickEntry(c.id, e.id, String(note)).catch((err: Error) => toast(err.message));
    toast('Picked');
    load();
  };
  const unpick = async () => {
    await api.pickEntry(c.id, null, '').catch((err: Error) => toast(err.message));
    load();
  };
  const sorted = [...entries].sort((a, b) => (a.id === c.pick_id ? -1 : b.id === c.pick_id ? 1 : a.created_at.localeCompare(b.created_at)));

  return (
    <div className="cx-col cx-challenge">
      <A path="/students" className="cx-back">
        <Icon name="back" size={20} />
        Challenge
      </A>
      <p className="cx-ln-where">
        Challenge {c.number} · {isOpen(c) ? `ends ${endsLabel(c.ends_at)}` : 'closed'}
      </p>
      <h1 className="cx-h1">{c.title}</h1>
      {c.brief && <p className="cx-ch-quiet">{c.brief}</p>}
      <p className="cx-ch-quiet">{c.entries === 1 ? '1 entry' : `${c.entries} entries`}</p>

      {sorted.length === 0 ? (
        <Empty title="No entries yet" />
      ) : (
        <ul className="cx-ch-entries">
          {sorted.map((e) => (
            <li key={e.id} className={e.id === c.pick_id ? 'is-pick' : ''}>
              {e.user && (
                <A path={`/u/${e.user.handle}`} className="cx-ch-who">
                  <Avatar p={e.user} size={36} />
                  <span>
                    <b>{e.user.name}</b>
                    <BeltBadge p={e.user} small />
                  </span>
                </A>
              )}
              <EntryVideo url={e.url} title={`${e.user?.name ?? 'Student'}’s entry`} />
              {e.id === c.pick_id && c.pick_note && (
                <p className="cx-ch-note">
                  “{c.pick_note}” <span>Grand Sensei</span>
                </p>
              )}
              {team && (
                <div className="cx-ch-form-btns">
                  {e.id === c.pick_id ? (
                    <>
                      <button type="button" className="btn btn-light btn-sm" onClick={() => pick(e)}>
                        Edit note
                      </button>
                      <button type="button" className="btn btn-light btn-sm" onClick={unpick}>
                        Remove pick
                      </button>
                    </>
                  ) : (
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => pick(e)}>
                      Pick this
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------- Projects tab (visitors): approved final projects ----------
   Final project I is the phase 3 assignment (on the way to phase 4);
   Final project II is the phase 4 assignment (on the way to the
   certificate of mastery). */
const FINALS = [
  { phase: 3, label: 'Final project I' },
  { phase: 4, label: 'Final project II' },
];
export function ProjectsTab() {
  const { api } = useConnect();
  const [n, setN] = useState(3);
  const [list, setList] = useState<Post[] | null>(() => peek<Post[]>('listProjects', 3) ?? null);
  useEffect(() => {
    setList(peek<Post[]>('listProjects', n) ?? null);
    api
      .listProjects(n)
      .then(setList)
      .catch(() => setList([]));
  }, [api, n]);
  return (
    <div className="cx-projects">
      <div className="cx-chips" role="group" aria-label="Final project">
        {FINALS.map((f) => (
          <button key={f.phase} type="button" className={n === f.phase ? 'cx-chip is-on' : 'cx-chip'} aria-pressed={n === f.phase} onClick={() => setN(f.phase)}>
            {f.label}
          </button>
        ))}
      </div>
      {list === null ? (
        <Loading label="Loading projects" />
      ) : list.length === 0 ? (
        <Empty title="No projects here yet" />
      ) : (
        <div className="cx-feed">
          {list.map((p) => (
            <PostCard key={p.id} post={p} plain />
          ))}
        </div>
      )}
      <section className="cx-ch-card cx-ch-join">
        <h2>Make yours next</h2>
        <a className="cx-ch-cta" href={`${MAIN_SITE}/blackbelt`}>
          Join Black Belt
        </a>
      </section>
    </div>
  );
}

/** Streak and pick count for a profile (everyone can see these) */
export function ChallengeStats({ userId }: { userId: string }) {
  const { api } = useConnect();
  const [s, setS] = useState<ChallengeStat | null>(null);
  useEffect(() => {
    api
      .challengeStats()
      .then((l) => setS(l.find((x) => x.user_id === userId) ?? null))
      .catch(() => {});
  }, [api, userId]);
  if (!s || (!s.streak && !s.picks)) return null;
  return (
    <div className="cx-ch-stats">
      <span>
        <b>{s.streak}</b> {s.streak === 1 ? 'challenge' : 'challenges'} in a row
      </span>
      <span>
        <b>{s.picks}</b> picked by the Sensei
      </span>
    </div>
  );
}
