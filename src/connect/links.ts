/* Profile links: people paste any link and Connect recognises the platform. */

export type LinkKind =
  | 'instagram'
  | 'youtube'
  | 'tiktok'
  | 'linkedin'
  | 'facebook'
  | 'x'
  | 'behance'
  | 'dribbble'
  | 'github'
  | 'threads'
  | 'vimeo'
  | 'pinterest'
  | 'whatsapp'
  | 'website';

export type ProfileLink = { kind: LinkKind; href: string; label: string; platform: string };

const PLATFORMS: { kind: LinkKind; name: string; hosts: string[] }[] = [
  { kind: 'instagram', name: 'Instagram', hosts: ['instagram.com', 'instagr.am'] },
  { kind: 'youtube', name: 'YouTube', hosts: ['youtube.com', 'youtu.be'] },
  { kind: 'tiktok', name: 'TikTok', hosts: ['tiktok.com'] },
  { kind: 'linkedin', name: 'LinkedIn', hosts: ['linkedin.com', 'lnkd.in'] },
  { kind: 'facebook', name: 'Facebook', hosts: ['facebook.com', 'fb.com', 'fb.me'] },
  { kind: 'x', name: 'X', hosts: ['x.com', 'twitter.com'] },
  { kind: 'behance', name: 'Behance', hosts: ['behance.net'] },
  { kind: 'dribbble', name: 'Dribbble', hosts: ['dribbble.com'] },
  { kind: 'github', name: 'GitHub', hosts: ['github.com'] },
  { kind: 'threads', name: 'Threads', hosts: ['threads.net', 'threads.com'] },
  { kind: 'vimeo', name: 'Vimeo', hosts: ['vimeo.com'] },
  { kind: 'pinterest', name: 'Pinterest', hosts: ['pinterest.com', 'pin.it'] },
  { kind: 'whatsapp', name: 'WhatsApp', hosts: ['wa.me', 'whatsapp.com'] },
];

/** "tiktok.com/@ada" or "https://www.tiktok.com/@ada/" -> a URL, or null if it isn't a link */
export function normaliseLink(raw: string): URL | null {
  const t = raw.trim();
  if (!t || /\s/.test(t)) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) return null;
    return u;
  } catch {
    return null;
  }
}

export function describeLink(raw: string): ProfileLink | null {
  const u = normaliseLink(raw);
  if (!u) return null;
  const host = u.hostname.replace(/^(www|m|mobile|web)\./, '').toLowerCase();
  const p = PLATFORMS.find((x) => x.hosts.some((h) => host === h || host.endsWith(`.${h}`)));
  const parts = u.pathname.split('/').filter(Boolean);
  const href = u.href.replace(/\/$/, '');
  if (!p) {
    const path = parts.length ? `/${parts.join('/')}` : '';
    return { kind: 'website', href, label: `${host}${path}`.slice(0, 40), platform: 'Website' };
  }
  // A readable handle where the platform has one
  let label = p.name;
  const first = parts[0] ?? '';
  if (['instagram', 'tiktok', 'x', 'threads', 'github', 'behance', 'dribbble', 'pinterest', 'vimeo'].includes(p.kind) && first) {
    const h = first.replace(/^@/, '');
    if (!['p', 'reel', 'video', 'status', 'share', 'gallery', 'shots', 'channels'].includes(h)) label = `@${h}`;
  } else if (p.kind === 'youtube' && first.startsWith('@')) label = first;
  else if (p.kind === 'linkedin' && ['in', 'company'].includes(first) && parts[1]) label = parts[1];
  else if (p.kind === 'facebook' && first && first !== 'profile.php') label = first;
  return { kind: p.kind, href, label, platform: p.name };
}

/** Old single fields (Instagram, YouTube, website) as links */
export function legacyLinks(p: { instagram?: string; youtube?: string; website?: string }) {
  const out: string[] = [];
  const handle = (v: string) => v.trim().replace(/^@/, '');
  if (p.instagram?.trim()) out.push(/\./.test(p.instagram) ? p.instagram.trim() : `instagram.com/${handle(p.instagram)}`);
  if (p.youtube?.trim()) out.push(/\./.test(p.youtube) ? p.youtube.trim() : `youtube.com/@${handle(p.youtube)}`);
  if (p.website?.trim()) out.push(p.website.trim());
  return out;
}

/** Everything a profile links to, newest list first, no duplicates */
export function profileLinks(p: { links?: string[] | null; instagram?: string; youtube?: string; website?: string }): ProfileLink[] {
  const seen = new Set<string>();
  return [...(p.links ?? []), ...legacyLinks(p)]
    .map(describeLink)
    .filter((l): l is ProfileLink => {
      if (!l || seen.has(l.href.toLowerCase())) return false;
      seen.add(l.href.toLowerCase());
      return true;
    });
}
