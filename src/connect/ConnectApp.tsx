'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ConnectProvider, isMember, useConnect } from './context';
import { Composer, openComposer } from './compose';
import { onVisitorChange, visitorChosen } from './visitor';
import { play, setSoundOn, soundOn } from './sounds';
import { createDemoApi } from './demo-api';
import { navigate, useRoute, type Route } from './router';
import type { ConnectApi } from './types';
import { A, Avatar, Icon, Loading } from './ui';
import { Feed, PostScreen, ProfileScreen, Students } from './screens-browse';
import { Inbox, Login, Settings, Welcome } from './screens-me';
import { Chat } from './chat';
import { Connections, Notifications, Saved } from './screens-social';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const MAIN_SITE = process.env.NEXT_PUBLIC_MAIN_SITE_URL || 'https://joinmotiondojo.com';

/** Live when Supabase keys are set, otherwise the labelled sample preview */
function useApi(): ConnectApi | null {
  const [api, setApi] = useState<ConnectApi | null>(null);
  useEffect(() => {
    if (SUPABASE_URL && SUPABASE_ANON_KEY) {
      import('./live-api').then(({ createLiveApi }) => setApi(createLiveApi(SUPABASE_URL, SUPABASE_ANON_KEY, window.location.origin + window.location.pathname.replace(/\/login$/, ''))));
    } else {
      setApi(createDemoApi());
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

const TABS = [
  { path: '/', label: 'Feed', icon: 'home' as const, match: ['feed', 'post'] },
  { path: '/students', label: 'Students', icon: 'people' as const, match: ['students', 'profile'] },
  { path: '/connections', label: 'Connections', icon: 'link2' as const, match: ['connections'] },
  { path: '/messages', label: 'Messages', icon: 'chat' as const, match: ['messages', 'chat'] },
];

/** Unread notifications and waiting connection requests, refreshed every 30 seconds */
function useCounts() {
  const { api, me } = useConnect();
  const [c, setC] = useState({ unread: 0, requests: 0 });
  useEffect(() => {
    if (!me) {
      setC({ unread: 0, requests: 0 });
      return;
    }
    let live = true;
    const load = async () => {
      // Tell senders their messages reached this device (grey double tick)
      api.markDelivered().catch(() => {});
      const [unread, r] = await Promise.all([api.unreadCount(), api.listRequests()]);
      if (live) setC({ unread, requests: r.incoming.length });
    };
    load().catch(() => {});
    const t = window.setInterval(() => document.visibilityState === 'visible' && load().catch(() => {}), 30000);
    const on = () => load().catch(() => {});
    window.addEventListener('cx:counts', on);
    return () => {
      live = false;
      window.clearInterval(t);
      window.removeEventListener('cx:counts', on);
    };
  }, [api, me]);
  return c;
}

const Dot = ({ n }: { n: number }) => (n > 0 ? <span className="cx-dot">{n > 9 ? '9+' : n}</span> : null);

function Shell({ route }: { route: Route }) {
  const { api, me, signedIn } = useConnect();
  const [menu, setMenu] = useState(false);
  const [sound, setSound] = useState(true);
  useEffect(() => setSound(soundOn()), []);
  const counts = useCounts();

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
  const welcome = authKnown && !signedIn && !visitor && route.name !== 'login';

  // Non-members only see Students, student profiles and their posts
  const guestOk = ['students', 'profile', 'post', 'login', 'feed'].includes(route.name) || (signedIn && route.name === 'settings');
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
    if (!member && route.name === 'feed') return <Students />;
    switch (route.name) {
      case 'feed':
        return <Feed />;
      case 'students':
        return <Students />;
      case 'profile':
        return <ProfileScreen key={route.handle} handle={route.handle} />;
      case 'post':
        return <PostScreen key={route.id} id={route.id} />;
      case 'messages':
        return <Inbox />;
      case 'chat':
        return <Chat key={route.id} id={route.id} />;
      case 'login':
        return <Login />;
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
    <div className={route.name === 'chat' && member ? 'cx is-chat' : 'cx'}>
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
                </button>
                {menu && (
                  <div className="cx-menu-list" role="menu" onClick={() => setMenu(false)}>
                    {me && (
                      <A path={`/u/${me.handle}`} role="menuitem">
                        Your profile
                      </A>
                    )}
                    {me && (
                      <A path="/saved" role="menuitem">
                        Saved
                      </A>
                    )}
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
            ) : (
              <A path="/login" className="btn btn-light btn-sm">
                Sign in
              </A>
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
        {screen}
      </main>

      {member && !welcome && (
      <nav className="cx-tabbar" aria-label="Connect">
        {TABS.map((t, i) => (
          <React.Fragment key={t.path}>
            {/* Post sits in the middle, between Students and Connections */}
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
              </span>
              <span>{t.label}</span>
            </A>
          </React.Fragment>
        ))}
      </nav>
      )}
      <Composer />
    </div>
  );
}
