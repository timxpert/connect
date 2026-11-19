'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ConnectProvider, isMember, useConnect } from './context';
import { Composer, openComposer } from './compose';
import { onVisitorChange, visitorChosen } from './visitor';
import { play, setSoundOn, soundOn } from './sounds';
import { alertsAllowed, notify, registerAlerts } from './alerts';
import { startPresence } from './presence';
import { guardDevice } from './device';
import { CHAT_COLORS, useAppearance } from './appearance';
import { Appearance as AppearanceScreen } from './screens-appearance';
import { createDemoApi } from './demo-api';
import { withCache } from './cache';
import { navigate, to, useRoute, type Route } from './router';
import type { ConnectApi } from './types';
import { A, Avatar, Icon, Loading } from './ui';
import { Feed, PostScreen, ProfileScreen, Students } from './screens-browse';
import { Login, Settings, Welcome } from './screens-me';
import { Chat, Inbox } from './chat';
import { GroupChat, GroupInfoScreen, JoinGroupScreen } from './group';
import { PhasePrompt } from './phase-prompt';
import { InstallPrompt } from './install';
import { useTypingRoom } from './typing';
import { ChallengeScreen } from './challenge';
import { Connections, Notifications, Saved } from './screens-social';
import { AssignmentScreen, Devices, Learn, LessonEditor, LessonScreen, Reviews } from './screens-learn';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const MAIN_SITE = process.env.NEXT_PUBLIC_MAIN_SITE_URL || 'https://joinmotiondojo.com';

/** Live when Supabase keys are set, otherwise the labelled sample preview */
function useApi(): ConnectApi | null {
  const [api, setApi] = useState<ConnectApi | null>(null);
  useEffect(() => {
    // keeps photos and profile pictures on the phone after the first load (public/sw.js)
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    if (SUPABASE_URL && SUPABASE_ANON_KEY) {
      import('./live-api').then(({ createLiveApi }) => setApi(withCache(createLiveApi(SUPABASE_URL, SUPABASE_ANON_KEY, window.location.origin + window.location.pathname.replace(/\/login$/, '')))));
    } else {
      setApi(withCache(createDemoApi()));
    }
  }, []);
  return api;
}

export function ConnectApp() {
  const api = useApi();
  const route = useRoute();
  if (!api || !route) {
    return (
      <div className="cx">
        <Loading />
      </div>
    );
  }
  return (
    <ConnectProvider api={api}>
      <Shell route={route} />
    </ConnectProvider>
  );
}

/** If a screen breaks, say so on that screen (with the reason) instead of failing silently */
class ScreenGuard extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error('[connect] screen error', error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="cx-empty">
        <p className="cx-empty-title">This screen didn’t open</p>
        <p className="cx-error-detail">{this.state.error.message}</p>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}

const TABS = [
  { path: '/', label: 'Feed', icon: 'home' as const, match: ['feed', 'post'] },
  { path: '/learn', label: 'Learn', icon: 'learn' as const, match: ['learn', 'lesson', 'lesson-edit', 'assignment'] },
  { path: '/students', label: 'Members', icon: 'people' as const, match: ['students', 'profile', 'challenge'] },
  // On phones Connections lives in the account menu, to keep the bottom bar to five
  { path: '/connections', label: 'Connections', icon: 'link2' as const, match: ['connections'], desktopOnly: true },
  { path: '/messages', label: 'Messages', icon: 'chat' as const, match: ['messages', 'chat', 'group', 'group-info'] },
];

/** Unread notifications and waiting connection requests, refreshed every 30 seconds */
type IncomingMessage = { conversation_id: string; sender_id: string; body?: string; kind?: string };

