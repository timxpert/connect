/* Motion Dojo Connect: preview implementation of ConnectApi.
   Runs entirely in the browser with invented sample members so the site can
   be clicked through before Supabase is connected. Every sample profile is
   flagged `sample: true` and the UI labels it. Nothing here is real. */

import type { Assignment, BriefItem, Challenge, ChallengeEntry, Comment, ConnectApi, GroupMessage, ConnectionStatus, Conversation, Lesson, LessonInput, Message, Notice, Post, Profile } from './types';

const now = Date.now();
const ago = (h: number) => new Date(now - h * 3600_000).toISOString();
let seq = 1000;
const nid = () => `d${++seq}`;

/** Abstract sample artwork: keyframe dots on a motion curve, in the brand colours */
function art(bg: string, line: string, dot: string, bend: number) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800"><rect width="800" height="800" fill="${bg}"/><path d="M80 ${600 - bend} C 260 ${600 - bend}, 300 ${180 + bend}, 420 ${260 + bend / 2} S 640 ${560 - bend}, 720 ${200 + bend}" fill="none" stroke="${line}" stroke-width="10" stroke-linecap="round"/><g fill="${dot}"><rect x="64" y="${584 - bend}" width="32" height="32" rx="6" transform="rotate(45 80 ${600 - bend})"/><rect x="404" y="${244 + bend / 2}" width="32" height="32" rx="6" transform="rotate(45 420 ${260 + bend / 2})"/><rect x="704" y="${184 + bend}" width="32" height="32" rx="6" transform="rotate(45 720 ${200 + bend})"/></g><text x="400" y="740" font-family="sans-serif" font-size="30" fill="${line}" text-anchor="middle" opacity=".7">Sample post</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function profile(p: Partial<Profile> & Pick<Profile, 'id' | 'handle' | 'name'>): Profile {
  return {
    bio: '',
    avatar_url: null,
    cover_url: null,
    country: '',
    skills: [],
    phase: null,
    instagram: '',
    youtube: '',
    website: '',
    is_student: true,
    is_moderator: false,
    is_sensei: false,
    created_at: ago(24 * 30),
    sample: true,
    ...p,
  };
}

const people: Profile[] = [
  profile({ id: 's1', handle: 'sample_ada', name: 'Ada', country: 'Nigeria', phase: null, skills: ['Alight Motion', 'Typography'], bio: 'Sample profile for the preview. Practising kinetic type.' }),
  profile({ id: 's2', handle: 'sample_tunde', name: 'Tunde', country: 'Nigeria', phase: 3, skills: ['Logo animation', 'Transitions'], bio: 'Sample profile for the preview. Logo reveals and smooth transitions.' }),
  profile({ id: 's3', handle: 'sample_amaka', name: 'Amaka', country: 'Ghana', phase: 1, skills: ['Alight Motion', 'Graphic design'], bio: 'Sample profile for the preview. Graphic designer starting out with motion.' }),
  profile({ id: 's4', handle: 'sample_kemi', name: 'Kemi', country: 'Nigeria', phase: 4, skills: ['Product visuals', '2D animation', 'Sound design'], bio: 'Sample profile for the preview. Building my portfolio in phase four.' }),
  profile({ id: 's5', handle: 'sample_jide', name: 'Jide', country: 'Kenya', phase: null, phase_request: 2, phase_request_at: ago(3), skills: ['Video editing', 'AI video'], bio: 'Sample profile for the preview. Editor learning motion.' }),
  profile({ id: 'v1', handle: 'sample_visitor', name: 'Visitor', is_student: false, phase: null, bio: 'Sample visitor account for the preview.' }),
  profile({ id: 'g1', handle: 'sample_sensei', name: 'Grand Sensei', is_student: false, is_sensei: true, phase: null, bio: 'Sample grand sensei account for the preview.' }),
];

// Sample challenges: one open, one finished with a pick
const inDays = (d: number) => new Date(Date.now() + d * 86400000).toISOString();
let challenges: Omit<Challenge, 'entries'>[] = [
  { id: 'c2', number: 2, title: 'Logo bounce', brief: 'Sample brief: drop a logo in and settle it with a bounce. 5 seconds, keyframes only.', ends_at: inDays(3), pick_id: null, pick_note: '', created_at: ago(60 * 24 * 11) },
  { id: 'c1', number: 1, title: 'Text pop', brief: 'Sample brief: make one word pop onto the screen.', ends_at: inDays(-11), pick_id: 'e1', pick_note: 'Sample note: the squash on landing sells the weight.', created_at: ago(60 * 24 * 25) },
];
let entries: ChallengeEntry[] = [
  { id: 'e1', challenge_id: 'c1', user_id: 's2', url: 'https://youtu.be/dQw4w9WgXcQ', created_at: ago(60 * 24 * 14) },
  { id: 'e2', challenge_id: 'c1', user_id: 's3', url: 'https://youtu.be/dQw4w9WgXcQ', created_at: ago(60 * 24 * 13) },
  { id: 'e3', challenge_id: 'c2', user_id: 's2', url: 'https://youtu.be/dQw4w9WgXcQ', created_at: ago(60 * 5) },
  { id: 'e4', challenge_id: 'c2', user_id: 's4', url: 'https://youtu.be/dQw4w9WgXcQ', created_at: ago(60 * 2) },
];

