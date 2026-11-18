'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { shakeField } from './shake';
import Velaris from './velaris';
import { useConnect } from './context';
import { navigate } from './router';
import { setVisitor } from './visitor';
import { describeLink, legacyLinks } from './links';
import { play } from './sounds';
import { timeAgo } from './media';
import { PHASES, SKILLS, type Conversation, type Message, type Profile } from './types';
import { A, Avatar, BELTS, Empty, Icon, Loading, BeltBadge, SampleTag } from './ui';

/* ================= Welcome: are you a member? ================= */
export function Welcome() {
  return (
    <div className="cx-welcome">
      <img src="/assets/favicon-128.png" alt="" width={64} height={64} />
      <h1 className="cx-welcome-title">Are you a member?</h1>
      <p className="cx-lead">Members are enrolled on Black Belt in Motion Design.</p>
      <div className="cx-welcome-btns">
        <button type="button" className="btn btn-primary" onClick={() => navigate('/login')}>
          Yes, sign me in
        </button>
        <button
          type="button"
          className="btn btn-light"
          onClick={() => {
            setVisitor(true);
            navigate('/students');
          }}
        >
          No, just looking
        </button>
      </div>
    </div>
  );
}

/* ================= Sign in ================= */
function AuthIcon({ name }: { name: 'mail' | 'id' }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {name === 'mail' ? (
        <>
          <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
          <path d="m4 7.5 8 5.5 8-5.5" />
        </>
      ) : (
        <>
          <rect x="3" y="5" width="18" height="14" rx="2.5" />
          <circle cx="9" cy="11" r="2.2" />
          <path d="M5.8 16.2c.6-1.6 1.8-2.4 3.2-2.4s2.6.8 3.2 2.4M14.5 10h3.5M14.5 13.5h3.5" />
        </>
      )}
    </svg>
  );
}

export function Login() {
  const { api, signedIn, me } = useConnect();
  const [mode, setMode] = useState<'student' | 'link'>('student');
  const [email, setEmail] = useState('');
  const [studentId, setStudentId] = useState('');
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (signedIn && me) navigate('/');
    else if (signedIn && me === null) navigate('/settings');
  }, [signedIn, me]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    const form = e.currentTarget as HTMLFormElement;
    const emailField = form.querySelector('input[type="email"]');
    const idField = form.querySelector('input[name="member-id"]');
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      shakeField(emailField);
      return setErr('Enter a valid email address.');
    }
    if (mode === 'student' && studentId.replace(/[^a-z0-9]/gi, '').length < 8) {
      shakeField(idField);
      return setErr('Enter your member ID, for example MD-7KQ2-X9PB.');
    }
    setBusy(true);
    try {
      if (mode === 'student') {
        await api.studentSignIn(email.trim(), studentId);
      } else {
        await api.signIn(email.trim());
        setSent(true);
      }
    } catch (e2) {
      // wrong email/ID pair: shake both so it's clear which form failed
      shakeField(emailField);
      if (mode === 'student') shakeField(idField);
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const switchTo = (m: 'student' | 'link') => {
    setMode(m);
    setErr('');
    setSent(false);
  };

  const member = mode === 'student';
  return (
    <div className="cx-auth">
      {/* top band: the Dojo gradient, the logo and what this page is */}
      <div className="cx-auth-top">
        <Velaris className="cx-auth-bg" bg="#140a2e" colors={['#6d32e8', '#a77bff', '#3a1a8c', '#140a2e']} speed={1.2} grain={0.35} />
        <img src="/assets/favicon-128.png" alt="" width={48} height={48} />
        <h1>{member ? 'Sign in to Connect' : 'Team sign-in'}</h1>
        <p>{member ? 'For Motion Dojo members' : 'For the Motion Dojo team'}</p>
      </div>

      <div className="cx-auth-card">
        {sent ? (
          <div className="cx-auth-sent">
            <span className="cx-auth-sent-ico" aria-hidden="true">
              <AuthIcon name="mail" />
            </span>
            <h2>Check your email</h2>
            <p>
              We sent a sign-in link to <strong>{email}</strong>. It works once and expires after an hour.
            </p>
          </div>
        ) : (
          <form className="cx-form" onSubmit={submit} noValidate>
            <label className="field cx-auth-field">
              <span>Email</span>
              <span className="cx-auth-input">
                <AuthIcon name="mail" />
                <input
                  type="email"
                  autoComplete="email"
                  placeholder={member ? 'The email you enrolled with' : 'you@example.com'}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </span>
            </label>
            {member && (
              <label className="field cx-auth-field">
                <span>Member ID</span>
                <span className="cx-auth-input">
                  <AuthIcon name="id" />
                  <input
                    name="member-id"
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    placeholder="MD-XXXX-XXXX"
                    value={studentId}
                    onChange={(e) => setStudentId(e.target.value.toUpperCase())}
                    required
                  />
                </span>
                <small>Lost it? Ask the community manager.</small>
              </label>
            )}
            {err && (
              <p className="cx-error" role="alert">
                {err}
              </p>
            )}
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {member ? (busy ? 'Signing in…' : 'Sign in') : busy ? 'Sending…' : 'Email me a sign-in link'}
            </button>
          </form>
        )}

        <div className="cx-auth-or" aria-hidden="true">
          <span>or</span>
        </div>
        <button type="button" className="btn cx-auth-switch" onClick={() => switchTo(member ? 'link' : 'student')}>
          <AuthIcon name={member ? 'mail' : 'id'} />
          {member ? 'Team? Sign in with an email link' : 'Member? Sign in with your ID'}
        </button>

        <p className="cx-auth-foot">
          Not a member yet?{' '}
          <button
            type="button"
            className="cx-link-btn"
            onClick={() => {
              setVisitor(true);
              navigate('/students');
            }}
          >
            Look around
          </button>
        </p>
      </div>

        {api.demoSignIn && (
          <div className="cx-demo">
            <p>
              <strong>Preview:</strong> email sign-in starts working once the database is connected. Try it with a sample account:
            </p>
            <div className="cx-demo-btns">
              <button type="button" className="btn btn-lime btn-sm" onClick={() => api.demoSignIn!('student')}>
                Sample member
              </button>
              <button type="button" className="btn btn-light btn-sm" onClick={() => api.demoSignIn!('visitor')}>
                Sample visitor
              </button>
              <button type="button" className="btn btn-light btn-sm" onClick={() => api.demoSignIn!('sensei')}>
                Sample grand sensei
              </button>
            </div>
          </div>
        )}
    </div>
  );
}

