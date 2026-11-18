/* Motion Dojo Connect: Supabase implementation of ConnectApi.
   Every rule (who can post, message, delete) is enforced by row-level security
   in supabase/schema.sql; this file only shapes the data for the UI. */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { prepareImage } from './resize';
import type { Comment, ConnectApi, ConnectionStatus, Conversation, Lesson, Message, Notice, Post, Profile, ProfileInput, StudentFilter } from './types';

/** Shown when the database is missing the chat changes */
const NEEDS_UPDATE = 'Voice notes and files need the latest database update. Run supabase/update-all.sql in Supabase, then try again.';

const POST_SELECT = '*, author:profiles!posts_author_id_fkey(*)';

function fail(error: { message: string } | null) {
  if (!error) return;
  throw new Error(error.message);
}

export function createLiveApi(url: string, anonKey: string, redirectTo: string): ConnectApi {
  const sb: SupabaseClient = createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  const uid = async () => (await sb.auth.getSession()).data.session?.user.id ?? null;
  const needUid = async () => {
    const id = await uid();
    if (!id) throw new Error('Sign in first.');
    return id;
  };

  /** Adds like/comment counts and "liked/saved by me" to raw post rows */
  async function decorate(rows: (Omit<Post, 'likes' | 'comments' | 'liked' | 'saved'>)[]): Promise<Post[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const me = await uid();
    const none = Promise.resolve({ data: [] });
    const [{ data: stats }, mine, saves] = await Promise.all([
      sb.from('post_stats').select('*').in('post_id', ids),
      me ? sb.from('likes').select('post_id').eq('user_id', me).in('post_id', ids) : none,
      me ? sb.from('bookmarks').select('post_id').eq('user_id', me).in('post_id', ids) : none,
    ]);
    const saved = new Set(((saves as unknown as { data: { post_id: string }[] | null }).data ?? []).map((b) => b.post_id));
    const byId = new Map<string, { likes: number; comments: number }>(
      ((stats ?? []) as unknown as { post_id: string; likes: number; comments: number }[]).map((s) => [s.post_id, s]),
    );
    const liked = new Set(((mine as unknown as { data: { post_id: string }[] | null }).data ?? []).map((l) => l.post_id));
    return rows.map((r) => ({
      ...r,
      likes: Number(byId.get(r.id)?.likes ?? 0),
      comments: Number(byId.get(r.id)?.comments ?? 0),
      liked: liked.has(r.id),
      saved: saved.has(r.id),
    }));
  }

  /** Sends a file with real progress (XHR, not fetch) */
  function xhrSend(method: 'POST' | 'PUT', target: string, headers: Record<string, string>, file: Blob, onProgress?: (share: number) => void, bucket = '') {
    return new Promise<void>((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open(method, target);
      for (const [k, v] of Object.entries(headers)) x.setRequestHeader(k, v);
      x.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress?.(e.loaded / e.total);
      };
      x.onload = () => {
        if (x.status >= 200 && x.status < 300) {
          onProgress?.(1);
          return resolve();
        }
        let msg = `Upload failed (${x.status}). Try again.`;
        try {
          const body = JSON.parse(x.responseText) as { message?: string; error?: string };
          const why = body.message || body.error || '';
          if (/size|large|maximum/i.test(why)) msg = 'That file is too big to upload.';
          else if (/bucket not found/i.test(why)) msg = NEEDS_UPDATE;
          else if (/row-level security|policy|unauthorized/i.test(why)) msg = bucket === 'chat' ? NEEDS_UPDATE : 'You don’t have permission to upload this.';
          else if (why) msg = `Upload failed: ${why}`;
        } catch {
          /* R2 answers in XML; keep the default */
        }
        reject(new Error(msg));
      };
      x.onerror = () => reject(new Error('Upload failed. Check your connection and try again.'));
      x.send(file);
    });
  }

  /** Uploads into a Supabase Storage bucket */
  async function xhrUpload(bucket: string, path: string, file: Blob, onProgress?: (share: number) => void) {
    const token = (await sb.auth.getSession()).data.session?.access_token;
    if (!token) throw new Error('Sign in first.');
    await xhrSend(
      'POST',
      `${url}/storage/v1/object/${bucket}/${path}`,
      {
        Authorization: `Bearer ${token}`,
        apikey: anonKey,
        'x-upsert': 'false',
        'cache-control': 'max-age=31536000',
        'Content-Type': file.type || 'application/octet-stream',
      },
      file,
      onProgress,
      bucket,
    );
  }

  /* Cloudflare R2 for videos and chat files (more free space than Supabase).
     The server signs a one-time upload link; until R2 is set up it answers 503
     and everything quietly goes to Supabase as before. */
  let r2Off = false;
  const authHeader = async () => {
    const token = (await sb.auth.getSession()).data.session?.access_token;
    if (!token) throw new Error('Sign in first.');
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  };
  async function r2Upload(purpose: 'video' | 'chat', file: File, onProgress?: (share: number) => void, conversationId?: string) {
    if (r2Off) return null;
    const res = await fetch('/api/r2/upload', {
      method: 'POST',
      headers: await authHeader(),
      body: JSON.stringify({ purpose, conversationId, name: file.name, type: file.type, size: file.size }),
    }).catch(() => null);
    if (!res || res.status === 503 || res.status === 404) {
      r2Off = true;
      return null;
    }
    const data = (await res.json().catch(() => null)) as { uploadUrl?: string; key?: string; publicUrl?: string | null; error?: string } | null;
    if (!res.ok || !data?.uploadUrl || !data.key) throw new Error(data?.error || 'Upload failed. Try again.');
    try {
      await xhrSend('PUT', data.uploadUrl, { 'Content-Type': file.type || 'application/octet-stream' }, file, onProgress);
    } catch (e) {
      // R2 refused (usually a missing CORS rule or a wrong key): use Supabase for the rest of this visit
      console.warn('[connect] R2 upload failed, using Supabase instead:', (e as Error).message);
      r2Off = true;
      onProgress?.(0);
      return null;
    }
    return { key: data.key, publicUrl: data.publicUrl ?? null };
  }

  // Signed links for private chat files, reused until shortly before they expire
  // (re-signing on every poll would reload voice notes and photos)
  const signed = new Map<string, { url: string; until: number }>();
  async function sign(paths: string[]) {
    const now = Date.now();
    const need = [...new Set(paths)].filter((p) => (signed.get(p)?.until ?? 0) <= now);
    const fromR2 = need.filter((p) => p.startsWith('r2:'));
    const fromSupabase = need.filter((p) => !p.startsWith('r2:'));
    if (fromSupabase.length) {
      const { data } = await sb.storage.from('chat').createSignedUrls(fromSupabase, 6 * 3600);
      for (const d of (data ?? []) as unknown as { path: string | null; signedUrl: string }[]) {
        if (d.path && d.signedUrl) signed.set(d.path, { url: d.signedUrl, until: now + 5 * 3600 * 1000 });
      }
    }
    if (fromR2.length) {
      const res = await fetch('/api/r2/read', {
        method: 'POST',
        headers: await authHeader(),
        body: JSON.stringify({ keys: fromR2.map((p) => p.slice(3)) }),
      }).catch(() => null);
      const body = (res && res.ok ? await res.json().catch(() => null) : null) as { urls?: Record<string, string> } | null;
      for (const [k, u] of Object.entries(body?.urls ?? {})) signed.set(`r2:${k}`, { url: u, until: now + 5 * 3600 * 1000 });
    }
    return (p: string) => signed.get(p)?.url ?? null;
  }

  const preview = (m: { body: string; kind?: string; file_name?: string | null; deleted_at?: string | null }) =>
    m.deleted_at
      ? 'Message deleted'
      : m.kind === 'voice'
        ? 'Voice message'
        : m.kind === 'image'
          ? m.body || 'Photo'
          : m.kind === 'video'
            ? m.body || 'Video'
            : m.kind === 'file'
              ? m.file_name || 'File'
              : m.body;

  // Faster single-request reads, used once the database has the speed update
  let fastFeed = true;
  let fastInbox = true;

  const api: ConnectApi = {
    mode: 'live',

    async session() {
      const s = (await sb.auth.getSession()).data.session;
      return s ? { userId: s.user.id, email: s.user.email ?? '' } : null;
    },
    presence(cb) {
      // Realtime presence: everyone with Connect open joins one channel.
      // Also stamps "last seen" every minute while the app is open.
      let channel: ReturnType<typeof sb.channel> | null = null;
      let beat = 0;
      let stopped = false;
      const seen = () => {
        sb.rpc('touch_seen').then(() => {}, () => {});
      };
      uid().then((me) => {
        if (!me || stopped) return;
        channel = sb.channel('cx-online', { config: { presence: { key: me } } });
        channel
          .on('presence', { event: 'sync' }, () => cb(new Set(Object.keys(channel!.presenceState()))))
          .subscribe((status: string) => {
            if (status === 'SUBSCRIBED') channel!.track({ at: Date.now() }).catch(() => {});
          });
        seen();
        beat = window.setInterval(() => document.visibilityState === 'visible' && seen(), 60000);
      });
      const vis = () => {
        if (!channel) return;
        if (document.visibilityState === 'visible') channel.track({ at: Date.now() }).catch(() => {});
        else {
          seen();
          channel.untrack().catch(() => {});
        }
      };
      document.addEventListener('visibilitychange', vis);
      return () => {
        stopped = true;
        window.clearInterval(beat);
        document.removeEventListener('visibilitychange', vis);
        if (channel) sb.removeChannel(channel);
      };
    },
    subscribe(table, filter, cb) {
      // Supabase Realtime: the database pushes changes the moment they happen
      const channel = sb
        .channel(`cx-${table}-${filter || 'all'}-${Math.random().toString(36).slice(2, 8)}`)
        .on('postgres_changes', { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) }, (p: { eventType: string; new: Record<string, unknown> }) =>
          cb({ event: p.eventType, row: p.new ?? {} }),
        )
        .subscribe();
      return () => {
        sb.removeChannel(channel);
      };
    },
    onAuthChange(cb) {
      const { data } = sb.auth.onAuthStateChange(() => cb());
      return () => data.subscription.unsubscribe();
    },
    async signIn(email) {
      // Only accounts that already exist (the team) get a link; nobody can make a new account this way
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo, shouldCreateUser: false } });
      if (error && /signups? not allowed|not found|otp_disabled/i.test(error.message)) throw new Error('That email isn’t on the team list.');
      fail(error);
    },
    async studentSignIn(email, studentId) {
      const res = await fetch('/api/student-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, studentId }),
      });
      const data = (await res.json().catch(() => null)) as { token_hash?: string; message?: string } | null;
      if (!res.ok || !data?.token_hash) throw new Error(data?.message || 'We couldn’t sign you in. Try again.');
      const { error } = await sb.auth.verifyOtp({ token_hash: data.token_hash, type: 'magiclink' });
      if (error) {
        const retry = await sb.auth.verifyOtp({ token_hash: data.token_hash, type: 'email' });
        if (retry.error) throw new Error('That sign-in didn’t go through. Try again.');
      }
    },
    async signOut() {
      await sb.auth.signOut();
    },

    async me() {
      const id = await uid();
      if (!id) return null;
      const { data } = await sb.from('profiles').select('*').eq('id', id).maybeSingle();
      return (data as unknown as Profile) ?? null;
    },
    async createProfile(input) {
      const id = await needUid();
      let { data, error } = await sb.from('profiles').insert({ ...input, id }).select().single();
      // Database not yet updated (phase privacy, links): save everything else
      if (error && /phase_public|links/.test(error.message)) {
        const { phase_public: _p, links: _l, ...rest } = input;
        ({ data, error } = await sb.from('profiles').insert({ ...rest, id }).select().single());
      }
      if (error?.code === '23505') throw new Error('That username is taken. Try another.');
      fail(error);
      return data as unknown as Profile;
    },
    async updateProfile(input) {
      const id = await needUid();
      let { data, error } = await sb.from('profiles').update(input).eq('id', id).select().single();
      if (error && /phase_public|links/.test(error.message)) {
        const { phase_public: _p, links: _l, ...rest } = input;
        ({ data, error } = await sb.from('profiles').update(rest).eq('id', id).select().single());
      }
      if (error?.code === '23505') throw new Error('That username is taken. Try another.');
      fail(error);
      return data as unknown as Profile;
    },
    async refreshStudentStatus() {
      const { data, error } = await sb.rpc('refresh_student_status');
      fail(error);
      return Boolean(data);
    },
    async redeemInvite(code) {
      const { data, error } = await sb.rpc('redeem_invite', { invite: code });
      fail(error);
      return Boolean(data);
    },
    async uploadImage(original, folder, onProgress) {
      const id = await needUid();
      if (folder === 'videos') {
        const r = await r2Upload('video', original, onProgress);
        if (r?.publicUrl) return r.publicUrl;
      }
      const file = folder === 'videos' ? original : await prepareImage(original, folder);
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
      const path = `${id}/${folder}/${Date.now()}.${ext}`;
      await xhrUpload('media', path, file, onProgress);
      onProgress?.(1);
      return sb.storage.from('media').getPublicUrl(path).data.publicUrl;
    },

    async listStudents(filter: StudentFilter) {
      let q = sb.from('profiles').select('*').eq('is_student', true).order('created_at', { ascending: false }).limit(200);
      if (filter.skill) q = q.contains('skills', [filter.skill]);
      // Private phases never show up in a phase filter
      if (filter.phase) q = q.eq('phase', filter.phase).neq('phase_public', false);
      if (filter.q) {
        const term = filter.q.replace(/[%,()]/g, ' ').trim();
        if (term) q = q.or(`name.ilike.%${term}%,handle.ilike.%${term}%,country.ilike.%${term}%`);
      }
      const { data, error } = await q;
      fail(error);
      return (data ?? []) as unknown as Profile[];
    },
    async getProfile(handle) {
      const { data } = await sb.from('profiles').select('*').eq('handle', handle.toLowerCase()).maybeSingle();
      return (data as unknown as Profile) ?? null;
    },
    async counts(userId) {
      const head = { count: 'exact' as const, head: true };
      const [a, c] = await Promise.all([
        sb.from('connections').select('*', head).eq('status', 'accepted').or(`requester_id.eq.${userId},addressee_id.eq.${userId}`),
        sb.from('posts').select('*', head).eq('author_id', userId).eq('community', false),
      ]);
      return { connections: a.count ?? 0, posts: c.count ?? 0 };
    },

    async connectionStatus(userId): Promise<ConnectionStatus> {
      const me = await uid();
      if (!me) return 'none';
      const { data } = await sb
        .from('connections')
        .select('requester_id,status')
        .or(`and(requester_id.eq.${me},addressee_id.eq.${userId}),and(requester_id.eq.${userId},addressee_id.eq.${me})`)
        .maybeSingle();
      const row = data as unknown as { requester_id: string; status: string } | null;
      if (!row) return 'none';
      if (row.status === 'accepted') return 'connected';
      return row.requester_id === me ? 'requested' : 'incoming';
    },
    async requestConnection(userId) {
      const me = await needUid();
      const { error } = await sb.from('connections').insert({ requester_id: me, addressee_id: userId });
      if (error?.code === '23505') throw new Error('There’s already a request between you two.');
      if (error?.message.includes('blocked')) throw new Error('You can’t connect with this member.');
      fail(error);
    },
    async answerRequest(userId, accept) {
      const me = await needUid();
      const q = sb.from('connections');
      const { error } = accept
        ? await q.update({ status: 'accepted' }).eq('requester_id', userId).eq('addressee_id', me)
        : await q.delete().eq('requester_id', userId).eq('addressee_id', me);
      fail(error);
    },
    async removeConnection(userId) {
      const me = await needUid();
      const { error } = await sb
        .from('connections')
        .delete()
        .or(`and(requester_id.eq.${me},addressee_id.eq.${userId}),and(requester_id.eq.${userId},addressee_id.eq.${me})`);
      fail(error);
    },
    async listConnections() {
      const me = await needUid();
      const { data, error } = await sb
        .from('connections')
        .select('requester_id, r:profiles!connections_requester_id_fkey(*), a:profiles!connections_addressee_id_fkey(*)')
        .eq('status', 'accepted')
        .or(`requester_id.eq.${me},addressee_id.eq.${me}`)
        .order('accepted_at', { ascending: false });
      fail(error);
      return ((data ?? []) as unknown as { requester_id: string; r: Profile; a: Profile }[]).map((c) => (c.requester_id === me ? c.a : c.r));
    },
    async listRequests() {
      const me = await needUid();
      const sel = 'requester_id, r:profiles!connections_requester_id_fkey(*), a:profiles!connections_addressee_id_fkey(*)';
      const [inc, out] = await Promise.all([
        sb.from('connections').select(sel).eq('status', 'pending').eq('addressee_id', me).order('created_at', { ascending: false }),
        sb.from('connections').select(sel).eq('status', 'pending').eq('requester_id', me).order('created_at', { ascending: false }),
      ]);
      fail(inc.error || out.error);
      return {
        incoming: ((inc.data ?? []) as unknown as { r: Profile }[]).map((c) => c.r),
        sent: ((out.data ?? []) as unknown as { a: Profile }[]).map((c) => c.a),
      };
    },

    async listNotices() {
      await needUid();
      const { data, error } = await sb
        .from('notifications')
        .select('id, kind, post_id, read_at, created_at, actor:profiles!notifications_actor_id_fkey(*)')
        .order('created_at', { ascending: false })
        .limit(60);
      fail(error);
      return (data ?? []) as unknown as Notice[];
    },
    async unreadCount() {
      if (!(await uid())) return 0;
      const { count } = await sb.from('notifications').select('*', { count: 'exact', head: true }).is('read_at', null);
      return count ?? 0;
    },
    async unreadMessageCount() {
      const me = await uid();
      if (!me) return 0;
      // Row rules limit this to my own conversations
      const { count } = await sb.from('messages').select('id', { count: 'exact', head: true }).neq('sender_id', me).is('read_at', null).is('deleted_at', null);
      return count ?? 0;
    },
    async markNoticesRead() {
      const me = await needUid();
      await sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', me).is('read_at', null);
    },

    async listPosts({ authorId, feed = 'everyone', limit = 30 }) {
      if (fastFeed) {
        let f = sb.from('posts_feed').select('*').order('created_at', { ascending: false }).limit(limit);
        if (authorId) f = f.eq('author_id', authorId).eq('community', false);
        else f = f.eq('community', feed === 'community');
        if (feed === 'connections' && !authorId) f = f.eq('by_connection', true);
        const { data, error } = await f;
        if (!error) return (data ?? []) as unknown as Post[];
        if (!/posts_feed|by_connection|schema cache/.test(error.message)) fail(error);
        fastFeed = false; // database not updated yet: old way below
      }
      let q = sb.from('posts').select(POST_SELECT).order('created_at', { ascending: false }).limit(limit);
      if (authorId) q = q.eq('author_id', authorId).eq('community', false);
      else q = q.eq('community', feed === 'community');
      if (feed === 'connections' && !authorId) {
        const people = await api.listConnections();
        if (people.length === 0) return [];
        q = q.in('author_id', people.map((p) => p.id));
      }
      const { data, error } = await q;
      fail(error);
      return decorate((data ?? []) as unknown as Post[]);
    },
    async listSaved() {
      const me = await needUid();
      const { data, error } = await sb
        .from('bookmarks')
        .select(`created_at, post:posts(${POST_SELECT})`)
        .eq('user_id', me)
        .order('created_at', { ascending: false });
      fail(error);
      return decorate(((data ?? []) as unknown as { post: Post | null }[]).map((b) => b.post).filter((p): p is Post => Boolean(p)));
    },
    async setSaved(postId, on) {
      const me = await needUid();
      const { error } = on
        ? await sb.from('bookmarks').upsert({ user_id: me, post_id: postId })
        : await sb.from('bookmarks').delete().eq('user_id', me).eq('post_id', postId);
      fail(error);
    },
    async getPost(id) {
      if (fastFeed) {
        const { data, error } = await sb.from('posts_feed').select('*').eq('id', id).maybeSingle();
        if (!error) return (data as unknown as Post) ?? null;
        fastFeed = false;
      }
      const { data } = await sb.from('posts').select(POST_SELECT).eq('id', id).maybeSingle();
      if (!data) return null;
      return (await decorate([data as unknown as Post]))[0];
    },
    async createPost(input) {
      const me = await needUid();
      const { data, error } = await sb.from('posts').insert({ ...input, author_id: me }).select(POST_SELECT).single();
      if (error?.message.includes('row-level security')) {
        throw new Error(input.community ? 'Only the grand sensei can post to the Community feed.' : 'Only members can post work.');
      }
      fail(error);
      // A brand-new post has no likes, comments or saves: skip the extra queries
      return { ...(data as unknown as Post), likes: 0, comments: 0, liked: false, saved: false };
    },
    async deletePost(id) {
      const { error } = await sb.from('posts').delete().eq('id', id);
      fail(error);
    },
    async setLike(postId, on) {
      const me = await needUid();
      const { error } = on
        ? await sb.from('likes').upsert({ post_id: postId, user_id: me })
        : await sb.from('likes').delete().eq('post_id', postId).eq('user_id', me);
      fail(error);
    },
    async listComments(postId) {
      const { data, error } = await sb
        .from('comments')
        .select('*, author:profiles!comments_author_id_fkey(*)')
        .eq('post_id', postId)
        .order('created_at');
      fail(error);
      return (data ?? []) as unknown as Comment[];
    },
    async addComment(postId, body) {
      const me = await needUid();
      const { data, error } = await sb
        .from('comments')
        .insert({ post_id: postId, author_id: me, body })
        .select('*, author:profiles!comments_author_id_fkey(*)')
        .single();
      fail(error);
      return data as unknown as Comment;
    },
    async deleteComment(id) {
      const { error } = await sb.from('comments').delete().eq('id', id);
      fail(error);
    },

    async listConversations() {
      const me = await needUid();
      if (fastInbox) {
        const { data, error } = await sb.from('inbox').select('*').order('last_message_at', { ascending: false });
        if (!error) {
          type Row = {
            id: string;
            last_message_at: string;
            other: Profile;
            last_body: string | null;
            last_kind: Conversation['last_kind'] | null;
            last_file_name: string | null;
            last_sender: string | null;
            last_delivered_at: string | null;
            last_read_at: string | null;
            last_deleted_at: string | null;
            unread: number;
          };
          return ((data ?? []) as unknown as Row[]).map((r) => ({
            id: r.id,
            other: r.other,
            last_message_at: r.last_message_at,
            last_body: r.last_sender ? preview({ body: r.last_body ?? '', kind: r.last_kind ?? 'text', file_name: r.last_file_name, deleted_at: r.last_deleted_at }) : '',
            unread: r.unread ?? 0,
            last_kind: r.last_kind ?? 'text',
            last_mine: r.last_sender === me,
            last_delivered: Boolean(r.last_delivered_at),
            last_read: Boolean(r.last_read_at),
            last_deleted: Boolean(r.last_deleted_at),
          }));
        }
        fastInbox = false;
      }
      const { data, error } = await sb
        .from('conversations')
        .select('*, a:profiles!conversations_user_a_fkey(*), b:profiles!conversations_user_b_fkey(*)')
        .order('last_message_at', { ascending: false });
      fail(error);
      const rows = (data ?? []) as unknown as { id: string; user_a: string; a: Profile; b: Profile; last_message_at: string }[];
      const lasts = await Promise.all(
        rows.map((r) =>
          sb
            .from('messages')
            .select('body, kind, file_name, deleted_at, sender_id, delivered_at, read_at')
            .eq('conversation_id', r.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
        ),
      );
      const unread = new Map<string, number>();
      if (rows.length) {
        const { data: un } = await sb
          .from('messages')
          .select('conversation_id')
          .in('conversation_id', rows.map((r) => r.id))
          .neq('sender_id', me)
          .is('read_at', null)
          .is('deleted_at', null);
        for (const u of (un ?? []) as unknown as { conversation_id: string }[]) unread.set(u.conversation_id, (unread.get(u.conversation_id) ?? 0) + 1);
      }
      return rows.map((r, i) => {
        const last = lasts[i].data as unknown as
          | { body: string; kind?: Conversation['last_kind']; file_name?: string | null; deleted_at?: string | null; sender_id: string; delivered_at?: string | null; read_at?: string | null }
          | null;
        return {
          id: r.id,
          other: r.user_a === me ? r.b : r.a,
          last_message_at: r.last_message_at,
          last_body: last ? preview(last) : '',
          unread: unread.get(r.id) ?? 0,
          last_kind: last?.kind ?? 'text',
          last_mine: last?.sender_id === me,
          last_delivered: Boolean(last?.delivered_at),
          last_read: Boolean(last?.read_at),
          last_deleted: Boolean(last?.deleted_at),
        };
      });
    },
    async openConversation(userId) {
      const { data, error } = await sb.rpc('open_conversation', { other: userId });
      if (error?.message.includes('not connected')) throw new Error('Connect with this member before messaging them.');
      if (error?.message.includes('blocked')) throw new Error('You can’t message this member.');
      fail(error);
      return data as unknown as string;
    },
    async getConversation(id) {
      const me = await needUid();
      const { data } = await sb
        .from('conversations')
        .select('*, a:profiles!conversations_user_a_fkey(*), b:profiles!conversations_user_b_fkey(*)')
        .eq('id', id)
        .maybeSingle();
      if (!data) return null;
      const r = data as unknown as { id: string; user_a: string; a: Profile; b: Profile; last_message_at: string };
      return { id: r.id, other: r.user_a === me ? r.b : r.a, last_message_at: r.last_message_at, last_body: '' } as Conversation;
    },
    async listMessages(conversationId) {
      const { data, error } = await sb.from('messages').select('*').eq('conversation_id', conversationId).order('created_at').limit(500);
      fail(error);
      const rows = (data ?? []) as unknown as Message[];
      const paths = rows.map((m) => m.media_path).filter((p): p is string => Boolean(p));
      const link = paths.length ? await sign(paths) : () => null;
      return rows.map((m) => (m.media_path ? { ...m, media_url: link(m.media_path) } : m));
    },
    async sendMessage(conversationId, body) {
      const me = await needUid();
      const { data, error } = await sb.from('messages').insert({ conversation_id: conversationId, sender_id: me, body }).select().single();
      fail(error);
      return data as unknown as Message;
    },
    async sendAttachment(conversationId, a, caption, onProgress) {
      const me = await needUid();
      const file = a.kind === 'image' ? await prepareImage(a.file, 'posts') : a.file;
      const ext = (file.name.split('.').pop() || (a.kind === 'voice' ? 'webm' : 'bin')).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
      const asFile = file instanceof File ? file : new File([file], `upload.${ext}`, { type: a.file.type });
      const r = await r2Upload('chat', asFile, onProgress, conversationId);
      let path: string;
      if (r) {
        path = `r2:${r.key}`;
      } else {
        path = `${conversationId}/${me}-${Date.now()}.${ext}`;
        await xhrUpload('chat', path, file, onProgress);
      }
      const row: Record<string, unknown> = {
        conversation_id: conversationId,
        sender_id: me,
        body: caption,
        kind: a.kind,
        media_path: path,
        file_name: a.kind === 'file' ? a.file.name.slice(0, 200) : null,
        file_size: file.size,
        duration: a.duration ?? null,
        ...(a.thumb ? { thumb: a.thumb } : {}),
      };
      let { data, error } = await sb.from('messages').insert(row).select().single();
      if (error && /thumb/i.test(error.message) && row.thumb) {
        // Database without previews yet: save the message without one (the file is already uploaded)
        delete row.thumb;
        ({ data, error } = await sb.from('messages').insert(row).select().single());
      }
      if (error && /column|kind|media_path|schema cache/i.test(error.message)) throw new Error(NEEDS_UPDATE);
      fail(error);
      const link = await sign([path]);
      return { ...(data as unknown as Message), media_url: link(path) };
    },
    async deleteMessage(id) {
      const { error } = await sb.rpc('delete_message', { mid: id });
      if (error?.message.includes('not_your_message')) throw new Error('You can only delete your own messages.');
      fail(error);
    },
    async markRead(conversationId) {
      await sb.rpc('mark_read', { conv: conversationId });
    },
    async markDelivered() {
      await sb.rpc('mark_delivered');
    },

    async listLessons() {
      const { data, error } = await sb.rpc('course_outline');
      if (error && /course_outline/.test(error.message)) throw new Error('The Learn section needs its database update. Run supabase/learn.sql in Supabase.');
      fail(error);
      return ((data ?? []) as { id: string; phase: number; lesson_position: number; title: string; summary: string; duration: string; published: boolean; has_video: boolean; done: boolean; is_open: boolean }[]).map(
        (r) => ({ id: r.id, phase: r.phase, position: r.lesson_position, title: r.title, summary: r.summary, duration: r.duration, published: r.published, has_video: r.has_video, done: r.done, open: r.is_open }),
      );
    },
    async getLesson(id) {
      const { data, error } = await sb.rpc('get_lesson', { lid: id });
      if (error) throw new Error(/members_only|locked|not_found/.exec(error.message)?.[0] ?? error.message);
      const r = ((data ?? []) as { id: string; phase: number; lesson_position: number; title: string; summary: string; duration: string; video_url: string; notes: string; files: Lesson['files']; published: boolean; done: boolean; is_open: boolean }[])[0];
      if (!r) throw new Error('not_found');
      return { id: r.id, phase: r.phase, position: r.lesson_position, title: r.title, summary: r.summary, duration: r.duration, published: r.published, has_video: Boolean(r.video_url), done: r.done, open: r.is_open, video_url: r.video_url, notes: r.notes, files: r.files ?? [] };
    },
    async setLessonDone(id, done) {
      const { error } = await sb.rpc('set_lesson_done', { lid: id, is_done: done });
      fail(error);
    },
    async saveLesson(input) {
      const row = { phase: input.phase, title: input.title.trim(), summary: input.summary.trim(), duration: input.duration.trim(), video_url: input.video_url.trim(), notes: input.notes, files: input.files, published: input.published, updated_at: new Date().toISOString() };
      if (input.id) {
        const { error } = await sb.from('lessons').update(row).eq('id', input.id);
        fail(error);
        return api.getLesson(input.id);
      }
      const { data: last } = await sb.from('lessons').select('position').eq('phase', input.phase).order('position', { ascending: false }).limit(1).maybeSingle();
      const { data, error } = await sb.from('lessons').insert({ ...row, position: ((last as { position: number } | null)?.position ?? 0) + 1 }).select('id').single();
      fail(error);
      return api.getLesson((data as { id: string }).id);
    },
    async deleteLesson(id) {
      const { error } = await sb.from('lessons').delete().eq('id', id);
      fail(error);
    },
    async moveLesson(id, dir) {
      const { error } = await sb.rpc('move_lesson', { lid: id, dir });
      fail(error);
    },

    async report(target, id, reason) {
      const me = await needUid();
      const { error } = await sb.from('reports').insert({ reporter_id: me, target_type: target, target_id: id, reason });
      fail(error);
    },
    async setBlock(userId, on) {
      const me = await needUid();
      const { error } = on
        ? await sb.from('blocks').upsert({ blocker_id: me, blocked_id: userId })
        : await sb.from('blocks').delete().eq('blocker_id', me).eq('blocked_id', userId);
      fail(error);
    },
    async isBlocked(userId) {
      const me = await uid();
      if (!me) return false;
      const { data } = await sb.from('blocks').select('blocked_id').eq('blocker_id', me).eq('blocked_id', userId).maybeSingle();
      return Boolean(data);
    },
  };
  return api;
}

export type { ProfileInput };
