'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ConnectProvider, isMember, useConnect } from './context';
import { Composer, openComposer } from './compose';
import { onVisitorChange, visitorChosen } from './visitor';
import { play, setSoundOn, soundOn } from './sounds';
import { alertsAllowed, alertsSupported, askForAlerts, notify, pushOn, registerAlerts } from './alerts';
import { startPresence } from './presence';
import { keyboardOver, useKeyboardOverlay } from './keyboard';
import { KeyboardCheck } from './kbcheck';
import { guardDevice } from './device';
import { CHAT_COLORS, useAppearance } from './appearance';
import { Appearance as AppearanceScreen } from './screens-appearance';
import { createDemoApi } from './demo-api';
import { peek, withCache } from './cache';
import { useDragToClose } from './drag';
import { navigate, to, useRoute, type Route } from './router';
import type { AlertLevel, ConnectApi, Profile } from './types';
import { A, Avatar, Icon, Loading } from './ui';
import { Feed, PostScreen, ProfileScreen, Students } from './screens-browse';
import { Login, Settings, Welcome } from './screens-me';
import { Chat, Inbox } from './chat';
import { GroupChat, GroupInfoScreen, JoinGroupScreen } from './group';
import { PhasePrompt } from './phase-prompt';
import { InstallPrompt } from './install';
import { lessonOpened } from './learning';
import { CallLayer } from './calls';
import { addWatched, left, startFocus, useFocus, watchingNow } from './focus';
import { useTypingRoom } from './typing';
import { ChallengeScreen } from './challenge';
import { Connections, Notifications, Saved } from './screens-social';
import { AssignmentScreen, Devices, Learn, LessonEditor, LessonScreen, RecordingScreen, Reviews } from './screens-learn';

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
  { path: '/learn', label: 'Learn', icon: 'learn' as const, match: ['learn', 'lesson', 'lesson-edit', 'assignment', 'live-rec'] },
  { path: '/students', label: 'Members', icon: 'people' as const, match: ['students', 'profile', 'challenge'] },
  // On phones Connections lives in the account menu, to keep the bottom bar to five
  { path: '/connections', label: 'Connections', icon: 'link2' as const, match: ['connections'], desktopOnly: true },
  { path: '/messages', label: 'Messages', icon: 'chat' as const, match: ['messages', 'chat', 'group', 'group-info'] },
];

/** Unread notifications and waiting connection requests, refreshed every 30 seconds */
type IncomingMessage = { conversation_id: string; sender_id: string; body?: string; kind?: string };

