'use client';

import React, { useEffect, useState } from 'react';
import { useConnect } from './context';
import { navigate } from './router';
import { timeAgo } from './media';
import type { Notice, Post, Profile } from './types';
import { peek } from './cache';
import { A, Avatar, Empty, Icon, Loading, BeltBadge, PostCard, SampleTag, SenseiBadge, TeamRole } from './ui';

function Gate({ profile = false }: { profile?: boolean }) {
  return (
    <Empty title={profile ? 'Finish your profile first' : 'Sign in first'}>
      <A path={profile ? '/settings' : '/login'} className="btn btn-primary btn-sm">
        {profile ? 'Set up profile' : 'Sign in'}
      </A>
    </Empty>
  );
}

function Who({ p }: { p: Profile }) {
  return (
    <A path={`/u/${p.handle}`} className="cx-person">
      <Avatar p={p} size={48} />
      <span className="cx-person-text">
        <span className="cx-person-name">
          <span className="cx-name-text">{p.name}</span>
          {p.is_sensei && <SenseiBadge />}
          {p.is_student && !p.is_sensei && <BeltBadge p={p} small />}
          {p.sample && <SampleTag />}
        </span>
        <span className="cx-person-meta">
          @{p.handle}
          {p.team_role && (
            <>
              {' · '}
              <TeamRole role={p.team_role} />
            </>
          )}
        </span>
      </span>
    </A>
  );
}

