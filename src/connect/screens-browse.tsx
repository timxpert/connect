'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { isMember, useConnect } from './context';
import { openComposer, POST_DONE, POST_FAIL, POST_PROGRESS, POST_START, type PostingDetail } from './compose';
import { hasPaymentTalk, PAYMENT_NOTE } from './safety';
import { navigate } from './router';
import { play } from './sounds';
import { timeAgo } from './media';
import { profileLinks } from './links';
import { PHASES, SKILLS, type Comment, type ConnectionStatus, type Post, type Profile } from './types';
import { A, Avatar, Empty, Icon, isVideoFile, BELTS, LikeButton, Loading, Media, BeltBadge, PersonLine, PostCard, SampleTag, SaveButton, SenseiBadge, shareLink, visiblePhase, POST_DELETED } from './ui';

/* ================= Feed ================= */
type FeedName = 'community' | 'everyone' | 'connections';
const FEEDS: { key: FeedName; label: string; needsAccount?: boolean }[] = [
  { key: 'community', label: 'Community' },
  { key: 'everyone', label: 'Everyone' },
  { key: 'connections', label: 'Connections', needsAccount: true },
];

export function Feed() {
  const { api, me, signedIn } = useConnect();
  const [tab, setTab] = useState<FeedName>('community');
  const [posts, setPosts] = useState<Post[] | null>(null);

  useEffect(() => {
    let live = true;
    setPosts(null);
    api.listPosts({ feed: tab }).then((p) => live && setPosts(p)).catch(() => live && setPosts([]));
    return () => {
      live = false;
    };
  }, [api, tab]);

  const canShare = me?.is_student || me?.is_sensei;

  // A new post shows here at once, with its upload progress, then becomes a real card
  const [pending, setPending] = useState<(PostingDetail & { progress: number }) | null>(null);
  useEffect(() => {
    const start = (e: Event) => {
      const d = (e as CustomEvent<PostingDetail>).detail;
      setPending({ ...d, progress: d.kind === 'text' ? 1 : 0 });
      if (!d.community) setTab((t) => (t === 'community' ? 'everyone' : t));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    const prog = (e: Event) => setPending((p) => (p ? { ...p, progress: (e as CustomEvent<number>).detail } : p));
    const done = (e: Event) => {
      const post = (e as CustomEvent<Post>).detail;
      setPending(null);
      setPosts((list) => (list && !list.some((x) => x.id === post.id) ? [{ ...post, fresh: true } as Post, ...list] : list));
    };
    const failed = () => setPending(null);
    const gone = (e: Event) => setPosts((list) => list && list.filter((x) => x.id !== (e as CustomEvent<string>).detail));
    window.addEventListener(POST_DELETED, gone);
    window.addEventListener(POST_START, start);
    window.addEventListener(POST_PROGRESS, prog);
    window.addEventListener(POST_DONE, done);
    window.addEventListener(POST_FAIL, failed);
    return () => {
      window.removeEventListener(POST_DELETED, gone);
      window.removeEventListener(POST_START, start);
      window.removeEventListener(POST_PROGRESS, prog);
      window.removeEventListener(POST_DONE, done);
      window.removeEventListener(POST_FAIL, failed);
    };
  }, []);

  return (
    <div className="cx-col cx-stream">
      <h1 className="sr-only">Feed</h1>
      <div className="cx-tabs" role="tablist" aria-label="Feed">
        {FEEDS.filter((f) => !f.needsAccount || me).map((f) => (
          <button key={f.key} type="button" role="tab" aria-selected={tab === f.key} className={tab === f.key ? 'is-on' : ''} onClick={() => setTab(f.key)}>
            {f.label}
          </button>
        ))}
      </div>

      {canShare && me && (
        <button type="button" className="cx-composer" onClick={openComposer}>
          <Avatar p={me} size={40} />
          <span>{me.is_sensei ? 'Post something to the community…' : 'Share what you’re working on…'}</span>
        </button>
      )}
      {!signedIn && (
        <p className="cx-signin-line">
          <A path="/login">Sign in</A> to connect, comment and save projects.
        </p>
      )}

      {pending && me && (
        <article className="cx-post cx-pending" aria-live="polite">
          <header className="cx-post-head">
            <PersonLine p={me} />
            <span className="cx-tag">Posting…</span>
          </header>
          {pending.caption && <p className="cx-caption">{pending.caption}</p>}
          {pending.preview && pending.kind !== 'text' && (
            <div className="cx-media cx-pending-media">
              {pending.kind === 'image' ? (
                <img src={pending.preview} alt="" />
              ) : pending.preview.startsWith('blob:') ? (
                <video src={`${pending.preview}#t=0.1`} muted playsInline preload="metadata" />
              ) : null}
              <span className="cx-pending-progress">
                <span style={{ transform: `scaleX(${Math.max(0.04, pending.progress)})` }} />
              </span>
            </div>
          )}
        </article>
      )}

      {posts === null ? (
        <Loading label="Loading posts" />
      ) : posts.length === 0 ? (
        <Empty title="Nothing here yet">
          {tab === 'connections' ? (
            <p>
              Connect with people from <A path="/students">Members</A> and their work shows up here.
            </p>
          ) : tab === 'community' ? (
            <p>Posts from the grand sensei will appear here.</p>
          ) : (
            <p>When members share their work, it appears here.</p>
          )}
        </Empty>
      ) : (
        <div className="cx-feed">
          {posts.map((p) => (
            <PostCard key={p.id} post={p} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ================= Students directory ================= */
export function Students() {
  const { api, me } = useConnect();
  // Search and filters are for members; visitors just browse the list
  const member = isMember(me);
  const [q, setQ] = useState('');
  const [skill, setSkill] = useState('');
  const [phase, setPhase] = useState<number | null>(null);
  const [list, setList] = useState<Profile[] | null>(null);

  useEffect(() => {
    let live = true;
    const t = window.setTimeout(() => {
      api.listStudents({ q, skill, phase }).then((r) => live && setList(r)).catch(() => live && setList([]));
    }, 200);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [api, q, skill, phase]);

  return (
    <div className="cx-col">
      <div className="cx-intro">
        <h1 className="cx-h1">Members</h1>
        <p>Everyone on Black Belt in Motion Design.</p>
      </div>

      {member && (
      <div className="cx-filters">
        <label className="cx-search">
          <Icon name="search" size={20} />
          <span className="sr-only">Search members</span>
          <input type="search" placeholder="Search by name or country" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <div className="cx-chips" role="group" aria-label="Filter by skill">
          <button type="button" className={!skill ? 'cx-chip is-on' : 'cx-chip'} onClick={() => setSkill('')} aria-pressed={!skill}>
            All skills
          </button>
          {SKILLS.map((s) => (
            <button key={s} type="button" className={skill === s ? 'cx-chip is-on' : 'cx-chip'} onClick={() => setSkill(skill === s ? '' : s)} aria-pressed={skill === s}>
              {s}
            </button>
          ))}
        </div>
        <label className="cx-select">
          <span>Phase</span>
          <select value={phase ?? ''} onChange={(e) => setPhase(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Any phase</option>
            {PHASES.map((t, i) => (
              <option key={t} value={i + 1}>
                {BELTS[i]} · {t}
              </option>
            ))}
          </select>
        </label>
      </div>
      )}

      {list === null ? (
        <Loading label="Loading members" />
      ) : list.length === 0 ? (
        <Empty title={member ? 'No one matches' : 'No members yet'}>
          {member && <p>Try another name, skill or phase.</p>}
        </Empty>
      ) : (
        <ul className="cx-people">
          {list.map((p) => (
            <li key={p.id}>
              <A path={`/u/${p.handle}`} className="cx-person-row">
                <Avatar p={p} size={56} />
                <span className="cx-person-row-text">
                  <span className="cx-person-name">
                    {p.name}
                    <BeltBadge p={p} />
                    {p.sample && <SampleTag />}
                  </span>
                  <span className="cx-person-meta">
                    @{p.handle}
                    {p.country && <> · {p.country}</>}
                    {visiblePhase(p, me) && <> · Phase {visiblePhase(p, me)}: {PHASES[visiblePhase(p, me)! - 1]}</>}
                  </span>
                  {p.skills.length > 0 && <span className="cx-person-skills">{p.skills.slice(0, 4).join(' · ')}</span>}
                </span>
              </A>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ================= Profile ================= */
export function ProfileScreen({ handle }: { handle: string }) {
  const { api, me, signedIn, toast, ask } = useConnect();
  const [p, setP] = useState<Profile | null | undefined>(undefined);
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [counts, setCounts] = useState({ connections: 0, posts: 0 });
  const [status, setStatus] = useState<ConnectionStatus>('none');
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    let live = true;
    setP(undefined);
    api.getProfile(handle).then(async (prof) => {
      if (!live) return;
      setP(prof);
      if (!prof) return;
      const [ps, c, st, b] = await Promise.all([api.listPosts({ authorId: prof.id }), api.counts(prof.id), api.connectionStatus(prof.id), api.isBlocked(prof.id)]);
      if (!live) return;
      setPosts(ps);
      setCounts(c);
      setStatus(st);
      setBlocked(b);
    });
    return () => {
      live = false;
    };
  }, [api, handle]);

  // Posting from your own profile adds the post here straight away
  useEffect(() => {
    const done = (e: Event) => {
      const post = (e as CustomEvent<Post>).detail;
      if (!p || post.author_id !== p.id) return;
      setPosts((list) => (list && !list.some((x) => x.id === post.id) ? [post, ...list] : list));
      setCounts((c) => ({ ...c, posts: c.posts + 1 }));
    };
    const gone = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      setPosts((list) => {
        if (!list || !list.some((x) => x.id === id)) return list;
        setCounts((c) => ({ ...c, posts: Math.max(0, c.posts - 1) }));
        return list.filter((x) => x.id !== id);
      });
    };
    window.addEventListener(POST_DONE, done);
    window.addEventListener(POST_DELETED, gone);
    return () => {
      window.removeEventListener(POST_DONE, done);
      window.removeEventListener(POST_DELETED, gone);
    };
  }, [p]);

  if (p === undefined) return <Loading label="Loading profile" />;
  if (p === null)
    return (
      <Empty title="We couldn’t find that member">
        <p>
          <A path="/students">Browse all students</A>
        </p>
      </Empty>
    );

  const mine = me?.id === p.id;
  const links = profileLinks(p);

  const act = async (fn: () => Promise<void>, next: ConnectionStatus, msg: string) => {
    if (!signedIn) return navigate('/login');
    if (!me) return navigate('/settings');
    setBusy(true);
    try {
      await fn();
      setStatus(next);
      if (next === 'connected' || status === 'connected') setCounts((c) => ({ ...c, connections: c.connections + (next === 'connected' ? 1 : -1) }));
      toast(msg);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const connect = () => act(() => api.requestConnection(p.id), 'requested', `Request sent to ${p.name}.`);
  const cancel = () => act(() => api.removeConnection(p.id), 'none', 'Request cancelled.');
  const accept = () => act(() => api.answerRequest(p.id, true), 'connected', `You’re connected with ${p.name}.`);
  const decline = () => act(() => api.answerRequest(p.id, false), 'none', 'Request declined.');
  const disconnect = async () => {
    setMenu(false);
    const ok = await ask({ title: `Remove ${p.name} from your connections?`, body: 'You won’t be able to message each other until one of you connects again.', confirm: 'Remove', danger: true });
    if (ok) act(() => api.removeConnection(p.id), 'none', 'Connection removed.');
  };
  const message = async () => {
    if (!signedIn) return navigate('/login');
    if (!me) return navigate('/settings');
    try {
      navigate(`/messages/${await api.openConversation(p.id)}`);
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const report = async () => {
    setMenu(false);
    if (!signedIn) return navigate('/login');
    const reason = await ask({ title: 'Report this profile', body: 'A moderator will look at it. The member won’t see who reported them.', input: 'What’s wrong?', confirm: 'Send report' });
    if (reason === null) return;
    await api.report('profile', p.id, reason);
    toast('Thanks. A moderator will take a look.');
  };
  const block = async () => {
    setMenu(false);
    if (!signedIn) return navigate('/login');
    await api.setBlock(p.id, !blocked);
    setBlocked(!blocked);
    if (!blocked) setStatus('none');
    toast(blocked ? `Unblocked ${p.name}.` : `Blocked ${p.name}. They can’t message you.`);
  };

  const skillsLine = p.skills.join(' · ');

  return (
    <div className={p.is_sensei ? 'cx-pf is-sensei' : 'cx-pf'}>
      <div className="cx-pf-cover" aria-hidden="true">
        {p.cover_url ? <img src={p.cover_url} alt="" /> : p.is_sensei ? <SenseiCover /> : <DefaultCover seed={p.handle} />}
      </div>

      <div className="cx-pf-inner">
        <div className="cx-pf-top">
          <span className="cx-pf-avatar">
            <Avatar p={p} size={136} />
          </span>
          <div className="cx-pf-actions">
            <button
              type="button"
              className="cx-icon-btn"
              aria-label="Share profile"
              onClick={() => shareLink(`/u/${p.handle}`, `${p.name} on Motion Dojo Connect`, toast)}
            >
              <Icon name="share" />
            </button>
            {mine ? (
              <A path="/settings" className="btn btn-light btn-sm">
                Edit profile
              </A>
            ) : isMember(me) ? (
              <>
                {!blocked && status === 'none' && (
                  <button type="button" className="btn btn-primary btn-sm" onClick={connect} disabled={busy}>
                    <Icon name="link2" size={18} /> Connect
                  </button>
                )}
                {status === 'requested' && (
                  <button type="button" className="btn btn-light btn-sm" onClick={cancel} disabled={busy} title="Cancel request">
                    Requested
                  </button>
                )}
                {status === 'incoming' && (
                  <>
                    <button type="button" className="btn btn-primary btn-sm" onClick={accept} disabled={busy}>
                      Accept
                    </button>
                    <button type="button" className="btn btn-light btn-sm" onClick={decline} disabled={busy}>
                      Decline
                    </button>
                  </>
                )}
                {status === 'connected' && (
                  <button type="button" className="btn btn-primary btn-sm" onClick={message}>
                    Message
                  </button>
                )}
                <div className="cx-menu">
                  <button type="button" className="cx-icon-btn" aria-label="More options" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
                    <Icon name="more" />
                  </button>
                  {menu && (
                    <div className="cx-menu-list" role="menu">
                      {status === 'connected' && (
                        <button type="button" role="menuitem" onClick={disconnect}>
                          Remove connection
                        </button>
                      )}
                      <button type="button" role="menuitem" onClick={report}>
                        Report profile
                      </button>
                      <button type="button" role="menuitem" onClick={block}>
                        {blocked ? 'Unblock' : 'Block'}
                      </button>
                    </div>
                  )}
                </div>
              </>
            ) : null}
          </div>
        </div>

        <div className="cx-pf-info">
          <h1 className="cx-pf-name">
            {p.name}
            {p.is_sensei ? <SenseiBadge /> : p.is_student && <BeltBadge p={p} />}
            {p.sample && <SampleTag />}
          </h1>
          <p className="cx-pf-handle">
            @{p.handle}
            {status === 'connected' && <span className="cx-pf-connected"> · Connected</span>}
          </p>
          {p.bio && <p className="cx-bio">{p.bio}</p>}

          <ul className="cx-pf-meta">
            {p.is_sensei ? null : p.is_student ? (
              visiblePhase(p, me) ? <li>Phase {visiblePhase(p, me)}: {PHASES[visiblePhase(p, me)! - 1]}</li> : null
            ) : (
              <li>Community member</li>
            )}
            {p.country && <li>{p.country}</li>}
          </ul>
          {links.length > 0 && (
            <ul className="cx-pf-links" aria-label="Links">
              {links.map((l) => (
                <li key={l.href}>
                  <a href={l.href} target="_blank" rel="noopener noreferrer me" title={`${l.platform}: ${l.href}`}>
                    <Icon name={l.kind === 'website' ? 'link' : l.kind} size={16} />
                    <span>{l.label}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
          {skillsLine && <p className="cx-pf-skills">{skillsLine}</p>}

          <p className="cx-pf-stats">
            <span>
              <strong>{counts.posts}</strong> {counts.posts === 1 ? 'post' : 'posts'}
            </span>
            <span>
              <strong>{counts.connections}</strong> {counts.connections === 1 ? 'connection' : 'connections'}
            </span>
          </p>
        </div>

        <div className="cx-pf-tabs" role="tablist" aria-label="Profile">
          <span role="tab" aria-selected="true" className="is-on">
            Work
          </span>
        </div>

        {posts === null ? (
          <Loading />
        ) : posts.length === 0 ? (
          <p className="cx-pf-empty">
            {p.is_student || p.is_sensei
              ? mine
                ? 'You haven’t posted anything yet.'
                : 'Nothing posted yet.'
              : 'Only members post work.'}{' '}
            {mine && (p.is_student || p.is_sensei) && (
              <button type="button" className="cx-link-btn" onClick={openComposer}>
                {p.is_sensei ? 'Write your first post' : 'Share your first piece'}
              </button>
            )}
          </p>
        ) : (
          <ul className="cx-thumbs">
            {posts.map((x) => (
              <li key={x.id}>
                <A path={`/p/${x.id}`} className="cx-thumb" aria-label={x.caption || 'Open post'}>
                  {x.kind === 'image' && x.media_url ? (
                    <img src={x.media_url} alt="" loading="lazy" />
                  ) : x.kind === 'text' ? (
                    <span className="cx-thumb-text">{x.caption}</span>
                  ) : x.media_url && isVideoFile(x.media_url) ? (
                    <video className="cx-thumb-vid" src={`${x.media_url}#t=0.1`} muted playsInline preload="metadata" />
                  ) : (
                    <span className="cx-thumb-video">
                      <Icon name="video" size={30} />
                    </span>
                  )}
                  <span className="cx-thumb-stats">
                    <Icon name="heart" size={16} filled /> {x.likes}
                    <Icon name="comment" size={16} /> {x.comments}
                  </span>
                </A>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Cover for members without their own: a motion curve with keyframes, varied by handle */
/** The Grand Sensei's cover: a lit keyframe curve on deep night, with soft brand glows */
function SenseiCover() {
  return (
    <svg viewBox="0 0 1200 300" preserveAspectRatio="xMidYMid slice">
      <defs>
        <radialGradient id="sg1" cx="18%" cy="10%" r="70%">
          <stop offset="0" stopColor="#6d32e8" stopOpacity="0.4" />
          <stop offset="1" stopColor="#6d32e8" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="sg2" cx="88%" cy="95%" r="55%">
          <stop offset="0" stopColor="#c8ff3d" stopOpacity="0.1" />
          <stop offset="1" stopColor="#c8ff3d" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="sline" x1="0" x2="1">
          <stop offset="0" stopColor="#6d32e8" />
          <stop offset="0.55" stopColor="#a77bff" />
          <stop offset="1" stopColor="#c8ff3d" />
        </linearGradient>
        <pattern id="sdots" width="24" height="24" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1" fill="#fff" opacity="0.07" />
        </pattern>
      </defs>
      <rect width="1200" height="300" fill="#07030f" />
      <rect width="1200" height="300" fill="url(#sg1)" />
      <rect width="1200" height="300" fill="url(#sg2)" />
      <rect width="1200" height="300" fill="url(#sdots)" />
      <path className="cx-sensei-curve" d="M-20 250 C 240 255, 380 60, 620 110 S 990 250, 1220 40" fill="none" stroke="url(#sline)" strokeWidth="3" strokeLinecap="round" />
      <g fill="#c8ff3d">
        <rect x="610" y="100" width="20" height="20" rx="4" transform="rotate(45 620 110)" />
        <rect x="1003" y="179" width="14" height="14" rx="3" transform="rotate(45 1010 186)" opacity="0.8" />
      </g>
    </svg>
  );
}

function DefaultCover({ seed }: { seed: string }) {
  const n = [...seed].reduce((a, c) => a + c.charCodeAt(0), 0);
  const bend = 20 + (n % 60);
  return (
    <svg viewBox="0 0 1200 300" preserveAspectRatio="xMidYMid slice">
      <rect width="1200" height="300" fill="#140a2e" />
      <path d={`M-20 ${240 - bend} C 260 ${250 - bend}, 360 ${40 + bend}, 600 ${90 + bend / 2} S 980 ${260 - bend}, 1220 ${60 + bend / 2}`} fill="none" stroke="#6d32e8" strokeWidth="6" />
      <g fill="#c8ff3d">
        <rect x="590" y={80 + bend / 2} width="20" height="20" rx="4" transform={`rotate(45 600 ${90 + bend / 2})`} />
      </g>
    </svg>
  );
}

/* ================= Single post with comments ================= */
export function PostScreen({ id }: { id: string }) {
  const { api, me, signedIn, toast, ask } = useConnect();
  const [post, setPost] = useState<Post | null | undefined>(undefined);
  const [comments, setComments] = useState<Comment[]>([]);
  const [fresh, setFresh] = useState('');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [p, c] = await Promise.all([api.getPost(id), api.listComments(id)]);
    setPost(p);
    setComments(c);
  }, [api, id]);
  useEffect(() => {
    load();
  }, [load]);

  if (post === undefined) return <Loading label="Loading post" />;
  if (post === null)
    return (
      <Empty title="This post isn’t here anymore">
        <p>
          <A path="/">Back to the feed</A>
        </p>
      </Empty>
    );

  const canModerate = me && (me.id === post.author_id || me.is_moderator);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body || !me) return;
    // Show the comment straight away; swap in the saved one when it comes back
    const tmp: Comment = { id: `tmp-${Date.now()}`, post_id: post.id, author_id: me.id, body, created_at: new Date().toISOString(), author: me };
    setComments((cs) => [...cs, tmp]);
    setFresh(tmp.id);
    setDraft('');
    play('comment');
    try {
      const c = await api.addComment(post.id, body);
      setComments((cs) => cs.map((x) => (x.id === tmp.id ? c : x)));
      setFresh(c.id);
    } catch (err) {
      setComments((cs) => cs.filter((x) => x.id !== tmp.id));
      setDraft(body);
      toast((err as Error).message);
    }
  };
  const removePost = async () => {
    if (!(await ask({ title: 'Delete this post?', body: 'Its likes and comments go too. This can’t be undone.', confirm: 'Delete', danger: true }))) return;
    await api.deletePost(post.id);
    toast('Post deleted.');
    navigate(me ? `/u/${me.handle}` : '/');
  };
  const removeComment = async (c: Comment) => {
    await api.deleteComment(c.id);
    setComments((cs) => cs.filter((x) => x.id !== c.id));
  };
  const reportPost = async () => {
    if (!signedIn) return navigate('/login');
    const reason = await ask({ title: 'Report this post', body: 'A moderator will look at it. The member won’t see who reported them.', input: 'What’s wrong?', confirm: 'Send report' });
    if (reason === null) return;
    await api.report('post', post.id, reason);
    toast('Thanks. A moderator will take a look.');
  };

  const canDeleteComment = (c: Comment) => Boolean(me && (me.id === c.author_id || me.id === post.author_id || me.is_moderator));

  return (
    <div className="cx-col cx-stream">
      <header className="cx-bar">
        <button type="button" className="cx-icon-btn cx-icon-flat" onClick={() => window.history.back()} aria-label="Back">
          <Icon name="back" />
        </button>
        <h1>Post</h1>
      </header>

      <article className={post.community ? 'cx-post cx-post-community' : 'cx-post'}>
        <header className="cx-post-head">
          <PersonLine p={post.author} when={post.created_at} />
          {post.community ? <span className="cx-tag">Community</span> : post.tag === 'feedback' && <span className="cx-tag">Wants feedback</span>}
        </header>
        {post.caption && <p className="cx-caption">{post.caption}</p>}
        <Media post={post} priority />
        <footer className="cx-post-actions">
          <LikeButton post={post} />
          <label htmlFor="comment-box" className="cx-act" aria-label={`${comments.length} comments`}>
            <Icon name="comment" />
            <span>{comments.length}</span>
          </label>
          <span className="cx-spacer" />
          <SaveButton post={post} />
          {canModerate ? (
            <button type="button" className="cx-text-btn" onClick={removePost}>
              Delete
            </button>
          ) : (
            <button type="button" className="cx-text-btn" onClick={reportPost}>
              Report
            </button>
          )}
        </footer>
      </article>

      {me && isMember(me) ? (
        <form className="cx-reply" onSubmit={submit}>
          <Avatar p={me} size={36} />
          <label className="sr-only" htmlFor="comment-box">
            Write a comment
          </label>
          <textarea
            id="comment-box"
            rows={1}
            maxLength={1000}
            placeholder={post.tag === 'feedback' ? 'What would you change?' : 'Add a comment'}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                (e.currentTarget.form as HTMLFormElement).requestSubmit();
              }
            }}
          />
          <button type="submit" className="cx-reply-send" disabled={busy || !draft.trim() || hasPaymentTalk(draft)}>
            Post
          </button>
        </form>
      ) : (
        <p className="cx-signin-line">
          {signedIn && !me ? (
            <>
              <A path="/settings">Finish your profile</A> to comment.
            </>
          ) : (
            'Only members can comment.'
          )}
        </p>
      )}
      {hasPaymentTalk(draft) && (
        <p className="cx-safety" role="alert">
          {PAYMENT_NOTE}
        </p>
      )}

      <section aria-label={post.tag === 'feedback' ? 'Feedback' : 'Comments'}>
        {comments.length === 0 ? (
          <p className="cx-thread-empty">{post.tag === 'feedback' ? 'No feedback yet.' : 'No comments yet.'}</p>
        ) : (
          <ul className="cx-thread">
            {comments.map((c) => (
              <li key={c.id} className={['cx-comment', c.id === fresh ? 'is-fresh' : '', c.id.startsWith('tmp-') ? 'is-sending' : ''].filter(Boolean).join(' ')}>
                <A path={`/u/${c.author.handle}`} tabIndex={-1} aria-hidden="true">
                  <Avatar p={c.author} size={36} />
                </A>
                <div className="cx-comment-main">
                  <p className="cx-comment-body">
                    <A path={`/u/${c.author.handle}`} className="cx-comment-name">
                      {c.author.name}
                    </A>
                    {c.author.is_sensei && <SenseiBadge />}
                    {c.author.is_student && !c.author.is_sensei && <BeltBadge p={c.author} small />} {c.body}
                  </p>
                  <p className="cx-comment-meta">
                    <time dateTime={c.created_at}>{timeAgo(c.created_at)}</time>
                    {canDeleteComment(c) && (
                      <button type="button" onClick={() => removeComment(c)}>
                        Delete
                      </button>
                    )}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