function useCounts(onMessage: (m: IncomingMessage) => void, onGroup: (n: { kind: string; snippet?: string }) => void, onGroupMessage: (row: { group_id?: string | null; kind?: string; sender_id?: string }) => void) {
  const { api, me } = useConnect();
  const [c, setC] = useState({ unread: 0, requests: 0, messages: 0 });
  const onMessageRef = React.useRef(onMessage);
  onMessageRef.current = onMessage;
  const onGroupRef = React.useRef(onGroup);
  onGroupRef.current = onGroup;
  const onGroupMessageRef = React.useRef(onGroupMessage);
  onGroupMessageRef.current = onGroupMessage;
  useEffect(() => {
    if (!me) {
      setC({ unread: 0, requests: 0, messages: 0 });
      return;
    }
    let live = true;
    const load = async () => {
      // Tell senders their messages reached this device (grey double tick)
      api.markDelivered().catch(() => {});
      api.markGroupDelivered().catch(() => {});
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
    // Groups: update the Messages count, and a sound for messages from others
    const stopGroup = api.subscribe('group_messages', '', ({ event, row }) => {
      // "seen" updates as people open a group don't change my counts
      if (event === 'UPDATE' && !row.deleted_at) return;
      window.clearTimeout(pending);
      pending = window.setTimeout(on, 250);
      if (event === 'INSERT' && row.sender_id && row.sender_id !== me.id) onGroupMessageRef.current(row as { group_id?: string | null; kind?: string; sender_id?: string });
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
  const { api, me, signedIn, toast, refreshMe } = useConnect();
  const [menu, setMenu] = useState(false);
  const [sound, setSound] = useState(true);
  useEffect(() => setSound(soundOn()), []);
  // Dark theme, chat colour and wallpaper (saved on this device)
  const look = useAppearance();
  useEffect(() => {
    document.documentElement.dataset.cxTheme = look.dark ? 'dark' : 'light';
    // the installed app's background colour follows this (see manifest.webmanifest)
    document.cookie = `cx-theme=${look.dark ? 'dark' : 'light'}; path=/; max-age=31536000; samesite=lax`;
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
  // Strict focus mode (the padlock): picked when opening a lesson; until that
  // much video is watched, only Learn can be used
  const strict = useFocus();
  const team = Boolean(me?.is_sensei || me?.is_moderator);
  const [askFocus, setAskFocus] = useState(false);
  const FOCUS_ROUTES = ['learn', 'lesson', 'assignment', 'live-rec'];
  useEffect(() => {
    if (!strict) return;
    if (!FOCUS_ROUTES.includes(route.name)) {
      // the padlock at the top says why; give it a nudge
      navigate('/learn');
      document.querySelector('.cx-lock-chip')?.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }], { duration: 300 });
    }
  }, [route, Boolean(strict)]);
  // Students choose a study time before every lesson (no skipping); the team isn't asked
  useEffect(() => {
    setAskFocus((route.name === 'lesson' || route.name === 'live-rec') && !strict && !team && Boolean(me?.is_student));
  }, [route, Boolean(strict), team, me?.is_student]);
  // count watching time (only while a lesson is open, on screen, and playing)
  useEffect(() => {
    if (!strict || route.name !== 'lesson') return;
    const t = window.setInterval(() => {
      if (document.visibilityState !== 'visible' || !watchingNow()) return;
      if (addWatched(1)) {
        play('post');
        toast('Done. Connect is unlocked.');
      }
    }, 1000);
    return () => window.clearInterval(t);
  }, [Boolean(strict), route]);

  // Focus mode: while learning, nothing pings, pops up or shows a count.
  // When you leave Learn, one note says what came in.
  const focusing = Boolean(strict) || route.name === 'learn' || route.name === 'lesson';
  const held = React.useRef(0);
  const wasFocusing = React.useRef(focusing);
  useEffect(() => {
    if (wasFocusing.current && !focusing && held.current > 0) {
      const n = held.current;
      toast(n === 1 ? 'While you were learning: 1 new message' : `While you were learning: ${n} new messages`);
    }
    if (!focusing) held.current = 0;
    wasFocusing.current = focusing;
  }, [focusing]);
  // for the "no lesson in 3 days" note in the group
  useEffect(() => {
    if (route.name === 'lesson') lessonOpened();
  }, [route]);
  // Group sounds follow the person's choice: all (default), important only, or off
  const alertLevel = me?.alert_level ?? 'all';
  // Alerts are phone notifications, even while Connect is open. With push on the
  // server sends them; with only permission, this page shows one; with neither,
  // a sound and a short note in the app.
  const phoneAlert = (title: string, body: string, url: string, tag: string, sound: 'message' | 'comment') => {
    if (pushOn()) return;
    if (alertsAllowed()) return void notify(title, body, url, tag);
    play(sound);
    toast(`${title}: ${body}`.slice(0, 160));
  };
  // A message from someone else. Not when you're already in that chat.
  const onMessage = (m: IncomingMessage) => {
    const here = route.name === 'chat' && (route as { id?: string }).id === m.conversation_id && document.visibilityState === 'visible';
    if (here) return play('incoming');
    if (focusing) {
      held.current += 1;
      return;
    }
    const what = m.kind === 'voice' ? 'Voice message' : m.kind === 'image' ? 'Photo' : m.kind === 'video' ? 'Video' : m.kind === 'file' ? 'File' : (m.body || '').slice(0, 120);
    api
      .getConversation(m.conversation_id)
      .then((conv) => {
        const name = conv?.other.name ?? 'New message';
        phoneAlert(name, what, new URL(to(`/messages/${m.conversation_id}`), window.location.href).href, m.conversation_id, 'message');
      })
      .catch(() => {});
  };
  // Any new group message: a sound (a soft pop if you're reading that group)
  const groupSound = React.useRef(0);
  const onGroupMessage = (row: { group_id?: string | null; kind?: string; sender_id?: string }) => {
    if (document.visibilityState !== 'visible' || row.kind === 'join' || row.kind === 'pin') return;
    if (focusing) {
      held.current += 1;
      return;
    }
    if (alertLevel === 'off') return;
    if (alertLevel === 'important' && row.kind !== 'poll' && row.kind !== 'live') {
      const sender = (peek<Profile[]>('groupMembers') ?? []).find((p) => p.id === row.sender_id);
      if (!sender?.is_sensei && !sender?.is_moderator) return;
    }
    const gid = (route as { gid?: string }).gid ?? null;
    const here = route.name === 'group' && gid === (row.group_id ?? null);
    const now = Date.now();
    if (now - groupSound.current < 2500) return;
    groupSound.current = now;
    play(here ? 'incoming' : 'message');
  };
  const onGroup = (n: { kind: string; snippet?: string }) => {
    if (route.name === 'group' && document.visibilityState === 'visible') return;
    if (focusing || alertLevel === 'off') return;
    const title = n.kind === 'group_reply' ? 'New reply in the group' : 'You were mentioned in the group';
    const body = n.snippet ?? '';
    phoneAlert(title, body, new URL(to('/messages/group'), window.location.href).href, `group-${n.kind}`, 'comment');
  };
  const allCounts = useCounts(onMessage, onGroup, onGroupMessage);
  const counts = focusing ? { unread: 0, requests: 0, messages: 0 } : allCounts;
  useEffect(() => {
    registerAlerts();
  }, []);
  // In a chat, fit the screen to the space above the keyboard and keep the
  // page from sliding (so the header and message box both stay in view)
  const inChat = route.name === 'chat' || route.name === 'group';
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('cx-in-chat', inChat);
    const vv = window.visualViewport;
    if (!inChat || !vv) {
      root.style.removeProperty('--vvh');
      return;
    }
    // the full height with no keyboard, to tell whether the phone already shrank the page
    let full = vv.height;
    const fit = () => {
      const over = keyboardOver();
      if (!over) full = Math.max(full, vv.height);
      // installed app: the keyboard slides over the page, so take its height off
      // (unless the phone shrank the page anyway, then it's already off)
      const shrunk = vv.height < full - 50;
      root.style.setProperty('--vvh', `${Math.round(vv.height - (shrunk ? 0 : over))}px`);
      if (window.scrollY) window.scrollTo(0, 0);
    };
    fit();
    vv.addEventListener('resize', fit);
    vv.addEventListener('scroll', fit);
    window.addEventListener('cx:keyboard', fit);
    return () => {
      vv.removeEventListener('resize', fit);
      vv.removeEventListener('scroll', fit);
      window.removeEventListener('cx:keyboard', fit);
      root.classList.remove('cx-in-chat');
      root.style.removeProperty('--vvh');
    };
  }, [inChat]);
  // installed app: keyboard over the page instead of shrinking the window (no flash)
  useKeyboardOverlay();
  // "typing…" in my private chats
  useTypingRoom(api, me?.id ? `u:${me.id}` : null, me?.id);
  // Alerts already allowed: make sure this phone gets messages when Connect is closed
  useEffect(() => {
    if (me?.id && alertsAllowed()) api.enablePush().catch(() => {});
  }, [api, me?.id]);
  const [alertsOpen, setAlertsOpen] = useState(false);
  // Account menu: check this phone gets notifications, and say what's wrong if not
  const testAlerts = async () => {
    setMenu(false);
    if (!alertsSupported()) return toast(/iphone|ipad/i.test(navigator.userAgent) ? 'On iPhone, add Connect to your Home Screen first, then open it from there.' : 'This browser can’t show notifications.');
    if (Notification.permission === 'denied') return toast('Notifications are blocked. Allow them for this site in your browser settings.');
    if (Notification.permission !== 'granted' && !(await askForAlerts())) return toast('Notifications weren’t allowed.');
    toast('Sending a test…');
    const r = await api.testPush().catch((e) => ({ ok: false, why: (e as Error).message }));
    toast(r.ok ? 'Sent. It should appear in a moment, with sound.' : `No notification: ${r.why}`);
  };
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
      case 'live-rec':
        return <RecordingScreen key={route.id} id={route.id} />;
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
    <div className={[(route.name === 'chat' || route.name === 'group') && member ? 'cx is-chat' : 'cx', strict ? 'is-locked' : ''].filter(Boolean).join(' ')} style={lookStyle} data-wall={look.wall === 'photo' && !look.photo ? 'plain' : look.wall} data-pattern={look.wall === 'photo' && look.photo ? 'none' : look.pattern}>
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
            {strict && (
              <span className="cx-lock-chip" role="status" aria-label={`Focus mode: ${left(strict)} of lessons left`}>
                <Icon name="lock" size={14} />
                {left(strict)}
                <span className="cx-lock-line" style={{ width: `${(strict.watched / strict.goal) * 100}%` }} aria-hidden="true" />
              </span>
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
                    <button type="button" role="menuitem" onClick={() => (setMenu(false), setAlertsOpen(true))}>
                      Notifications
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
      {me && member && !strict && <CallLayer />}
      <KeyboardCheck />
      {askFocus && (
        <FocusPrompt
          onClose={() => navigate('/learn')}
          onStart={(m) => {
            startFocus(m);
            setAskFocus(false);
            toast(`Focus on: ${m >= 60 ? `${+(m / 60).toFixed(1)} hr` : `${m} min`} of lessons.`);
          }}
        />
      )}
      {alertsOpen && me && (
        <AlertsSheet
          level={alertLevel}
          onClose={() => setAlertsOpen(false)}
          onPick={async (lv) => {
            try {
              await api.setAlertLevel(lv);
              await refreshMe();
            } catch (e) {
              toast((e as Error).message);
            }
          }}
          onTest={testAlerts}
        />
      )}
      <InstallPrompt when={Boolean(signedIn && member && !['chat', 'group', 'login', 'join'].includes(route.name))} />
    </div>
  );
}

/** Account menu > Notifications: which group messages notify you, and a test */
const LEVELS: { v: AlertLevel; t: string; d: string }[] = [
  { v: 'all', t: 'All messages', d: 'Every message in your groups.' },
  { v: 'important', t: 'Important only', d: 'The Grand Sensei and the team, polls, live classes, and replies or @mentions to you.' },
  { v: 'off', t: 'Off', d: 'No group notifications. Private chats still notify you.' },
];
function AlertsSheet({ level, onClose, onPick, onTest }: { level: AlertLevel; onClose: () => void; onPick: (l: AlertLevel) => Promise<void>; onTest: () => void }) {
  const sheet = useDragToClose<HTMLDivElement>(onClose);
  const [v, setV] = useState(level);
  return (
    <div className="cx-sheet-wrap" onClick={onClose}>
      <div className="cx-sheet cx-drag cx-alerts" role="dialog" aria-label="Notifications" ref={sheet} onClick={(e) => e.stopPropagation()}>
        <span className="cx-grab" aria-hidden="true" />
        <h2 className="cx-fwd-title">Group notifications</h2>
        <div role="radiogroup" aria-label="Group notifications">
          {LEVELS.map((x) => (
            <button
              key={x.v}
              type="button"
              role="radio"
              aria-checked={v === x.v}
              className="cx-alert-opt"
              onClick={() => {
                setV(x.v);
                onPick(x.v);
              }}
            >
              <span className={v === x.v ? 'cx-poll-dot is-on' : 'cx-poll-dot'} aria-hidden="true" />
              <span>
                <b>{x.t}</b>
                <small>{x.d}</small>
              </span>
            </button>
          ))}
        </div>
        <p className="cx-fwd-note">While you’re in Learn, nothing pings. You’ll see what came in when you leave.</p>
        <button type="button" className="btn btn-light cx-addp-go" onClick={() => (onClose(), onTest())}>
          Send me a test notification
        </button>
      </div>
    </div>
  );
}

/** Opening a lesson: "How long do you want to study?" */
const FOCUS_TIMES = [15, 30, 45, 60, 90, 120];
function FocusPrompt({ onClose, onStart }: { onClose: () => void; onStart: (minutes: number) => void }) {
  const [m, setM] = useState(30);
  const [own, setOwn] = useState('');
  const custom = own !== '';
  const mins = custom ? Math.min(300, Math.max(5, Math.round(Number(own) || 0))) : m;
  return (
    <div className="cx-sheet-wrap">
      <div className="cx-sheet cx-focus-ask" role="dialog" aria-modal="true" aria-label="Focus mode">
        <span className="cx-focus-lock" aria-hidden="true">
          <Icon name="lock" size={26} />
        </span>
        <h2 className="cx-fwd-title">How long do you want to study?</h2>
        <p className="cx-fwd-note">Messages, Feed and Members stay locked until you’ve watched lessons for this long.</p>
        <div className="cx-focus-times" role="radiogroup" aria-label="Study time">
          {FOCUS_TIMES.map((t) => (
            <button key={t} type="button" role="radio" aria-checked={!custom && m === t} className={!custom && m === t ? 'is-on' : ''} onClick={() => (setM(t), setOwn(''))}>
              {t < 60 ? `${t} min` : t === 60 ? '1 hr' : `${t / 60} hr`}
            </button>
          ))}
        </div>
        <label className={custom ? 'cx-focus-own is-on' : 'cx-focus-own'}>
          <span>Your own</span>
          <input type="number" inputMode="numeric" min={5} max={300} placeholder="e.g. 40" value={own} onChange={(e) => setOwn(e.target.value.replace(/\D/g, '').slice(0, 3))} />
          <span>min</span>
        </label>
        <button type="button" className="btn btn-primary cx-addp-go" disabled={custom && !(Number(own) >= 5)} onClick={() => onStart(mins)}>
          Lock for {mins >= 60 ? `${+(mins / 60).toFixed(1)} hr` : `${mins} min`}
        </button>
        <button type="button" className="cx-link-btn cx-focus-back" onClick={onClose}>
          Back to lessons
        </button>
      </div>
    </div>
  );
}