/* ================= Connections and requests ================= */
export function Connections() {
  const { api, me, signedIn, toast, ask } = useConnect();
  const [data, setData] = useState<{ incoming: Profile[]; sent: Profile[]; people: Profile[] } | null>(() => {
    const people = peek<Profile[]>('listConnections');
    const r = peek<{ incoming: Profile[]; sent: Profile[] }>('listRequests');
    return people && r ? { ...r, people } : null;
  });
  const [q, setQ] = useState('');
  const [menu, setMenu] = useState('');

  const load = async () => {
    const [r, people] = await Promise.all([api.listRequests(), api.listConnections()]);
    setData({ ...r, people });
  };
  useEffect(() => {
    if (me) load().catch(() => setData({ incoming: [], sent: [], people: [] }));
  }, [api, me]);

  if (!signedIn) return <Gate />;
  if (me === undefined) return <Loading />;
  if (!me) return <Gate profile />;
  if (!data) return <Loading label="Loading connections" />;

  /** Answered requests leave the list at once; the server catches up behind */
  const answer = async (p: Profile, accept: boolean) => {
    setData((d) => d && { ...d, incoming: d.incoming.filter((x) => x.id !== p.id), people: accept ? [p, ...d.people] : d.people });
    try {
      await api.answerRequest(p.id, accept);
      toast(accept ? `Connected with ${p.name}` : 'Request declined');
      window.dispatchEvent(new Event('cx:counts'));
    } catch (e) {
      toast((e as Error).message);
      load().catch(() => {});
    }
  };
  const cancel = async (p: Profile) => {
    setData((d) => d && { ...d, sent: d.sent.filter((x) => x.id !== p.id) });
    try {
      await api.removeConnection(p.id);
      toast('Request cancelled');
    } catch (e) {
      toast((e as Error).message);
      load().catch(() => {});
    }
  };
  const message = async (p: Profile) => {
    try {
      navigate(`/messages/${await api.openConversation(p.id)}`);
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const remove = async (p: Profile) => {
    setMenu('');
    const ok = await ask({ title: `Remove ${p.name}?`, body: 'You won’t be able to message each other until one of you connects again.', confirm: 'Remove', danger: true });
    if (!ok) return;
    setData((d) => d && { ...d, people: d.people.filter((x) => x.id !== p.id) });
    try {
      await api.removeConnection(p.id);
      toast('Connection removed');
    } catch (e) {
      toast((e as Error).message);
      load().catch(() => {});
    }
  };

  const term = q.trim().toLowerCase();
  const people = data.people.filter((p) => !term || p.name.toLowerCase().includes(term) || p.handle.toLowerCase().includes(term));

  return (
    <div className="cx-col cx-conn-page">
      <h1 className="cx-inbox-title">
        Connections {data.people.length > 0 && <span className="cx-conn-total">{data.people.length}</span>}
      </h1>

      {data.incoming.length > 0 && (
        <section aria-labelledby="req-title">
          <h2 className="cx-conn-label" id="req-title">
            Requests <span className="cx-inbox-count">{data.incoming.length}</span>
          </h2>
          <ul className="cx-requests">
            {data.incoming.map((p) => (
              <li key={p.id} className="cx-request">
                <Who p={p} />
                <div className="cx-request-actions">
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => answer(p, true)}>
                    Accept
                  </button>
                  <button type="button" className="btn btn-light btn-sm" onClick={() => answer(p, false)}>
                    Decline
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.people.length > 3 && (
        <label className="cx-search cx-inbox-search">
          <Icon name="search" size={20} />
          <span className="sr-only">Search connections</span>
          <input type="search" placeholder="Search connections" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      )}

      {data.people.length === 0 ? (
        <div className="cx-inbox-empty">
          <span className="cx-inbox-empty-ico" aria-hidden="true">
            <Icon name="link2" size={30} />
          </span>
          <p className="cx-inbox-empty-title">No connections yet</p>
          <p>Tap Connect on someone’s profile. Once they accept, you can message each other.</p>
          <A path="/students" className="btn btn-primary btn-sm">
            Find members
          </A>
        </div>
      ) : (
        <ul className="cx-conn-list">
          {people.map((p) => (
            <li key={p.id} className="cx-conn-row">
              <Who p={p} />
              <button type="button" className="cx-icon-btn cx-conn-msg" aria-label={`Message ${p.name}`} onClick={() => message(p)}>
                <Icon name="chat" size={20} />
              </button>
              <div className="cx-menu">
                <button type="button" className="cx-icon-btn cx-icon-flat" aria-label={`Options for ${p.name}`} aria-expanded={menu === p.id} onClick={() => setMenu(menu === p.id ? '' : p.id)}>
                  <Icon name="more" />
                </button>
                {menu === p.id && (
                  <>
                    <div className="cx-menu-scrim" onClick={() => setMenu('')} aria-hidden="true" />
                    <div className="cx-menu-list" role="menu">
                      <button type="button" role="menuitem" onClick={() => navigate(`/u/${p.handle}`)}>
                        View profile
                      </button>
                      <button type="button" role="menuitem" className="cx-danger" onClick={() => remove(p)}>
                        Remove connection
                      </button>
                    </div>
                  </>
                )}
              </div>
            </li>
          ))}
          {people.length === 0 && <li className="cx-inbox-none">No connections match “{q}”.</li>}
        </ul>
      )}

      {data.sent.length > 0 && (
        <section aria-labelledby="sent-title">
          <h2 className="cx-conn-label" id="sent-title">
            Waiting for them
          </h2>
          <ul className="cx-conn-list">
            {data.sent.map((p) => (
              <li key={p.id} className="cx-conn-row">
                <Who p={p} />
                <button type="button" className="btn btn-light btn-sm" onClick={() => cancel(p)}>
                  Cancel
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/* ================= Notifications ================= */
export function Notifications() {
  const { api, me, signedIn } = useConnect();
  const [list, setList] = useState<Notice[] | null>(() => peek<Notice[]>('listNotices') ?? null);

  useEffect(() => {
    if (!me) return;
    api
      .listNotices()
      .then(async (n) => {
        setList(n);
        await api.markNoticesRead();
        window.dispatchEvent(new Event('cx:counts'));
      })
      .catch(() => setList([]));
  }, [api, me]);

  if (!signedIn) return <Gate />;
  if (me === undefined) return <Loading />;
  if (!me) return <Gate profile />;
  if (!list) return <Loading label="Loading notifications" />;

  const line = (n: Notice) => {
    const name = n.actor?.name ?? 'Someone';
    if (n.kind === 'community_post') return { text: `${name} posted to the Community feed.`, path: n.post_id ? `/p/${n.post_id}` : '/' };
    if (n.kind === 'connection_request') return { text: `${name} wants to connect with you.`, path: '/connections' };
    if (n.kind === 'assignment_submitted') return { text: `${name} handed in an assignment.`, path: '/reviews' };
    if (n.kind === 'post_like') return { text: `${name} liked your post.`, path: n.post_id ? `/p/${n.post_id}` : '/' };
    if (n.kind === 'post_comment') return { text: `${name} commented: ${n.snippet ?? ''}`, path: n.post_id ? `/p/${n.post_id}` : '/' };
    if (n.kind === 'challenge_new') return { text: `New challenge: ${n.snippet ?? ''}. Hand in your entry.`, path: '/students' };
    if (n.kind === 'challenge_pick') return { text: `The Grand Sensei picked your entry for ${n.snippet ?? 'the challenge'}.`, path: '/students' };
    if (n.kind === 'phase_request') return { text: `${name} chose ${n.snippet?.toLowerCase() ?? 'a phase'}.`, path: '/reviews' };
    if (n.kind === 'phase_approved') return { text: `${n.snippet ?? 'Your phase'} confirmed. Lessons are open.`, path: '/learn' };
    if (n.kind === 'phase_declined') return { text: 'Phase not confirmed. Choose again.', path: '/learn' };
    if (n.kind === 'assignment_approved') return { text: 'Your assignment was approved. The next phase is open.', path: '/learn' };
    if (n.kind === 'assignment_changes') return { text: `${name} asked for changes on your assignment.`, path: '/learn' };
    if (n.kind === 'group_reply') return { text: `${name} replied to you in the group${n.snippet ? `: “${n.snippet.replace(/^[^:]*:\s*/, '').slice(0, 100)}”` : '.'}`, path: '/messages/group' };
    if (n.kind === 'group_mention') return { text: `${name} mentioned you in the group${n.snippet ? `: “${n.snippet.replace(/^[^:]*:\s*/, '').slice(0, 100)}”` : '.'}`, path: '/messages/group' };
    return { text: `${name} accepted your connection request.`, path: n.actor ? `/u/${n.actor.handle}` : '/connections' };
  };

  return (
    <div className="cx-col">
      <h1 className="cx-h1">Notifications</h1>
      {list.length === 0 ? (
        <Empty title="You’re all caught up" />
      ) : (
        <ul className="cx-list cx-notices">
          {list.map((n) => {
            const l = line(n);
            return (
              <li key={n.id}>
                <A path={l.path} className={n.read_at ? 'cx-notice' : 'cx-notice is-new'}>
                  {n.actor ? <Avatar p={n.actor} size={44} /> : <Icon name="bell" />}
                  <span className="cx-notice-text">
                    {l.text}
                    <time dateTime={n.created_at}>{timeAgo(n.created_at)}</time>
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

/* ================= Saved projects ================= */
export function Saved() {
  const { api, me, signedIn } = useConnect();
  const [posts, setPosts] = useState<Post[] | null>(() => peek<Post[]>('listSaved') ?? null);
  useEffect(() => {
    if (me) api.listSaved().then(setPosts).catch(() => setPosts([]));
  }, [api, me]);

  if (!signedIn) return <Gate />;
  if (me === undefined) return <Loading />;
  if (!me) return <Gate profile />;
  if (!posts) return <Loading label="Loading saved projects" />;

  return (
    <div className="cx-col">
      <div className="cx-intro">
        <h1 className="cx-h1">Saved</h1>
        <p>Projects you bookmarked. Only you can see this list.</p>
      </div>
      {posts.length === 0 ? (
        <Empty title="Nothing saved yet">
          <p>Tap the bookmark on any project to keep it here.</p>
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