type RawPost = Omit<Post, 'author' | 'likes' | 'comments' | 'liked' | 'saved'>;
let posts: RawPost[] = [
  { id: 'a1', author_id: 'g1', kind: 'image', media_url: art('#6d32e8', '#f7f5ff', '#c8ff3d', 30), caption: 'Sample community post: this week’s practice brief is a 5-second logo reveal. Post yours with the “I want feedback” tag by Friday.', tag: 'sharing', community: true, created_at: ago(2) },
  { id: 'p1', author_id: 's2', kind: 'image', media_url: art('#140a2e', '#a77bff', '#c8ff3d', 0), caption: 'Sample post: first logo reveal I’m happy with. The overshoot on the last keyframe took a while.', tag: 'sharing', community: false, created_at: ago(3) },
  { id: 'p2', author_id: 's1', kind: 'image', media_url: art('#6d32e8', '#f7f5ff', '#c8ff3d', 80), caption: 'Sample post: kinetic type practice. Does the ease feel too slow at the end?', tag: 'feedback', community: false, created_at: ago(9) },
  { id: 'p3', author_id: 's4', kind: 'image', media_url: art('#c8ff3d', '#140a2e', '#6d32e8', 40), caption: 'Sample post: product turn for my portfolio, phase four project.', tag: 'sharing', community: false, created_at: ago(26) },
  { id: 'p6', author_id: 's2', kind: 'image', media_url: art('#1d63d8', '#ffffff', '#c8ff3d', 90), caption: 'Sample final project: a 10-second logo reveal for a bakery.', tag: 'sharing', community: false, assignment_phase: 3, created_at: ago(200) },
  { id: 'p7', author_id: 's4', kind: 'image', media_url: art('#ef6c1a', '#140a2e', '#ffffff', 70), caption: 'Sample final project: animated explainer for a savings app.', tag: 'sharing', community: false, assignment_phase: 4, created_at: ago(400) },
  { id: 'p4', author_id: 's3', kind: 'image', media_url: art('#f6f4fb', '#6d32e8', '#140a2e', 120), caption: 'Sample post: day three of daily practice. Bouncing ball, take two.', tag: 'feedback', community: false, created_at: ago(50) },
  { id: 'p5', author_id: 's5', kind: 'image', media_url: art('#140a2e', '#c8ff3d', '#a77bff', 60), caption: 'Sample post: transition study between two scenes.', tag: 'sharing', community: false, created_at: ago(80) },
];
let likes = new Set<string>(['p1:s1', 'p1:s4', 'p2:s2', 'p3:s1', 'p3:s2', 'p3:s5']);
let comments: Omit<Comment, 'author'>[] = [
  { id: 'c1', post_id: 'p2', author_id: 's4', body: 'Sample comment: try a slightly faster ease-out on the last word.', created_at: ago(8) },
  { id: 'c2', post_id: 'p2', author_id: 's2', body: 'Sample comment: agree, the rest feels smooth.', created_at: ago(7) },
  { id: 'c3', post_id: 'p1', author_id: 's1', body: 'Sample comment: that overshoot is clean.', created_at: ago(2) },
];
/** requester:addressee -> status */
let links = new Map<string, 'pending' | 'accepted'>([
  ['s1:s2', 'accepted'],
  ['s4:s1', 'accepted'],
  ['s3:s1', 'pending'],
  ['s5:s3', 'accepted'],
]);
let saves = new Set<string>(['s1:p3']);
let notices: { id: string; user: string; kind: Notice['kind']; actor: string; post: string | null; read: boolean; at: string }[] = [
  { id: 'n1', user: 's1', kind: 'community_post', actor: 'g1', post: 'a1', read: false, at: ago(2) },
  { id: 'n2', user: 's1', kind: 'connection_request', actor: 's3', post: null, read: false, at: ago(4) },
];
const linkOf = (x: string, y: string) => (links.has(`${x}:${y}`) ? `${x}:${y}` : links.has(`${y}:${x}`) ? `${y}:${x}` : null);
const notify = (user: string, kind: Notice['kind'], actor: string, post: string | null = null) =>
  notices.unshift({ id: nid(), user, kind, actor, post, read: false, at: new Date().toISOString() });
let blocks = new Set<string>();
let convs: { id: string; a: string; b: string; last: string }[] = [{ id: 'm1', a: 's1', b: 's2', last: ago(5) }, { id: 'm2', a: 'g1', b: 's3', last: ago(3) }];
let messages: Message[] = [
  { id: 'x1', conversation_id: 'm1', sender_id: 's2', body: 'Sample message: how did you get that text bounce?', created_at: ago(6) },
  { id: 'x2', conversation_id: 'm1', sender_id: 's1', body: 'Sample message: graph editor, overshoot on the second keyframe.', created_at: ago(5) },
  { id: 'xj', conversation_id: 'm2', sender_id: 's3', body: 'joined the community', kind: 'join' as Message['kind'], created_at: ago(3) },
];

let current: string | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());
const wait = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 120));
const who = (id: string) => people.find((p) => p.id === id)!;

function full(p: RawPost): Post {
  const all = [...likes].filter((k) => k.startsWith(p.id + ':'));
  return {
    ...p,
    author: who(p.author_id),
    likes: all.length,
    comments: comments.filter((c) => c.post_id === p.id).length,
    liked: current ? likes.has(`${p.id}:${current}`) : false,
    saved: current ? saves.has(`${current}:${p.id}`) : false,
  };
}
/* Sample lessons for the preview */
type RawLesson = Omit<Lesson, 'done' | 'open' | 'has_video'> & { video_url: string; notes: string; files: { name: string; url: string }[] };
const sampleTitles = [
  ['Getting around Alight Motion', 'Keyframes and easing', 'Your first logo reveal'],
  ['Masks and blending', 'Text animation', 'Camera moves'],
  ['From brief to storyboard', 'Timing to music', 'Client-style project'],
  ['Building your portfolio piece', 'Presenting your work'],
];
let lessons: RawLesson[] = sampleTitles.flatMap((titles, ph) =>
  titles.map((t, i) => ({
    id: `l${ph + 1}${i + 1}`,
    phase: ph + 1,
    position: i + 1,
    title: t,
    summary: 'Sample lesson for the preview.',
    duration: `${8 + ((ph * 3 + i) % 5) * 3} min`,
    published: !(ph === 3 && i === 1),
    video_url: '',
    size_mb: 40 + ((ph * 3 + i) % 5) * 15,
    notes: 'Sample notes for the preview.\nWhat you’ll practise in this lesson goes here.',
    files: i === 0 ? [{ name: 'Sample project file', url: 'https://example.com' }] : [],
  })),
);
lessons.filter((l) => l.phase === 2).slice(1).forEach((l) => (l.section = 'Background music'));
lessons.unshift({ id: 'l01', phase: 0, position: 1, title: 'Welcome to Black Belt', summary: 'Sample orientation video for the preview.', duration: '6 min', published: true, video_url: '', size_mb: 30, notes: '', files: [] });
const progress = new Set<string>(['s1:l11', 's1:l12']);
let assignments: Assignment[] = [];
type RawGroup = Omit<GroupMessage, 'sender' | 'reactions'>;
let group: RawGroup[] = [
  { id: 'g1m', conversation_id: 'group', sender_id: 'g1', body: 'Sample message: welcome to the Dojo group. Say hi and share what you’re working on.', kind: 'text', created_at: ago(30) },
  { id: 'gjn', conversation_id: 'group', sender_id: 's3', body: '', kind: 'join' as RawGroup['kind'], created_at: ago(20) },
  { id: 'g2m', conversation_id: 'group', sender_id: 's2', body: 'Sample message: anyone tried the new easing presets?', kind: 'text', created_at: ago(5) },
  { id: 'g3m', conversation_id: 'group', sender_id: 's4', body: 'Sample message: yes, the bounce one is great for logo reveals.', kind: 'text', reply_to: 'g2m', created_at: ago(4) },
];
const groupRx = new Map<string, string>([['g1m:s2', '🔥'], ['g1m:s4', '🔥'], ['g3m:s2', '👍']]);
const groupSet = { announce_only: false, pinned_id: 'g1m' as string | null, history: 'all' as 'all' | '14d' | '100' | 'none', name: 'Dojo group', photo_url: null as string | null };
const groupMutes = new Map<string, number>();
/** removed from the group: id -> banned */
const groupOut = new Map<string, boolean>();
let groupReadAt = ago(6);
// The Grand Sensei's own groups (demo)
type OwnGroup = { id: string; name: string; photo_url: string | null; announce_only: boolean; pinned_id: string | null; history: 'all' | '14d' | '100' | 'none'; people: Map<string, { added: string; read: string | null; muted: number }>; msgs: RawGroup[]; created_at: string };
const ownGroups: OwnGroup[] = [];
let pins: string[] = [];
const invites = new Map<string, { gid: string; message: string; expires: number }>();
const og = (gid: string) => {
  const g = ownGroups.find((x) => x.id === gid);
  if (!g) throw new Error('This group no longer exists.');
  return g;
};
const briefItems: Record<number, BriefItem[]> = {};
const briefs: Record<number, string> = { 1: 'Sample brief: animate a 5-second logo reveal using what you learned in phase 1.' };