/* ================= Profile setup and editing ================= */
const toHandle = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);

export function Settings() {
  const { api, me, signedIn, refreshMe, toast } = useConnect();
  const creating = me === null;
  const [f, setF] = useState({
    name: '',
    handle: '',
    bio: '',
    country: '',
    skills: [] as string[],
    phase: null as number | null,
    phase_public: true,
    instagram: '',
    youtube: '',
    website: '',
    links: [] as string[],
    avatar_url: null as string | null,
    cover_url: null as string | null,
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState('');

  useEffect(() => {
    if (me) {
      setF({
        name: me.name,
        handle: me.handle,
        bio: me.bio,
        country: me.country,
        skills: me.skills,
        phase: me.phase,
        phase_public: me.phase_public !== false,
        instagram: me.instagram,
        youtube: me.youtube,
        website: me.website,
        // Older single fields fold into the one list of links
        links: [...(me.links ?? []), ...legacyLinks(me)].filter((v, i, all) => all.indexOf(v) === i),
        avatar_url: me.avatar_url,
        cover_url: me.cover_url,
      });
    }
  }, [me]);

  if (!signedIn) {
    return (
      <Empty title="Sign in to set up your profile">
        <A path="/login" className="btn btn-primary btn-sm">
          Sign in
        </A>
      </Empty>
    );
  }
  if (me === undefined) return <Loading />;

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const toggleSkill = (s: string) => set('skills', f.skills.includes(s) ? f.skills.filter((x) => x !== s) : [...f.skills, s].slice(0, 6));

  // Gallery photos show at once from the phone; the upload runs behind them
  const jobs = useRef<{ avatar_url?: Promise<string>; cover_url?: Promise<string> }>({});
  const [uploading, setUploading] = useState(0);
  const pick = (key: 'avatar_url' | 'cover_url', folder: 'avatars' | 'covers') => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast('Pick a photo.');
    if (file.size > 20 * 1024 * 1024) return toast('Pick a photo under 20 MB.');
    const before = f[key];
    const preview = URL.createObjectURL(file);
    set(key, preview);
    setUploading((n) => n + 1);
    const job = api.uploadImage(file, folder);
    jobs.current[key] = job;
    job
      .then((url) => {
        if (jobs.current[key] === job) setF((x) => (x[key] === preview ? { ...x, [key]: url } : x));
      })
      .catch((e2) => {
        if (jobs.current[key] === job) {
          delete jobs.current[key];
          setF((x) => (x[key] === preview ? { ...x, [key]: before } : x));
        }
        toast((e2 as Error).message);
      })
      .finally(() => setUploading((n) => n - 1));
  };
  const pickAvatar = pick('avatar_url', 'avatars');
  const pickCover = pick('cover_url', 'covers');

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    const form = e.currentTarget as HTMLFormElement;
    const handle = toHandle(f.handle || f.name);
    if (!f.name.trim()) {
      shakeField(form.querySelector('input[autocomplete="name"]'));
      return setErr('Add your name.');
    }
    if (handle.length < 3) {
      shakeField(form.querySelector('input[name="handle"]'));
      return setErr('Your username needs at least 3 letters or numbers.');
    }
    // Students are known by their belt, so the phase is required
    if (me?.is_student && !me.is_sensei && !f.phase) return setErr('Choose your phase. Your badge shows your belt.');
    setBusy(true);
    try {
      // Wait for any photo still uploading, then save its real address (not the on-phone preview)
      const urls = { ...f };
      for (const key of ['avatar_url', 'cover_url'] as const) {
        if (urls[key]?.startsWith('blob:') && jobs.current[key]) urls[key] = await jobs.current[key]!;
        if (urls[key]?.startsWith('blob:')) urls[key] = me ? me[key] : null;
      }
      const bad = f.links.find((v) => v.trim() && !describeLink(v));
      if (bad) {
        setBusy(false);
        return setErr(`“${bad.trim()}” isn’t a full link. Paste it like tiktok.com/@yourname.`);
      }
      const links = f.links
        .map((v) => describeLink(v)?.href)
        .filter((v, i, all): v is string => Boolean(v) && all.indexOf(v) === i)
        .slice(0, 10);
      const input = { ...urls, links, instagram: '', youtube: '', website: '', name: f.name.trim(), handle, bio: f.bio.trim() };
      const saved = creating ? await api.createProfile(input) : await api.updateProfile(input);
      await refreshMe();
      toast(creating ? 'Welcome to Motion Dojo Connect.' : 'Profile saved.');
      navigate(`/u/${saved.handle}`);
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const checkStudent = async () => {
    const ok = await api.refreshStudentStatus();
    await refreshMe();
    toast(ok ? 'You’re verified as a member.' : 'We couldn’t find an enrolment for this email yet.');
  };
  const useInvite = async () => {
    const ok = await api.redeemInvite(invite);
    await refreshMe();
    toast(ok ? 'Invite accepted. You’re verified as a member.' : 'That code didn’t work. Check it with the community manager.');
  };

  return (
    <div className="cx-narrow">
      <form className="cx-panel cx-form" onSubmit={save} noValidate>
        <h1 className="cx-h1">{creating ? 'Set up your profile' : 'Edit profile'}</h1>

        <div className="cx-cover-pick" style={f.cover_url ? { backgroundImage: `url(${f.cover_url})` } : undefined}>
          <label className="btn btn-light btn-sm">
            {f.cover_url ? 'Change cover' : 'Add a cover image'}
            <input type="file" accept="image/*" className="sr-only" onChange={pickCover} />
          </label>
        </div>
        <div className="cx-avatar-pick">
          <Avatar p={{ name: f.name || '?', handle: f.handle || 'x', avatar_url: f.avatar_url }} size={88} />
          <label className="btn btn-light btn-sm">
            {f.avatar_url ? 'Change photo' : 'Add a photo'}
            <input type="file" accept="image/*" className="sr-only" onChange={pickAvatar} />
          </label>
        </div>

        <label className="field">
          <span>Name</span>
          <input value={f.name} maxLength={60} autoComplete="name" onChange={(e) => set('name', e.target.value)} />
        </label>
        <label className="field">
          <span>Username</span>
          <input name="handle" value={f.handle} maxLength={24} placeholder={toHandle(f.name) || 'your_name'} onChange={(e) => set('handle', toHandle(e.target.value))} />
          <small>Letters, numbers and underscores. Your profile link uses it.</small>
        </label>
        <label className="field">
          <span>Bio</span>
          <textarea rows={3} maxLength={400} value={f.bio} onChange={(e) => set('bio', e.target.value)} />
          <small>{400 - f.bio.length} characters left</small>
        </label>
        <label className="field">
          <span>Country</span>
          <input value={f.country} maxLength={60} autoComplete="country-name" onChange={(e) => set('country', e.target.value)} />
        </label>

        <fieldset className="cx-fieldset">
          <legend>What you’re working on (up to 6)</legend>
          <div className="cx-chips">
            {SKILLS.map((s) => (
              <button key={s} type="button" className={f.skills.includes(s) ? 'cx-chip is-on' : 'cx-chip'} aria-pressed={f.skills.includes(s)} onClick={() => toggleSkill(s)}>
                {s}
              </button>
            ))}
          </div>
        </fieldset>

        {me?.is_student && !me.is_sensei && (
          <label className="field">
            <span>Your phase</span>
            <select required value={f.phase ?? ''} onChange={(e) => set('phase', e.target.value ? Number(e.target.value) : null)}>
              <option value="" disabled>
                Choose your phase
              </option>
              {PHASES.map((t, i) => (
                <option key={t} value={i + 1}>
                  Phase {i + 1}: {t} ({BELTS[i]})
                </option>
              ))}
            </select>
          </label>
        )}
        {me?.is_student && !me.is_sensei && f.phase && (
          <label className="cx-check">
            <input type="checkbox" checked={f.phase_public} onChange={(e) => set('phase_public', e.target.checked)} />
            <span>Show my belt to other members</span>
          </label>
        )}

        <fieldset className="cx-fieldset">
          <legend>Links</legend>
          <p className="cx-muted cx-links-hint">Paste any link, like your TikTok, LinkedIn or portfolio. Connect adds the right icon.</p>
          <ul className="cx-links-edit">
            {f.links.map((v, i) => {
              const d = describeLink(v);
              return (
                <li key={i}>
                  <span className="cx-links-ico" title={d ? d.platform : 'Not a link yet'}>
                    <Icon name={d && d.kind !== 'website' ? d.kind : 'link'} size={18} />
                  </span>
                  <label className="sr-only" htmlFor={`link-${i}`}>
                    Link {i + 1}
                  </label>
                  <input
                    id={`link-${i}`}
                    inputMode="url"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder="tiktok.com/@yourname"
                    value={v}
                    onChange={(e) => set('links', f.links.map((x, j) => (j === i ? e.target.value : x)))}
                  />
                  <button type="button" className="cx-icon-btn cx-icon-flat" aria-label={`Remove link ${i + 1}`} onClick={() => set('links', f.links.filter((_, j) => j !== i))}>
                    <Icon name="close" size={18} />
                  </button>
                  {v.trim() && (
                    <small className={d ? 'cx-links-ok' : 'cx-links-bad'}>{d ? `${d.platform} · ${d.label}` : 'Paste the full link, like tiktok.com/@yourname'}</small>
                  )}
                </li>
              );
            })}
          </ul>
          {f.links.length < 10 && (
            <button type="button" className="btn btn-light btn-sm cx-links-add" onClick={() => set('links', [...f.links, ''])}>
              <Icon name="plus" size={18} /> Add a link
            </button>
          )}
        </fieldset>

        {err && (
          <p className="cx-error" role="alert">
            {err}
          </p>
        )}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? (uploading > 0 ? 'Finishing photo upload…' : 'Saving…') : creating ? 'Create profile' : 'Save changes'}
        </button>
      </form>

      {me && !me.is_student && !me.is_sensei && (
        <div className="cx-panel cx-verify">
          <h2 className="cx-h2">Are you on Black Belt in Motion Design?</h2>
          <p className="cx-muted">If you enrolled with this email, check again. If you paid another way, enter the invite code from the community manager.</p>
          <button type="button" className="btn btn-light btn-sm" onClick={checkStudent}>
            Check my enrolment
          </button>
          <div className="cx-invite">
            <label className="sr-only" htmlFor="invite">
              Invite code
            </label>
            <input id="invite" placeholder="Invite code" value={invite} onChange={(e) => setInvite(e.target.value.toUpperCase())} />
            <button type="button" className="btn btn-primary btn-sm" disabled={!invite.trim()} onClick={useInvite}>
              Use code
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ================= Messages ================= */
function Gate({ profile = false }: { profile?: boolean }) {
  return (
    <Empty title={profile ? 'Finish your profile first' : 'Sign in to see your messages'}>
      <A path={profile ? '/settings' : '/login'} className="btn btn-primary btn-sm">
        {profile ? 'Set up profile' : 'Sign in'}
      </A>
    </Empty>
  );
}

export type { Profile };