function useCounts(onMessage: (m: IncomingMessage) => void, onGroup: (n: { kind: string; snippet?: string }) => void) {
  const { api, me } = useConnect();
  const [c, setC] = useState({ unread: 0, requests: 0, messages: 0 });
  const onMessageRef = React.useRef(onMessage);
  onMessageRef.current = onMessage;
  const onGroupRef = React.useRef(onGroup);
  onGroupRef.current = onGroup;
  useEffect(() => {
    if (!me) {
      setC({ unread: 0, requests: 0, messages: 0 });
      return;
    }
    let live = true;
    const load = async () => {
      // Tell senders their messages reached this device (grey double tick)
      api.markDelivered().catch(() => {});
      const [unread, r, messages] = await Promise.all([api.unreadCount(), api.listRequests(), api.unreadMessageCount().catch(() => 0)]);
      if (live) setC({ unread, requests: r.incoming.length, messages });
    };
    load().catch(() => {});
    const t = window.setInterval(() => document.visibilityState === 'visible' && load().catch(() => {}), 30000);
    const on = () => load().catch(() => {});
    window.addEventListener('cx:counts', on);
    // Live: the bell, the Messages count and alerts update the moment something happens
    const stopNotices = api.subscribe('notifications', `user_id=eq.${me.id}`, ({ event, row }) => {
      on();
      // Someone replied to you or mentioned you in the Dojo group
      if (event === 'INSERT' && (row.kind === 'group_reply' || row.kind === 'group_mention')) onGroupRef.current(row as unknown as { kind: string; snippet?: string });
    });
    let pending = 0;
    const stopMessages = api.subscribe('messages', '', ({ event, row }) => {
      window.clearTimeout(pending);
      pending = window.setTimeout(on, 250);
      if (event === 'INSERT' && row.sender_id && row.sender_id !== me.id) onMessageRef.current(row as unknown as IncomingMessage);
    });
    // The Dojo group only updates the Messages count (no sound for every message)
    const stopGroup = api.subscribe('group_messages', '', () => {
      window.clearTimeout(pending);
      pending = window.setTimeout(on, 250);
    });
    return () => {
      live = false;
      window.clearInterval(t);
      window.clearTimeout(pending);
      window.removeEventListener('cx:counts', on);
      stopNotices();
      stopMessages();
      stopGroup();
    };
  }, [api, me?.id]);
  return c;
}

const Dot = ({ n }: { n: number }) => (n > 0 ? <span className="cx-dot">{n > 9 ? '9+' : n}</span> : null);