function outline(): Lesson[] {
  const me = current ? who(current) : null;
  const team = Boolean(me && (me.is_sensei || me.is_moderator));
  const learner = Boolean(me && (me.is_student || team));
  const list = lessons.filter((l) => l.published || team).sort((a, b) => a.phase - b.phase || a.position - b.position);
  return list.map((l, i) => {
    const done = Boolean(current && progress.has(`${current}:${l.id}`));
    const prev = list[i - 1];
    // nothing opens until the phase is confirmed; then every phase before it, and lesson by lesson inside it
    const cur = me?.is_student ? me.phase : null;
    const prevDone = (l.phase === 0 && Boolean(me?.is_student)) || Boolean(cur) && (l.phase < cur! || (l.phase === cur && (!prev || prev.phase !== l.phase || Boolean(current && progress.has(`${current}:${prev.id}`)))));
    const { video_url, notes, files, ...rest } = l;
    void notes;
    void files;
    return { ...rest, has_video: Boolean(video_url), done, open: team || (learner && prevDone) };
  });
}

const needMe = () => {
  if (!current) throw new Error('Sign in first.');
  return current;
};

export function createDemoApi(): ConnectApi {
  const addPeople = (gid: string, ids: string[]) => {
    const g = og(gid);
    let n = 0;
    for (const id of ids) {
      if (g.people.has(id)) continue;
      const now = new Date().toISOString();
      g.people.set(id, { added: now, read: null, muted: 0 });
      g.msgs.push({ id: nid(), conversation_id: `g:${gid}`, sender_id: id, body: '', kind: 'join', created_at: now } as unknown as RawGroup);
      n++;
    }
    return n;
  };
  return {
    mode: 'demo',
    session: () => wait(current ? { userId: current, email: `${who(current).handle}@example.com` } : null),
    onAuthChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    async signIn() {
      throw new Error('Email sign-in works once Supabase is connected. In this preview, use the sample accounts below.');
    },
    async studentSignIn() {
      throw new Error('Student ID sign-in works once Supabase is connected. In this preview, use the sample accounts below.');
    },
    subscribe: () => () => {},
    typingListen(room, cb) {
      // sample: someone types for a few seconds after you open the group or a chat
      const sample = room === 'g:main' ? { chat: 'group', id: 's2', name: who('s2').name } : null;
      if (!sample) return () => {};
      const a = window.setTimeout(() => cb({ ...sample, on: true }), 1200);
      const b = window.setTimeout(() => cb({ ...sample, on: false }), 6000);
      return () => {
        window.clearTimeout(a);
        window.clearTimeout(b);
      };
    },
    typingSend() {},
    presence: (cb) => {
      // Preview: Tunde is online, everyone else was seen a while ago
      const t = window.setTimeout(() => cb(new Set(['s2', ...(current ? [current] : [])])), 200);
      return () => window.clearTimeout(t);
    },
    async demoSignIn(as) {
      current = as === 'student' ? 's1' : as === 'sensei' ? 'g1' : 'v1';
      emit();
    },
    async signOut() {
      current = null;
      emit();
    },

    me: () => wait(current ? { ...who(current) } : null),
    async createProfile(input) {
      throw new Error(`Profiles are created after email sign-in. (${input.handle})`);
    },
    async updateProfile(input) {
      const me = who(needMe());
      if (input.handle && input.handle !== me.handle && people.some((p) => p.handle === input.handle)) {
        throw new Error('That username is taken. Try another.');
      }
      // the phase is set by the team, not from Edit profile
      const { phase: _phase, ...rest } = input;
      void _phase;
      Object.assign(me, rest);
      if (!me.is_student) me.phase = null;
      return wait(me);
    },
    refreshStudentStatus: () => wait(Boolean(current && who(current).is_student)),
    redeemInvite: () => wait(false),
    async uploadImage(file, _folder, onProgress) {
      // Pretend upload so the preview shows the progress bar
      for (let i = 1; i <= 8; i++) {
        await new Promise((r) => setTimeout(r, 120));
        onProgress?.(i / 8);
      }
      if (file.type.startsWith('video/')) return URL.createObjectURL(file);
      return new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error('Could not read that image.'));
        r.readAsDataURL(file);
      });
    },

    listStudents(f) {
      const q = (f.q || '').toLowerCase();
      return wait(
        people.filter(
          (p) =>
            p.is_student &&
            (!f.skill || p.skills.includes(f.skill)) &&
            (!f.phase || (p.phase === f.phase && p.phase_public !== false)) &&
            (!q || `${p.name} ${p.handle} ${p.country}`.toLowerCase().includes(q)),
        ),
      );
    },
    getProfile: (h) => wait(people.find((p) => p.handle === h.toLowerCase()) ?? null),
    counts: (id) =>
      wait({
        connections: [...links].filter(([k, v]) => v === 'accepted' && k.split(':').includes(id)).length,
        posts: posts.filter((p) => p.author_id === id && !p.community).length,
      }),
    connectionStatus(id): Promise<ConnectionStatus> {
      if (!current) return wait('none');
      const k = linkOf(current, id);
      if (!k) return wait('none');
      if (links.get(k) === 'accepted') return wait('connected');
      return wait(k.startsWith(current + ':') ? 'requested' : 'incoming');
    },
    async requestConnection(id) {
      const me = needMe();
      if (linkOf(me, id)) throw new Error('There’s already a request between you two.');
      if (blocks.has(`${me}:${id}`) || blocks.has(`${id}:${me}`)) throw new Error('You can’t connect with this member.');
      links.set(`${me}:${id}`, 'pending');
      notify(id, 'connection_request', me);
    },
    async answerRequest(id, accept) {
      const me = needMe();
      const k = `${id}:${me}`;
      if (!links.has(k)) return;
      notices = notices.filter((n) => !(n.user === me && n.actor === id && n.kind === 'connection_request'));
      if (accept) {
        links.set(k, 'accepted');
        notify(id, 'connection_accepted', me);
      } else links.delete(k);
    },
    async removeConnection(id) {
      const k = linkOf(needMe(), id);
      if (k) links.delete(k);
    },
    listConnections() {
      const me = needMe();
      return wait([...links].filter(([k, v]) => v === 'accepted' && k.split(':').includes(me)).map(([k]) => who(k.split(':').find((x) => x !== me)!)));
    },
    listRequests() {
      const me = needMe();
      const pend = [...links].filter(([, v]) => v === 'pending').map(([k]) => k.split(':'));
      return wait({
        incoming: pend.filter(([, b]) => b === me).map(([a]) => who(a)),
        sent: pend.filter(([a]) => a === me).map(([, b]) => who(b)),
      });
    },
    listNotices() {
      const me = needMe();
      return wait(
        notices
          .filter((n) => n.user === me)
          .map<Notice>((n) => ({ id: n.id, kind: n.kind, actor: who(n.actor), post_id: n.post, read_at: n.read ? n.at : null, created_at: n.at })),
      );
    },
    unreadMessageCount: () => wait(current ? messages.filter((m) => m.sender_id !== current && !m.read_at && !m.deleted_at && convs.some((c) => c.id === m.conversation_id && (c.a === current || c.b === current))).length : 0),
    unreadCount: () => wait(current ? notices.filter((n) => n.user === current && !n.read).length : 0),
    async markNoticesRead() {
      const me = needMe();
      notices = notices.map((n) => (n.user === me ? { ...n, read: true } : n));
    },

    listPosts({ authorId, feed = 'everyone' }) {
      let list = [...posts].sort((a, b) => b.created_at.localeCompare(a.created_at));
      if (authorId) list = list.filter((p) => p.author_id === authorId && !p.community);
      else list = list.filter((p) => p.community === (feed === 'community'));
      if (feed === 'connections' && !authorId) {
        const me = needMe();
        list = list.filter((p) => links.get(linkOf(me, p.author_id) ?? '') === 'accepted');
      }
      return wait(list.map(full));
    },
    listSaved() {
      const me = needMe();
      return wait(posts.filter((p) => saves.has(`${me}:${p.id}`)).map(full));
    },
    async setSaved(postId, on) {
      const k = `${needMe()}:${postId}`;
      if (on) saves.add(k);
      else saves.delete(k);
    },
    getPost: (id) => wait(posts.find((p) => p.id === id) ? full(posts.find((p) => p.id === id)!) : null),
    async createPost(input) {
      const me = who(needMe());
      const community = Boolean(input.community);
      if (community && !me.is_sensei) throw new Error('Only the grand sensei can post to the Community feed.');
      if (!community && !me.is_student && !me.is_sensei) throw new Error('Only members can post work.');
      const p: RawPost = { id: nid(), author_id: me.id, created_at: new Date().toISOString(), ...input, community };
      posts = [p, ...posts];
      if (community) people.filter((x) => x.is_student).forEach((x) => notify(x.id, 'community_post', me.id, p.id));
      return full(p);
    },
    async deletePost(id) {
      posts = posts.filter((p) => p.id !== id);
    },
    async setLike(postId, on) {
      const k = `${postId}:${needMe()}`;
      if (on) likes.add(k);
      else likes.delete(k);
    },
    listLikers: (postId) =>
      wait(
        [...likes]
          .filter((k) => k.startsWith(`${postId}:`))
          .map((k) => who(k.split(':')[1]))
          .filter(Boolean),
      ),
    listComments: (postId) =>
      wait(comments.filter((c) => c.post_id === postId).map((c) => ({ ...c, author: who(c.author_id) }))),
    async addComment(postId, body) {
      const c = { id: nid(), post_id: postId, author_id: needMe(), body, created_at: new Date().toISOString() };
      comments = [...comments, c];
      return { ...c, author: who(c.author_id) };
    },
    async deleteComment(id) {
      comments = comments.filter((c) => c.id !== id);
    },

    listConversations() {
      const me = needMe();
      const mine = convs
        .filter((c) => c.a === me || c.b === me)
        .sort((x, y) => y.last.localeCompare(x.last))
        .map<Conversation>((c) => {
          const last = messages.filter((m) => m.conversation_id === c.id).slice(-1)[0];
          const unread = messages.filter((m) => m.conversation_id === c.id && m.sender_id !== me && !m.read_at && !m.deleted_at).length;
          const body = !last ? '' : (last.kind as string) === 'join' ? (last.sender_id === me ? 'You joined the community' : 'Joined the community') : last.deleted_at ? 'Message deleted' : last.kind === 'voice' ? 'Voice message' : last.kind === 'file' ? last.file_name || 'File' : last.kind === 'image' ? last.body || 'Photo' : last.kind === 'video' ? last.body || 'Video' : last.body;
          return {
            id: c.id,
            other: who(c.a === me ? c.b : c.a),
            last_message_at: c.last,
            last_body: body,
            unread,
            last_kind: last?.kind ?? 'text',
            last_mine: last?.sender_id === me,
            last_delivered: Boolean(last?.delivered_at),
            last_read: Boolean(last?.read_at),
            last_deleted: Boolean(last?.deleted_at),
          };
        });
      return wait(mine);
    },
    async openConversation(userId) {
      const me = needMe();
      if (blocks.has(`${me}:${userId}`) || blocks.has(`${userId}:${me}`)) throw new Error('You can’t message this member.');
      const found = convs.find((c) => (c.a === me && c.b === userId) || (c.a === userId && c.b === me));
      if (found) return found.id;
      const inGroup = (id: string) => { const p = who(id); return p.is_student || p.is_sensei || p.is_moderator; };
      if (links.get(linkOf(me, userId) ?? '') !== 'accepted' && !(inGroup(me) && inGroup(userId))) throw new Error('Connect with this member before messaging them.');
      const c = { id: nid(), a: me, b: userId, last: new Date().toISOString() };
      convs = [...convs, c];
      return c.id;
    },
    getConversation(id) {
      const me = needMe();
      const c = convs.find((x) => x.id === id && (x.a === me || x.b === me));
      return wait(c ? { id: c.id, other: who(c.a === me ? c.b : c.a), last_message_at: c.last, last_body: '' } : null);
    },
    listMessages: (id) => wait(messages.filter((m) => m.conversation_id === id).map((m) => ({ ...m }))),
    async sendMessage(id, body, quote, forwarded) {
      const m: Message = { id: nid(), conversation_id: id, sender_id: needMe(), body, quote: quote ?? null, forwarded: forwarded ?? false, created_at: new Date().toISOString(), kind: 'text' };
      messages = [...messages, m];
      convs = convs.map((c) => (c.id === id ? { ...c, last: m.created_at } : c));
      // Pretend the other person's phone receives it, then they read it
      setTimeout(() => (m.delivered_at = new Date().toISOString()), 1500);
      setTimeout(() => (m.read_at = new Date().toISOString()), 5000);
      return m;
    },
    async sendAttachment(id, a, caption, onProgress, forwarded) {
      for (let i = 1; i <= 6; i++) {
        await new Promise((r) => setTimeout(r, 100));
        onProgress?.(i / 6);
      }
      const m: Message = {
        id: nid(),
        conversation_id: id,
        sender_id: needMe(),
        body: caption,
        created_at: new Date().toISOString(),
        kind: a.kind,
        media_path: `demo/${a.file.name}`,
        media_url: URL.createObjectURL(a.file),
        file_name: a.kind === 'file' ? a.file.name : null,
        file_size: a.file.size,
        duration: a.duration ?? null,
        thumb: a.thumb ?? null,
        forwarded: forwarded ?? false,
      };
      messages = [...messages, m];
      setTimeout(() => (m.delivered_at = new Date().toISOString()), 1500);
      return m;
    },
    async reactMessage(mid, emoji) {
      const me = needMe();
      messages = messages.map((m) => {
        if (m.id !== mid) return m;
        let rx = ((m as Message).reactions ?? []).map((r) => (r.mine ? { ...r, count: r.count - 1, mine: false, who: (r.who ?? []).filter((w) => w !== me) } : r)).filter((r) => r.count > 0);
        if (emoji) {
          const e = rx.find((r) => r.emoji === emoji);
          rx = e ? rx.map((r) => (r.emoji === emoji ? { ...r, count: r.count + 1, mine: true, who: [...(r.who ?? []), me] } : r)) : [...rx, { emoji, count: 1, mine: true, who: [me] }];
        }
        return { ...m, reactions: rx };
      });
    },
    async editMessage(mid, body) {
      const me = needMe();
      messages = messages.map((m) => (m.id === mid && m.sender_id === me ? { ...m, body, edited_at: new Date().toISOString() } : m));
    },
    async deleteMessage(mid) {
      const me = needMe();
      messages = messages.map((m) =>
        m.id === mid && m.sender_id === me ? { ...m, deleted_at: new Date().toISOString(), body: '', media_path: null, media_url: null, file_name: null } : m,
      );
    },
    async markRead(id) {
      const me = needMe();
      const now = new Date().toISOString();
      messages.forEach((m) => {
        if (m.conversation_id === id && m.sender_id !== me && !m.read_at) {
          m.read_at = now;
          m.delivered_at = m.delivered_at ?? now;
        }
      });
    },
    async markDelivered() {},

    async report() {
      needMe();
    },
    async setBlock(id, on) {
      const k = `${needMe()}:${id}`;
      if (on) {
        blocks.add(k);
        const l = linkOf(needMe(), id);
        if (l) links.delete(l);
      }
      else blocks.delete(k);
    },
    isBlocked: (id) => wait(Boolean(current && blocks.has(`${current}:${id}`))),

    listLessons: () => wait(outline()),
    async groupInfo(gid) {
      if (gid) {
        const g = ownGroups.find((x) => x.id === gid);
        const mine = g && current ? g.people.get(current) : undefined;
        if (!g || (!mine && !(current && who(current).is_sensei))) return null;
        return wait({ members: g.people.size, announce_only: g.announce_only, pinned_id: g.pinned_id, pinned_by: (g as unknown as { pinned_by?: string | null }).pinned_by ?? null, history: g.history, name: g.name, photo_url: g.photo_url, muted_until: mine && mine.muted > Date.now() ? new Date(mine.muted).toISOString() : null });
      }
      const me = current ? who(current) : null;
      if (!me || !(me.is_student || me.is_sensei || me.is_moderator) || groupOut.has(me.id)) return null;
      const until = groupMutes.get(me.id);
      return wait({ members: people.filter((p) => p.is_student || p.is_sensei).length, ...groupSet, muted_until: until && until > Date.now() ? new Date(until).toISOString() : null });
    },
    listGroupMessages: (gid) =>
      wait(
        (gid ? og(gid).msgs : group).map((m) => {
          const rx = [...groupRx].filter(([k]) => k.startsWith(m.id + ':'));
          const list: { emoji: string; count: number; mine: boolean; who: string[] }[] = [];
          for (const [k, e] of rx) {
            const x = list.find((y) => y.emoji === e) ?? (list.push({ emoji: e, count: 0, mine: false, who: [] }), list[list.length - 1]);
            x.count += 1;
            x.who.push(k.slice(k.indexOf(':') + 1));
            if (k.endsWith(':' + current)) x.mine = true;
          }
          return { ...m, sender: who(m.sender_id), reactions: list };
        }),
      ),
    async groupPreview() {
      const m = group[group.length - 1];
      const unread = group.filter((x) => x.sender_id !== current && x.created_at > groupReadAt).length;
      return wait(m ? { name: groupSet.name, photo_url: groupSet.photo_url, text: `${who(m.sender_id).name}: ${m.body || 'Photo'}`, at: m.created_at, unread } : null);
    },
    async sendGroupMessage(body, replyTo, forwarded, gid) {
      const me = needMe();
      if (gid) {
        const g = og(gid);
        if ((g.announce_only && !who(me).is_sensei) || (g.people.get(me)?.muted ?? 0) > Date.now()) throw new Error('You can’t send messages in the group right now.');
        const m: RawGroup = { id: nid(), conversation_id: `g:${gid}`, sender_id: me, body, kind: 'text', reply_to: replyTo ?? null, forwarded: forwarded ?? false, created_at: new Date().toISOString() };
        g.msgs.push(m);
        return wait({ ...m, sender: who(me), reactions: [] });
      }
      if (groupSet.announce_only && !who(me).is_sensei) throw new Error('You can’t send messages in the group right now.');
      if ((groupMutes.get(me) ?? 0) > Date.now()) throw new Error('You can’t send messages in the group right now.');
      const m: RawGroup = { id: nid(), conversation_id: 'group', sender_id: me, body, kind: 'text', reply_to: replyTo ?? null, forwarded: forwarded ?? false, created_at: new Date().toISOString() };
      group.push(m);
      return wait({ ...m, sender: who(me), reactions: [] });
    },
    async sendGroupAttachment(a, caption, replyTo, onProgress, forwarded, gid) {
      const me = needMe();
      onProgress?.(1);
      const m: RawGroup = { id: nid(), conversation_id: gid ? `g:${gid}` : 'group', sender_id: me, body: caption, kind: a.kind, file_name: a.kind === 'file' ? a.file.name : null, media_url: URL.createObjectURL(a.file), file_size: a.file.size, duration: a.duration, thumb: a.thumb, reply_to: replyTo ?? null, forwarded: forwarded ?? false, created_at: new Date().toISOString() };
      (gid ? og(gid).msgs : group).push(m);
      return wait({ ...m, sender: who(me), reactions: [] });
    },
    async editGroupMessage(id, body) {
      const edit = (m: RawGroup) => (m.id === id ? { ...m, body, edited_at: new Date().toISOString() } : m);
      group = group.map(edit);
      for (const g of ownGroups) g.msgs = g.msgs.map(edit);
    },
    async deleteGroupMessage(id) {
      for (const g of ownGroups) g.msgs = g.msgs.map((m) => (m.id === id ? { ...m, deleted_at: new Date().toISOString(), body: '', media_url: null } : m));
      group = group.map((m) => (m.id === id ? { ...m, deleted_at: new Date().toISOString(), body: '', media_url: null } : m));
    },
    async reactGroup(id, emoji) {
      const k = `${id}:${needMe()}`;
      if (emoji) groupRx.set(k, emoji);
      else groupRx.delete(k);
    },
    groupLastRead: async (gid) => (gid ? (og(gid).people.get(current ?? '')?.read ?? null) : groupReadAt),
    async groupReaders(gid) {
      if (gid) return [...og(gid).people].filter(([id, x]) => id !== current && x.read).map(([id, x]) => ({ id, name: who(id).name, avatar_url: who(id).avatar_url ?? null, read_at: x.read! }));
      const soon = new Date(Date.now() + 60_000).toISOString();
      const ppl = people.filter((p) => p.id !== current).slice(0, 3);
      return ppl.map((p, i) => ({ id: p.id, name: p.name, avatar_url: p.avatar_url ?? null, read_at: i === 2 ? new Date(Date.now() - 3 * 3600_000).toISOString() : soon }));
    },
    async markGroupRead(gid) {
      if (gid) {
        const x = og(gid).people.get(current ?? '');
        if (x) x.read = new Date().toISOString();
        return;
      }
      groupReadAt = new Date().toISOString();
    },
    async setGroupSettings(s, gid) {
      const me = needMe();
      // pinning: remember who, and add "X pinned a message"
      const pinNote = (target: { pinned_by?: string | null; pinned_at?: string | null }, list: RawGroup[]) => {
        if (!('pinned_id' in s)) return;
        target.pinned_by = s.pinned_id ? me : null;
        target.pinned_at = s.pinned_id ? new Date().toISOString() : null;
        if (s.pinned_id) list.push({ id: nid(), conversation_id: gid ? `g:${gid}` : 'group', sender_id: me, body: '', kind: 'pin', reply_to: s.pinned_id, created_at: new Date().toISOString() } as unknown as RawGroup);
      };
      if (gid) {
        if (!who(me).is_sensei) throw new Error('Only the Grand Sensei can change this group.');
        Object.assign(og(gid), s);
        pinNote(og(gid) as unknown as { pinned_by?: string | null }, og(gid).msgs);
        return;
      }
      Object.assign(groupSet, s);
      pinNote(groupSet as unknown as { pinned_by?: string | null }, group);
    },
    groupMembers: (gid) => gid ? wait([...og(gid).people.keys()].map(who)) : wait(people.filter((p) => (p.is_student || p.is_sensei || p.is_moderator) && !groupOut.has(p.id))),
    groupStatus: async (gid) => {
      if (gid) return 'none';
      if (!current) return 'none';
      const out = groupOut.get(current);
      if (out !== undefined) return out ? 'banned' : 'removed';
      const p = who(current);
      return p.is_student || p.is_sensei || p.is_moderator ? 'member' : 'none';
    },
    async rejoinGroup() {
      const me = needMe();
      if (groupOut.get(me)) throw new Error('You can’t join the group right now.');
      groupOut.delete(me);
    },
    async removeFromGroup(userId, ban, gid) {
      if (gid) {
        og(gid).people.delete(userId);
        return;
      }
      groupOut.set(userId, ban);
    },
    async addToGroup(userId, gid) {
      if (gid) {
        addPeople(gid, [userId]);
        return;
      }
      groupOut.delete(userId);
    },
    groupRemoved: (gid) => gid ? wait([]) : wait([...groupOut].map(([id, banned]) => ({ profile: who(id), banned }))),
    async muteInGroup(userId, hours, gid) {
      if (gid) {
        const x = og(gid).people.get(userId);
        if (x) x.muted = hours > 0 ? Date.now() + hours * 3600_000 : 0;
        return;
      }
      if (hours > 0) groupMutes.set(userId, Date.now() + hours * 3600_000);
      else groupMutes.delete(userId);
    },
    listPins: () => wait([...pins]),
    async setPin(chat, on) {
      if (on && !pins.includes(chat)) {
        if (pins.length >= 5 && !who(needMe()).is_sensei) throw new Error('You can pin up to 5 chats.');
        pins.push(chat);
      }
      if (!on) pins = pins.filter((c) => c !== chat);
    },
    myGroups: () =>
      wait(
        ownGroups
          .filter((g) => current && g.people.has(current))
          .map((g) => {
            const last = g.msgs[g.msgs.length - 1];
            const read = g.people.get(current!)!.read ?? g.people.get(current!)!.added;
            return {
              id: g.id,
              name: g.name,
              photo_url: g.photo_url,
              text: !last ? 'No messages yet' : (last.kind as string) === 'join' ? `${who(last.sender_id).name} joined the group` : `${who(last.sender_id).name}: ${last.deleted_at ? 'Message deleted' : last.body || 'Photo'}`,
              at: last?.created_at ?? g.created_at,
              unread: g.msgs.filter((m) => m.sender_id !== current && (m.kind as string) !== 'join' && m.created_at > read).length,
            };
          })
          .sort((a, b) => (a.at < b.at ? 1 : -1)),
      ),
    async createGroup(name, photoUrl) {
      const me = needMe();
      if (!who(me).is_sensei) throw new Error('Only the Grand Sensei can create groups.');
      const now = new Date().toISOString();
      const g: OwnGroup = { id: nid(), name: name.slice(0, 60), photo_url: photoUrl ?? null, announce_only: false, pinned_id: null, history: 'all', people: new Map([[me, { added: now, read: now, muted: 0 }]]), msgs: [], created_at: now };
      ownGroups.push(g);
      return g.id;
    },
    async deleteGroup(gid) {
      const i = ownGroups.findIndex((g) => g.id === gid);
      if (i >= 0) ownGroups.splice(i, 1);
    },
    addPeopleToGroup: async (gid, ids) => addPeople(gid, ids),
    async leaveGroup(gid) {
      og(gid).people.delete(needMe());
    },
    async createInvite(gid, message) {
      og(gid);
      const t = Math.random().toString(36).slice(2, 12);
      invites.set(t, { gid, message, expires: Date.now() + 3 * 864e5 });
      return t;
    },
    async getInvite(token) {
      const i = invites.get(token);
      const g = i && ownGroups.find((x) => x.id === i.gid);
      if (!i || !g) return null;
      const sensei = people.find((p) => p.is_sensei);
      return wait({ gid: g.id, name: g.name, photo_url: g.photo_url, message: i.message, expires_at: new Date(i.expires).toISOString(), members: g.people.size, sender: sensei?.name ?? null, expired: i.expires < Date.now(), joined: Boolean(current && g.people.has(current)) });
    },
    async joinInvite(token) {
      const i = invites.get(token);
      if (!i) throw new Error('This invite link isn’t valid.');
      if (i.expires < Date.now()) throw new Error('This invite link has expired. Ask the Grand Sensei for a new one.');
      const p = who(needMe());
      if (!(p.is_student || p.is_sensei || p.is_moderator)) throw new Error('Groups are for Motion Dojo students. Sign in with your student ID first.');
      addPeople(i.gid, [p.id]);
      return i.gid;
    },
    myAssignments: () => wait(assignments.filter((a) => a.user_id === current)),
    async submitAssignment(phase, kind, mediaUrl, caption) {
      const me = needMe();
      if (outline().some((l) => l.phase === phase && l.published && !l.done)) throw new Error('finish_lessons');
      if (assignments.some((a) => a.user_id === me && a.phase === phase && a.status !== 'changes')) throw new Error('already_sent');
      assignments.unshift({ id: nid(), user_id: me, phase, kind, media_url: mediaUrl, caption, status: 'pending', feedback: '', reviewed_at: null, post_id: null, created_at: new Date().toISOString() });
    },
    getBriefs: () => wait({ ...briefs }),
    async saveBrief(phase, brief, items) {
      briefs[phase] = brief;
      if (items) briefItems[phase] = items;
    },
    getBriefItems: () => wait({ ...briefItems }),
    async uploadBriefFile(file, onProgress) {
      onProgress?.(1);
      return URL.createObjectURL(file);
    },
    async enablePush() {
      return false;
    },
    async testPush() {
      return { ok: false, why: 'Notifications work on the real site, not in this preview.' };
    },
    async setTeamRole(userId, role) {
      const p = who(userId);
      p.team_role = role;
      p.is_moderator = Boolean(role);
    },
    teamRoles: () => wait(Object.fromEntries(people.filter((p) => p.team_role).map((p) => [p.id, p.team_role!]))),
    listChallenges: () =>
      wait([...challenges].sort((a, b) => b.ends_at.localeCompare(a.ends_at)).map((c) => ({ ...c, entries: entries.filter((e) => e.challenge_id === c.id).length }))),
    listEntries(challengeId) {
      const me = current ? who(current) : null;
      const insider = Boolean(me && (me.is_student || me.is_sensei || me.is_moderator));
      const picks = new Set(challenges.map((c) => c.pick_id));
      return wait(entries.filter((e) => e.challenge_id === challengeId && (insider || picks.has(e.id))).map((e) => ({ ...e, user: who(e.user_id) })));
    },
    async submitEntry(challengeId, url) {
      const me = needMe();
      const c = challenges.find((x) => x.id === challengeId);
      if (!c || c.ends_at < new Date().toISOString()) throw new Error('This challenge has closed.');
      const old = entries.find((e) => e.challenge_id === challengeId && e.user_id === me);
      if (old) Object.assign(old, { url, created_at: new Date().toISOString() });
      else entries.push({ id: nid(), challenge_id: challengeId, user_id: me, url, created_at: new Date().toISOString() });
    },
    async removeEntry(entryId) {
      entries = entries.filter((e) => e.id !== entryId);
    },
    async saveChallenge(c) {
      if (c.id) Object.assign(challenges.find((x) => x.id === c.id)!, { title: c.title, brief: c.brief, ends_at: c.ends_at });
      else challenges.unshift({ id: nid(), number: Math.max(0, ...challenges.map((x) => x.number)) + 1, title: c.title, brief: c.brief, ends_at: c.ends_at, pick_id: null, pick_note: '', created_at: new Date().toISOString() });
    },
    async deleteChallenge(id) {
      challenges = challenges.filter((c) => c.id !== id);
    },
    async pickEntry(challengeId, entryId, note) {
      Object.assign(challenges.find((x) => x.id === challengeId)!, { pick_id: entryId, pick_note: note });
    },
    challengeStats() {
      const now = new Date().toISOString();
      const list = [...challenges].sort((a, b) => b.ends_at.localeCompare(a.ends_at));
      const cur = [...challenges].filter((c) => c.ends_at > now).sort((a, b) => a.ends_at.localeCompare(b.ends_at))[0];
      const me = current ? who(current) : null;
      const insider = Boolean(me && (me.is_student || me.is_sensei || me.is_moderator));
      return wait(
        people.filter((p) => p.is_student).map((p) => {
          let streak = 0;
          for (const c of list) {
            if (entries.some((e) => e.challenge_id === c.id && e.user_id === p.id)) streak++;
            else if (c.ends_at > now) continue;
            else break;
          }
          const picks = challenges.filter((c) => entries.some((e) => e.id === c.pick_id && e.user_id === p.id)).length;
          return { user_id: p.id, streak, picks, entered_current: insider && cur ? entries.some((e) => e.challenge_id === cur.id && e.user_id === p.id) : null };
        }),
      );
    },
    listProjects: (phase) => wait(posts.filter((p) => p.assignment_phase === phase).map(full)),
    async requestPhase(phase) {
      const me = who(needMe());
      if (me.phase) throw new Error('Your phase is already confirmed. Ask the Grand Sensei if it needs to change.');
      me.phase_request = phase;
      me.phase_request_at = new Date().toISOString();
      me.phase_declined_at = null;
    },
    phaseRequests: () =>
      wait(
        people
          .filter((p) => p.is_student && p.phase_request)
          .map((p) => ({ id: p.id, name: p.name, handle: p.handle, avatar_url: p.avatar_url, phase_request: p.phase_request!, phase_request_at: p.phase_request_at ?? new Date().toISOString() })),
      ),
    async setStudentPhase(userId, phase) {
      const p = who(userId);
      p.phase = phase;
      p.phase_request = null;
      p.phase_declined_at = phase ? null : new Date().toISOString();
    },
    reviewQueue: () => wait(assignments.map((a) => ({ ...a, student: who(a.user_id) }))),
    async reviewAssignment(id, approve, note) {
      const a = assignments.find((x) => x.id === id);
      if (!a) return;
      a.status = approve ? 'approved' : 'changes';
      a.feedback = note;
      a.reviewed_at = new Date().toISOString();
      if (approve) {
        const pid = nid();
        posts.unshift({ id: pid, author_id: a.user_id, kind: a.kind, media_url: a.media_url, caption: a.caption, tag: 'sharing', community: false, assignment_phase: a.phase, created_at: new Date().toISOString() });
        a.post_id = pid;
        const s = who(a.user_id);
        s.phase = Math.min(4, Math.max(s.phase ?? 1, a.phase + 1));
      }
    },
    claimDevice: async () => {},
    checkDevice: async () => true,
    teamDevices: () => wait(people.filter((p) => p.is_student || (p as Profile & { banned?: boolean }).banned).map((p, i) => ({ banned: Boolean((p as Profile & { banned?: boolean }).banned), user_id: p.id, name: p.name, handle: p.handle, email: `${p.handle}@example.com`, label: i % 2 ? 'Android · Chrome' : 'iPhone · Safari', last_seen_at: ago(i), changes_7d: i === 1 ? 6 : 1 }))),
    resetMemberId: async () => 'MD-SAMP-LE00',
    async banUser(userId, on) {
      const p = who(userId);
      (p as Profile & { banned?: boolean }).banned = on;
      p.is_student = !on;
    },
    async removeUser(userId) {
      const i = people.findIndex((p) => p.id === userId);
      if (i >= 0) people.splice(i, 1);
      posts = posts.filter((p) => p.author_id !== userId);
    },
    async getLesson(id) {
      const me = current ? who(current) : null;
      if (!me || !(me.is_student || me.is_sensei || me.is_moderator)) throw new Error('members_only');
      const o = outline().find((l) => l.id === id);
      const raw = lessons.find((l) => l.id === id);
      if (!o || !raw) throw new Error('not_found');
      if (!o.open) throw new Error('locked');
      return wait({ ...o, portrait: raw.portrait ?? true, images: raw.images ?? [], section: raw.section ?? '', video_url: raw.video_url, notes: raw.notes, files: raw.files });
    },
    async setLessonDone(id, done) {
      const me = needMe();
      if (!outline().find((l) => l.id === id)?.open) throw new Error('locked');
      if (done) progress.add(`${me}:${id}`);
      else progress.delete(`${me}:${id}`);
    },
    async saveLesson(input: LessonInput) {
      const me = who(needMe());
      if (!me.is_sensei && !me.is_moderator) throw new Error('team_only');
      let id = input.id;
      // after the last lesson of its section, or at the end of the phase
      const slot = (selfId?: string) => {
        const rows = lessons.filter((l) => l.phase === input.phase && l.id !== selfId).sort((a, b) => a.position - b.position);
        const sec = input.section.trim();
        const inSec = sec ? rows.filter((l) => (l.section ?? '').trim() === sec) : [];
        if (!inSec.length) return (rows.at(-1)?.position ?? 0) + 1;
        const pos = inSec[inSec.length - 1].position + 1;
        rows.filter((l) => l.position >= pos).forEach((l) => (l.position += 1));
        return pos;
      };
      if (id) {
        const l = lessons.find((x) => x.id === id);
        if (l) {
          const moved = l.phase !== input.phase || (l.section ?? '').trim() !== input.section.trim();
          Object.assign(l, { ...input, id });
          if (moved) l.position = slot(id);
        }
      } else {
        id = nid();
        const position = slot();
        lessons.push({ ...input, id, position });
      }
      return this.getLesson(id);
    },
    async deleteLesson(id) {
      lessons = lessons.filter((l) => l.id !== id);
    },
    async moveLesson(id, dir) {
      const l = lessons.find((x) => x.id === id);
      if (!l) return;
      const same = lessons.filter((x) => x.phase === l.phase).sort((a, b) => a.position - b.position);
      const i = same.indexOf(l);
      const j = i + dir;
      if (j < 0 || j >= same.length) return;
      [same[i].position, same[j].position] = [same[j].position, same[i].position];
    },
  };
}
