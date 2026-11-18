'use client';

import React, { useState } from 'react';
import { onLinkClick, to } from './router';
import { useConnect } from './context';
import { isTall, timeAgo, toEmbed } from './media';
import { PHASES, type Post, type Profile } from './types';
import { play } from './sounds';

/* ---------- Icons: one outline set on a 24px grid ---------- */
const PATHS = {
  home: <path d="M4 10.5 12 4l8 6.5V20h-5v-6h-6v6H4z" />,
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    </>
  ),
  clip: <path d="m20 11.5-7.8 7.8a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.4 8.4a1.7 1.7 0 0 1-2.4-2.4l7.7-7.7" />,
  trash: <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5M14 11v5" />,
  file: (
    <>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4M9 13h6M9 16.5h6" />
    </>
  ),
  play: <path d="M8 5.5v13l10.5-6.5z" />,
  pause: <path d="M8 5v14M16 5v14" />,
  tick: <path d="m4.5 12.5 4.5 4.5 10-10" />,
  download: <path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" />,
  tiktok: (
    <>
      <path d="M14 3.5v11a3.5 3.5 0 1 1-3.5-3.5" />
      <path d="M14 3.5c.4 2.6 2.2 4.3 5 4.5" />
    </>
  ),
  linkedin: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <path d="M8 10.5V16M8 7.9v.1M11.5 16v-5.5M11.5 13c0-1.6 1-2.6 2.4-2.6s2.1.9 2.1 2.6V16" />
    </>
  ),
  facebook: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M14.6 8.4h-1.3a1.8 1.8 0 0 0-1.8 1.8v10.3M9.4 13.2h4.9" />
    </>
  ),
  x: <path d="M4.5 4.5h3.8l11.2 15h-3.8zM19 4.5l-5.8 6.6M10.6 13.2 5 19.5" />,
  behance: <path d="M3.5 6.5h4.8a2.5 2.5 0 0 1 0 5H3.5zM3.5 11.5h5.4a2.75 2.75 0 0 1 0 5.5H3.5zM15 7.5h5M14.2 13.6h6.8a3.4 3.4 0 1 0-1 2.5" />,
  dribbble: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M5 7.4c4.2 1 9 .4 13.4-2M3.6 12.6c5-1.4 11-1 16.6 2M8.8 3.9c2.6 3 4.6 9 5.6 16" />
    </>
  ),
  github: (
    <path d="M9 19.5c-4 1.2-4-2-5.6-2.4m11.2 4.4v-3.2a2.8 2.8 0 0 0-.8-2.2c2.7-.3 5.6-1.3 5.6-6a4.6 4.6 0 0 0-1.3-3.2 4.3 4.3 0 0 0-.1-3.2s-1-.3-3.3 1.2a11.4 11.4 0 0 0-6 0C6.5 3.4 5.4 3.7 5.4 3.7a4.3 4.3 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 10.1c0 4.7 2.9 5.7 5.6 6a2.8 2.8 0 0 0-.8 2.2v3.2" />
  ),
  threads: <path d="M16.5 10.8C16 7.6 14.2 6 11.8 6 8.6 6 6.5 8.6 6.5 12s2.1 6 5.6 6c2.8 0 4.7-1.6 4.7-4 0-2.2-1.8-3.4-4.3-3.4-2 0-3.3 1-3.3 2.4 0 1.3 1.1 2.1 2.5 2.1 2.2 0 3.3-1.8 3.3-4.6" />,
  vimeo: <path d="M3.5 8.5c1.5-1.2 2.8-2.5 4-2.3 1.6.2 1.7 2.4 2.2 5 .5 2.6.9 4 1.6 4 .8 0 2.6-2.7 3.4-4.6.8-1.9-.3-3-1.9-2 .9-3 3.6-4.3 5.3-3.6 1.6.7 1.5 3.4-.4 6.8-2 3.5-4.6 6.7-6.7 6.7-2 0-2.8-3.8-3.4-6.5-.6-2.6-1-3.6-1.6-3.6-.4 0-1.2.6-1.9 1.1z" />,
  pinterest: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M10.6 20.2 12.4 13M12.4 13c-.6-2.5.4-4.6 2.4-4.6 1.6 0 2.3 1.3 2.1 2.8-.3 2.2-1.6 3.8-3.2 3.8-1 0-1.6-.7-1.3-2" />
    </>
  ),
  whatsapp: (
    <>
      <path d="M4 20l1.2-3.8A8.5 8.5 0 1 1 8 19z" />
      <path d="M9 8.5c0 3.5 2.9 6.5 6.4 6.5l1-1.5-2-1-1 .8c-1.1-.5-2-1.4-2.5-2.5l.8-1-1-2z" />
    </>
  ),
  crown: <path d="M4 18.5h16l1-11-5 4-4-6-4 6-5-4z" />,
  seal: (
    <>
      <path d="M12 2.5l2.2 1.6 2.7-.2.9 2.5 2.3 1.4-.6 2.7 1 2.5-2 1.8-.4 2.7-2.7.6L14 21.5l-2-1-2 1-1.4-2.4-2.7-.6-.4-2.7-2-1.8 1-2.5-.6-2.7 2.3-1.4.9-2.5 2.7.2z" />
      <path d="m8.8 12.2 2.2 2.2 4.2-4.4" />
    </>
  ),
  ticks: <path d="m2 12.5 4.5 4.5 10-10M11.5 16.5l.5.5 10-10" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4.5l3 1.8" />
    </>
  ),
  share: (
    <>
      <circle cx="18" cy="5.5" r="2.5" />
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="18.5" r="2.5" />
      <path d="m8.2 10.8 7.6-4.1M8.2 13.2l7.6 4.1" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3 19.5c.6-3.2 3-5 6-5s5.4 1.8 6 5M15.5 5.6a3 3 0 0 1 0 5.8M17.5 14.8c1.9.6 3.1 2.2 3.5 4.7" />
    </>
  ),
  chat: <path d="M4 5h16v11H9l-5 4z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  heart: <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />,
  comment: <path d="M5 5h14v10H10l-5 4z" />,
  send: <path d="M4 12 20 4l-6 16-3-7z" />,
  back: <path d="M15 5l-7 7 7 7" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1.2" fill="currentColor" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" />
      <circle cx="19" cy="12" r="1.2" fill="currentColor" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-4.5-4.5" />
    </>
  ),
  image: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m4 18 5-5 4 4 2.5-2.5L20 19" />
    </>
  ),
  video: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="m10.5 9.5 4 2.5-4 2.5z" fill="currentColor" stroke="none" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20c1-3.6 3.7-5.5 7-5.5s6 1.9 7 5.5" />
    </>
  ),
  instagram: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  youtube: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="4" />
      <path d="m10 9 5 3-5 3z" fill="currentColor" stroke="none" />
    </>
  ),
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
  belt: (
    <>
      <circle cx="12" cy="9" r="5.5" />
      <path d="m8.6 13.4-1.6 7.1 5-2.6 5 2.6-1.6-7.1" />
    </>
  ),
  out: <path d="M7 17 17 7M9 7h8v8" />,
  obi: (
    <>
      <path d="M2.5 9.5h19v4h-19z" />
      <rect x="9.5" y="8" width="5" height="7" rx="1.2" />
      <path d="m10.4 15-1.9 5.5M13.6 15l1.9 5.5" />
    </>
  ),
  bookmark: <path d="M6.5 4h11v16l-5.5-4-5.5 4z" />,
  bell: <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0" />,
  link2: (
    <>
      <circle cx="8" cy="12" r="4" />
      <circle cx="16" cy="12" r="4" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
};
export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 22, filled = false }: { name: IconName; size?: number; filled?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

/* ---------- Links that switch pages without a reload ---------- */
export function A({ path, className, children, ...rest }: { path: string; className?: string; children: React.ReactNode } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  return (
    <a href={to(path)} className={className} onClick={(e) => onLinkClick(e, path)} {...rest}>
      {children}
    </a>
  );
}

/* ---------- Sharing: the phone's share sheet, or copy the link ---------- */
export async function shareLink(path: string, title: string, toast: (m: string) => void) {
  const url = new URL(to(path), window.location.href).href;
  const nav = navigator as Navigator & { share?: (d: { title?: string; url?: string }) => Promise<void> };
  if (nav.share) {
    try {
      await nav.share({ title, url });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied');
  } catch {
    window.prompt('Copy this link', url);
  }
}

/* ---------- People ---------- */
const TINTS = ['#6d32e8', '#140a2e', '#a77bff', '#2b1a5c'];
export function Avatar({ p, size = 44 }: { p: Pick<Profile, 'name' | 'avatar_url' | 'handle'>; size?: number }) {
  const initials = p.name
    .replace(/\(.*?\)/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  const tint = TINTS[[...p.handle].reduce((n, c) => n + c.charCodeAt(0), 0) % TINTS.length];
  return p.avatar_url ? (
    <img className="cx-avatar" src={p.avatar_url} alt="" width={size} height={size} style={{ width: size, height: size }} />
  ) : (
    <span className="cx-avatar cx-avatar-initials" aria-hidden="true" style={{ width: size, height: size, background: tint, fontSize: size * 0.38 }}>
      {initials || '?'}
    </span>
  );
}

/** Belt by Black Belt phase: White → Yellow → Green → Black */
export const BELTS = ['White Belt', 'Yellow Belt', 'Green Belt', 'Black Belt'];

/** The phase this viewer may see: members only, and only if the student keeps it public (the team sees all). */
export function visiblePhase(p: Pick<Profile, 'id' | 'phase' | 'phase_public'>, viewer: Profile | null | undefined): number | null {
  if (!p.phase || !viewer) return null;
  if (viewer.id === p.id || viewer.is_sensei || viewer.is_moderator) return p.phase;
  if (!viewer.is_student) return null;
  return p.phase_public === false ? null : p.phase;
}

export function BeltBadge({ p, small = false }: { p: Pick<Profile, 'id' | 'phase' | 'phase_public'>; small?: boolean }) {
  const { me } = useConnect();
  const phase = visiblePhase(p, me);
  const belt = phase ? BELTS[phase - 1] : null;
  if (!belt) return null;
  const cls = ['cx-badge', small ? 'cx-badge-sm' : '', `cx-belt cx-belt-${phase}`].filter(Boolean).join(' ');
  return (
    <span className={cls} title={`${belt}: phase ${phase}, ${PHASES[phase! - 1]}`}>
      <Icon name="obi" size={small ? 13 : 15} />
      {small ? <span className="sr-only">{belt}</span> : belt}
    </span>
  );
}

/** The Grand Sensei's crown: a filled two-tone mark, unlike the outline icons used for members */
export function Crown({ size = 16 }: { size?: number }) {
  const id = React.useId();
  return (
    <svg className="cx-crown" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d9c8ff" />
          <stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      <path d="M3.2 8.6a1 1 0 0 1 1.6-.9l3.6 2.9 2.8-4.9a1 1 0 0 1 1.6 0l2.8 4.9 3.6-2.9a1 1 0 0 1 1.6.9l-1.1 9.6a1.6 1.6 0 0 1-1.6 1.4H5.9a1.6 1.6 0 0 1-1.6-1.4z" fill={`url(#${id})`} />
      <rect x="8.4" y="13.2" width="2.2" height="3.2" rx="1.1" fill="#2b1666" />
      <rect x="13.4" y="13.2" width="2.2" height="3.2" rx="1.1" fill="#2b1666" />
    </svg>
  );
}

export function SenseiBadge() {
  return (
    <span className="cx-badge cx-badge-sensei" title="Grand Sensei of Motion Dojo">
      <Crown size={15} />
      Grand Sensei
    </span>
  );
}

export function SampleTag() {
  return <span className="cx-sample">Sample</span>;
}

/** Four steps of Black Belt, filled up to the student's current phase */
export function PhaseTrack({ phase }: { phase: number }) {
  return (
    <div className="cx-phases" aria-label={`Black Belt phase ${phase} of 4: ${PHASES[phase - 1]}`}>
      <ol aria-hidden="true">
        {PHASES.map((t, i) => (
          <li key={t} className={i < phase ? 'is-done' : ''} />
        ))}
      </ol>
      <span>
        Phase {phase}: {PHASES[phase - 1]}
      </span>
    </div>
  );
}

export function PersonLine({ p, when }: { p: Profile; when?: string }) {
  return (
    <A path={`/u/${p.handle}`} className="cx-person">
      <Avatar p={p} size={40} />
      <span className="cx-person-text">
        <span className="cx-person-name">
          {p.name}
          {p.is_sensei && <SenseiBadge />}
          {p.is_student && !p.is_sensei && <BeltBadge p={p} small />}
          {p.sample && <SampleTag />}
        </span>
        <span className="cx-person-meta">
          @{p.handle}
          {when && <> · {timeAgo(when)}</>}
        </span>
      </span>
    </A>
  );
}

/* ---------- Media ---------- */
/** Uploaded video files (not share links) play in a plain <video> */
/** Bios are 150 characters at most; longer ones (written before the limit) are cut at the last whole word */
export const BIO_MAX = 150;
export function shortBio(bio: string | null | undefined) {
  const b = (bio ?? '').trim();
  if (b.length <= BIO_MAX) return b;
  const cut = b.slice(0, BIO_MAX);
  const space = cut.lastIndexOf(' ');
  return (space > 100 ? cut.slice(0, space) : cut).replace(/[\s,;:–-]+$/, '') + '…';
}

export const isVideoFile = (url: string) => /\.(mp4|mov|webm|m4v)(\?|$)/i.test(url) || url.startsWith('blob:');

export function Media({ post, priority = false }: { post: Pick<Post, 'kind' | 'media_url' | 'caption'>; priority?: boolean }) {
  const url = post.media_url;
  if (post.kind === 'text' || !url) return null;
  if (post.kind === 'image') {
    return (
      <div className="cx-media">
        <img src={url} alt={post.caption ? post.caption.slice(0, 120) : 'Posted work'} loading={priority ? 'eager' : 'lazy'} />
      </div>
    );
  }
  if (isVideoFile(url)) {
    return (
      <div className="cx-media cx-media-file">
        <video src={url} controls playsInline preload="metadata" />
      </div>
    );
  }
  const embed = toEmbed(url);
  if (!embed) {
    return (
      <a className="cx-media cx-media-link" href={url} target="_blank" rel="noopener noreferrer">
        <Icon name="video" size={28} />
        Watch the video
      </a>
    );
  }
  return (
    <div className={isTall(url) ? 'cx-media cx-media-tall' : 'cx-media cx-media-wide'}>
      <iframe src={embed} title="Posted video" loading="lazy" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowFullScreen />
    </div>
  );
}

/* ---------- Posts ---------- */
export function LikeButton({ post, onChange }: { post: Post; onChange?: (p: Post) => void }) {
  const { api, signedIn, toast } = useConnect();
  const [state, setState] = useState({ liked: post.liked, likes: post.likes });
  const [pop, setPop] = useState(false);
  const toggle = async () => {
    if (!signedIn) {
      toast('Only members can like posts.');
      return;
    }
    const next = { liked: !state.liked, likes: state.likes + (state.liked ? -1 : 1) };
    setState(next);
    if (next.liked) {
      play('like');
      setPop(true);
      window.setTimeout(() => setPop(false), 500);
    }
    try {
      await api.setLike(post.id, next.liked);
      onChange?.({ ...post, ...next });
    } catch (e) {
      setState(state);
      toast((e as Error).message);
    }
  };
  return (
    <button
      type="button"
      className={['cx-act', state.liked ? 'is-liked' : '', pop ? 'is-pop' : ''].join(' ').trim()}
      onClick={toggle}
      aria-pressed={state.liked}
      aria-label={state.liked ? 'Unlike' : 'Like'}
    >
      <Icon name="heart" filled={state.liked} />
      <span>{state.likes}</span>
    </button>
  );
}

export function SaveButton({ post }: { post: Post }) {
  const { api, signedIn, me, toast } = useConnect();
  const [saved, setSaved] = useState(post.saved);
  if (signedIn && me && me.id === post.author_id) return null;
  const toggle = async () => {
    if (!signedIn || !me) {
      toast('Only members can save projects.');
      return;
    }
    setSaved(!saved);
    try {
      await api.setSaved(post.id, !saved);
      toast(saved ? 'Removed from Saved.' : 'Saved. Find it under Saved in your menu.');
    } catch (e) {
      setSaved(saved);
      toast((e as Error).message);
    }
  };
  return (
    <button type="button" className={saved ? 'cx-act is-saved' : 'cx-act'} onClick={toggle} aria-pressed={saved} aria-label={saved ? 'Remove from saved' : 'Save project'}>
      <Icon name="bookmark" filled={saved} />
    </button>
  );
}

export const POST_DELETED = 'cx:post-deleted';

/** ⋯ on a post: delete for its author and moderators, report for other members */
export function PostMenu({ post, onDeleted }: { post: Post; onDeleted?: () => void }) {
  const { api, me, toast, ask } = useConnect();
  const [open, setOpen] = useState(false);
  const member = Boolean(me && (me.is_student || me.is_sensei || me.is_moderator));
  const own = Boolean(me && me.id === post.author_id);
  const canDelete = member && (own || me!.is_moderator || me!.is_sensei);

  const remove = async () => {
    setOpen(false);
    if (!(await ask({ title: 'Delete this post?', body: 'Its likes and comments go too. This can’t be undone.', confirm: 'Delete', danger: true }))) return;
    try {
      await api.deletePost(post.id);
      window.dispatchEvent(new CustomEvent(POST_DELETED, { detail: post.id }));
      toast('Post deleted');
      onDeleted?.();
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const report = async () => {
    setOpen(false);
    const reason = await ask({ title: 'Report this post', body: 'A moderator will look at it. The member won’t see who reported them.', input: 'What’s wrong?', confirm: 'Send report' });
    if (!reason) return;
    await api.report('post', post.id, reason);
    toast('Thanks. A moderator will take a look.');
  };

  return (
    <div className="cx-menu cx-post-menu">
      <button type="button" className="cx-icon-btn cx-icon-flat" aria-label="Post options" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="more" />
      </button>
      {open && (
        <>
          <div className="cx-menu-scrim" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="cx-menu-list" role="menu">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                shareLink(`/p/${post.id}`, `${post.author.name} on Motion Dojo Connect`, toast);
              }}
            >
              Share post
            </button>
            {canDelete && (
              <button type="button" role="menuitem" className="cx-danger" onClick={remove}>
                Delete post
              </button>
            )}
            {member && !own && (
              <button type="button" role="menuitem" onClick={report}>
                Report post
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function PostCard({ post }: { post: Post }) {
  return (
    <article className={['cx-post', post.community ? 'cx-post-community' : '', (post as Post & { fresh?: boolean }).fresh ? 'cx-post-fresh' : ''].filter(Boolean).join(' ')}>
      <header className="cx-post-head">
        <PersonLine p={post.author} when={post.created_at} />
        {post.community ? <span className="cx-tag">Community</span> : post.tag === 'feedback' && <span className="cx-tag">Wants feedback</span>}
        <PostMenu post={post} />
      </header>
      {post.caption && (
        <A path={`/p/${post.id}`} className="cx-caption-link">
          <p className="cx-caption">{post.caption}</p>
        </A>
      )}
      {post.kind === 'image' ? (
        <A path={`/p/${post.id}`} className="cx-post-media" aria-label="Open post">
          <Media post={post} />
        </A>
      ) : (
        <Media post={post} />
      )}
      <footer className="cx-post-actions">
        <LikeButton post={post} />
        <A path={`/p/${post.id}`} className="cx-act" aria-label={`${post.comments} comments`}>
          <Icon name="comment" />
          <span>{post.comments}</span>
        </A>
        <span className="cx-spacer" />
        <SaveButton post={post} />
      </footer>
    </article>
  );
}

/* ---------- States ---------- */
export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="cx-loading" role="status">
      <span className="cx-spinner" aria-hidden="true" />
      {label}…
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="cx-empty">
      <p className="cx-empty-title">{title}</p>
      {children}
    </div>
  );
}