function Shell({ route }: { route: Route }) {
  const { api, me, signedIn, toast } = useConnect();
  const [menu, setMenu] = useState(false);
  const [sound, setSound] = useState(true);
  useEffect(() => setSound(soundOn()), []);
  // Dark theme, chat colour and wallpaper (saved on this device)
  const look = useAppearance();
  useEffect(() => {
    document.documentElement.dataset.cxTheme = look.dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', look.dark ? '#16131c' : '#ffffff');
  }, [look.dark]);
  const bubble = CHAT_COLORS[look.chat] ?? CHAT_COLORS.violet;
  const lookStyle = {
    '--mine-bg': bubble.bg,
    '--mine-ink': bubble.ink,
    '--mine-meta': bubble.meta,
    '--mine-seen': bubble.seen,
    ...(look.wall === 'photo' && look.photo ? { '--wall-photo': `url("${look.photo}")` } : {}),
  } as React.CSSProperties;
  // One device at a time: another device signing in signs this one out
  useEffect(() => {
    if (!signedIn) return;
    return guardDevice(api, () => navigate('/login'));
  }, [api, signedIn]);
  // A message from someone else: sound + a short note, or a phone notification
  // when Connect is in the background. Not when you're already in that chat.
  const onMessage = (m: IncomingMessage) => {
    const here = route.name === 'chat' && (route as { id?: string }).id === m.conversation_id && document.visibilityState === 'visible';
    if (here) return;
    const what = m.kind === 'voice' ? 'Voice message' : m.kind === 'image' ? 'Photo' : m.kind === 'video' ? 'Video' : m.kind === 'file' ? 'File' : (m.body || '').slice(0, 120);
    api
      .getConversation(m.conversation_id)
      .then((conv) => {
        const name = conv?.other.name ?? 'New message';
        if (document.visibilityState === 'visible') {
          play('comment');
          toast(`${name}: ${what}`);
        } else {
          notify(name, what, new URL(to(`/messages/${m.conversation_id}`), window.location.href).href, m.conversation_id);
        }
      })
      .catch(() => {});
  };
  const onGroup = (n: { kind: string; snippet?: string }) => {
    if (route.name === 'group' && document.visibilityState === 'visible') return;
    const title = n.kind === 'group_reply' ? 'New reply in the group' : 'You were mentioned in the group';
    const body = n.snippet ?? '';
    if (document.visibilityState === 'visible') {
      play('comment');
      toast(`${title}. ${body}`.slice(0, 160));
    } else {
      notify(title, body, new URL(to('/messages/group'), window.location.href).href, `group-${n.kind}`);
    }
  };
  const counts = useCounts(onMessage, onGroup);
  useEffect(() => {
    registerAlerts();
  }, []);
  // "typing…" in my private chats
  useTypingRoom(api, me?.id ? `u:${me.id}` : null, me?.id);
  // Alerts already allowed: make sure this phone gets messages when Connect is closed
  useEffect(() => {
    if (me?.id && alertsAllowed()) api.enablePush().catch(() => {});
  }, [api, me?.id]);
  // Online status: only members with a profile show up as online
  useEffect(() => (me ? startPresence(api) : undefined), [api, me?.id]);

  const member = isMember(me);
  const [visitor, setVisitorState] = useState(false);
  useEffect(() => {
    setVisitorState(visitorChosen());
    return onVisitorChange(() => setVisitorState(visitorChosen()));
  }, []);

  // Close the account menu whenever the page changes
  useEffect(() => setMenu(false), [route]);

  // First visit, not signed in: ask "Are you a member?" before anything else
  const authKnown = me !== undefined;
  // The home address always asks again, so someone who tapped "just looking" by
  // mistake (or pressed back) can still say they're a member
  const welcome = authKnown && !signedIn && route.name !== 'login' && route.name !== 'join' && (route.name === 'feed' || !visitor);
  // Opened a group invite before signing in: go back to it once signed in
  useEffect(() => {
    if (!signedIn) return;
    try {
      const t = localStorage.getItem('cx-join');
      if (t) {
        localStorage.removeItem('cx-join');
        navigate(`/join/${t}`);
      }
    } catch {
      /* storage blocked */
    }
  }, [signedIn]);

  // Non-members only see Students, student profiles and their posts
  const guestOk = ['students', 'profile', 'post', 'login', 'feed', 'learn', 'lesson', 'appearance', 'join'].includes(route.name) || (signedIn && route.name === 'settings');
  useEffect(() => {
    if (authKnown && !member && !guestOk) navigate('/students');
  }, [authKnown, member, guestOk]);

  // /new (old links, "Post" from elsewhere): show the feed with the composer open
  useEffect(() => {
    if (route.name === 'new' && member) openComposer();
  }, [route, member]);

  const screen = useMemo(() => {
    if (!authKnown) return <Loading />;
    if (welcome) return <Welcome />;
    if (!member && route.name === 'feed') return <Students tab="challenge" />;
    switch (route.name) {
      case 'feed':
        return <Feed />;
      case 'students':
        return <Students tab={route.tab ?? 'challenge'} />;
      case 'challenge':
        return <ChallengeScreen key={route.id} id={route.id} />;
      case 'profile':
        return <ProfileScreen key={route.handle} handle={route.handle} />;
      case 'post':
        return <PostScreen key={route.id} id={route.id} />;
      case 'messages':
        return <Inbox />;
      case 'appearance':
        return <AppearanceScreen />;
      case 'group':
        return <GroupChat key={route.gid ?? 'main'} gid={route.gid ?? null} />;
      case 'group-info':
        return <GroupInfoScreen key={route.gid ?? 'main'} gid={route.gid ?? null} />;
      case 'join':
        return <JoinGroupScreen token={route.token} />;
      case 'chat':
        return <Chat key={route.id} id={route.id} />;
      case 'login':
        return <Login key={route.team ? 'team' : 'member'} team={route.team} />;
      case 'settings':
        return <Settings />;
      case 'new':
        return <Feed />;
      case 'connections':
        return <Connections />;
      case 'notifications':
        return <Notifications />;
      case 'saved':
        return <Saved />;
      case 'learn':
        return <Learn />;
      case 'lesson':
        return <LessonScreen key={route.id} id={route.id} />;
      case 'assignment':
        return <AssignmentScreen key={route.phase} phase={route.phase} />;
      case 'reviews':
        return <Reviews />;
      case 'devices':
        return <Devices />;
      case 'lesson-edit':
        return <LessonEditor key={route.id ?? 'new'} id={route.id} />;
      default:
        return (
          <div className="cx-empty">
            <p className="cx-empty-title">Page not found</p>
            <A path="/">Back to the feed</A>
          </div>
        );
    }
  }, [route, authKnown, welcome, member]);

  return (
    <div className={(route.name === 'chat' || route.name === 'group') && member ? 'cx is-chat' : 'cx'} style={lookStyle} data-wall={look.wall === 'photo' && !look.photo ? 'plain' : look.wall} data-pattern={look.wall === 'photo' && look.photo ? 'none' : look.pattern}>
      {api.mode === 'demo' && (
        <p className="cx-preview-bar">Preview with sample members. Nothing here is real until the database is connected.</p>
      )}
      <header className="cx-top">
        <div className="cx-top-row">
          <A path="/" className="cx-logo" aria-label="Motion Dojo Connect, home">
            <img src="/assets/favicon-128.png" alt="" width={32} height={32} />
            <span>
              <b className="cx-logo-md">Motion Dojo </b>
              <em>Connect</em>
            </span>
          </A>
          {member && (
          <nav className="cx-nav" aria-label="Connect">
            {TABS.map((t) => (
              <A key={t.path} path={t.path} className={t.match.includes(route.name) ? 'is-on' : ''} aria-current={t.match.includes(route.name) ? 'page' : undefined}>
                {t.label}
                {t.path === '/connections' && <Dot n={counts.requests} />}
                {t.path === '/messages' && <Dot n={counts.messages} />}
              </A>
            ))}
          </nav>
          )}
          <div className="cx-top-right">
            {(me?.is_student || me?.is_sensei) && (
              <button type="button" className="btn btn-primary btn-sm cx-new" onClick={openComposer}>
                <Icon name="plus" size={18} />
                <span>Post</span>
              </button>
            )}
            {member && (
              <A path="/notifications" className="cx-bell" aria-label={`Notifications${counts.unread ? `, ${counts.unread} new` : ''}`}>
                <Icon name="bell" />
                <Dot n={counts.unread} />
              </A>
            )}
            {signedIn ? (
              <div className="cx-menu">
                <button type="button" className="cx-me" aria-label="Your account" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
                  {me ? <Avatar p={me} size={38} /> : <Icon name="user" />}
                  {member && <span className="cx-menu-phone cx-me-dot"><Dot n={counts.requests} /></span>}
                </button>
                {menu && (
                  <div className="cx-menu-list" role="menu" onClick={() => setMenu(false)}>
                    {me && (
                      <A path={`/u/${me.handle}`} role="menuitem">
                        Your profile
                      </A>
                    )}
                    {member && (
                      <A path="/connections" role="menuitem" className="cx-menu-phone">
                        Connections
                        {counts.requests > 0 && <b className="cx-menu-count">{counts.requests}</b>}
                      </A>
                    )}
                    {(me?.is_sensei || me?.is_moderator) && (
                      <A path="/reviews" role="menuitem">
                        Assignment reviews
                      </A>
                    )}
                    {(me?.is_sensei || me?.is_moderator) && (
                      <A path="/devices" role="menuitem">
                        Students
                      </A>
                    )}
                    {me && (
                      <A path="/saved" role="menuitem">
                        Saved
                      </A>
                    )}
                    <A path="/appearance" role="menuitem">
                      Appearance
                    </A>
                    <A path="/settings" role="menuitem">
                      {me ? 'Edit profile' : 'Set up profile'}
                    </A>
                    <button
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={sound}
                      onClick={() => {
                        setSoundOn(!sound);
                        setSound(!sound);
                        if (!sound) window.setTimeout(() => play('like'), 50);
                      }}
                    >
                      Sounds: {sound ? 'on' : 'off'}
                    </button>
                    <a href={MAIN_SITE} role="menuitem">
                      Motion Dojo website
                    </a>
                    <button type="button" role="menuitem" onClick={() => api.signOut()}>
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            ) : route.name === 'login' || welcome ? null : (
              // visitors: the next step is joining, not signing in
              <a href={`${MAIN_SITE}/blackbelt`} className="btn btn-primary btn-sm cx-join">
                <span className="cx-join-long">Become a member</span>
                <span className="cx-join-short">Join</span>
              </a>
            )}
          </div>
        </div>
      </header>

      {signedIn && me === null && route.name !== 'settings' && route.name !== 'login' && (
        <p className="cx-nudge">
          You’re signed in. <A path="/settings">Set up your profile</A> to connect, like, comment and save projects.
        </p>
      )}

      <main className="cx-main" id="main">
        <ScreenGuard key={JSON.stringify(route)}>{screen}</ScreenGuard>
      </main>

      {member && !welcome && (
      <nav className="cx-tabbar" aria-label="Connect">
        {TABS.filter((t) => !t.desktopOnly).map((t, i) => (
          <React.Fragment key={t.path}>
            {/* Post sits in the middle, between Learn and Members */}
            {i === 2 && (me?.is_student || me?.is_sensei) && (
              <button type="button" className="cx-tab-post" onClick={openComposer}>
                <span className="cx-tab-ico">
                  <Icon name="plus" />
                </span>
                <span>Post</span>
              </button>
            )}
            <A path={t.path} className={t.match.includes(route.name) ? 'is-on' : ''} aria-current={t.match.includes(route.name) ? 'page' : undefined}>
              <span className="cx-tab-ico">
                <Icon name={t.icon} />
                {t.path === '/connections' && <Dot n={counts.requests} />}
                {t.path === '/messages' && <Dot n={counts.messages} />}
              </span>
              <span>{t.label}</span>
            </A>
          </React.Fragment>
        ))}
      </nav>
      )}
      <Composer />
      {route.name !== 'settings' && route.name !== 'login' && <PhasePrompt />}
      <InstallPrompt when={Boolean(signedIn && member && !['chat', 'group', 'login', 'join'].includes(route.name))} />
    </div>
  );
}
