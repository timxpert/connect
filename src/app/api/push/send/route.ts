import { adminClient, caller } from '@/lib/server-auth';
import { pushKeys, sendPush, type PushSub } from '@/lib/webpush';

/* After someone sends a message, the app calls this. It works out who should
   be told (the other person in a chat, or everyone in the group) and sends each of their phones a notification with the message,
   like WhatsApp. Only the sender of a message can trigger its notification. */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Row = { id: string; sender_id: string; body: string; kind: string; file_name?: string | null; created_at: string };

// *bold* _italic_ __underline__ ~strike~ shown without the marks
const plain = (t: string) => t.replace(/(__|[*_~])(?=\S)([^\n]*?\S)\1/g, '$2');

const json = (b: string) => {
  try {
    return JSON.parse(b) as { q?: string; t?: string };
  } catch {
    return {};
  }
};
const what = (m: Row) =>
  m.kind === 'poll'
    ? `📊 Poll: ${json(m.body).q ?? ''}`
    : m.kind === 'live'
      ? `🎥 Live class: ${json(m.body).t ?? ''}`
      : m.kind === 'voice'
    ? 'Voice message'
    : m.kind === 'image'
      ? `Photo${m.body ? `: ${m.body}` : ''}`
      : m.kind === 'video'
        ? `Video${m.body ? `: ${m.body}` : ''}`
        : m.kind === 'file'
          ? `Document: ${m.file_name || 'file'}`
          : plain(m.body);

type Admin = NonNullable<ReturnType<typeof adminClient>>;
type GroupMsg = { kind: string; body: string; reply_to?: string | null; group_id?: string | null };
async function byAlertLevel(admin: Admin, ids: string[], msg: GroupMsg | null, sender: { is_sensei?: boolean; is_moderator?: boolean }) {
  if (!msg) return ids;
  const { data: people, error } = await admin.from('profiles').select('id, handle, alert_level').in('id', ids);
  if (error) return ids; // alerts.sql not run yet: everyone, as before
  const team = msg.group_id ? Boolean(sender.is_sensei) : Boolean(sender.is_sensei || sender.is_moderator);
  let repliedTo = '';
  if (msg.reply_to) {
    const { data: r } = await admin.from('group_messages').select('sender_id').eq('id', msg.reply_to).maybeSingle();
    repliedTo = (r as { sender_id: string } | null)?.sender_id ?? '';
  }
  const text = (msg.body || '').toLowerCase();
  return ((people ?? []) as { id: string; handle: string; alert_level: string | null }[])
    .filter((p) => {
      const level = p.alert_level || 'important';
      if (level === 'off') return false;
      if (level === 'all') return true;
      return team || msg.kind === 'poll' || msg.kind === 'live' || p.id === repliedTo || (!!p.handle && text.includes(`@${p.handle.toLowerCase()}`));
    })
    .map((p) => p.id);
}

export async function POST(req: Request) {
  const admin = adminClient();
  if (!admin) return Response.json({ ok: false }, { status: 503 });
  const uid = await caller(req, admin);
  if (!uid) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const keys = await pushKeys(admin);
  if (!keys) return Response.json({ ok: false, why: 'no_keys' });

  const body = (await req.json().catch(() => ({}))) as { kind?: string; id?: string; url?: string };
  const origin = new URL(req.url).origin;
  // The app says where the chat lives on this site; only same-site links are used
  const link = (fallback: string) => {
    try {
      const u = new URL(String(body.url));
      return u.origin === origin ? u.href : `${origin}${fallback}`;
    } catch {
      return `${origin}${fallback}`;
    }
  };
  const { data: me } = await admin.from('profiles').select('name, avatar_url, is_sensei, is_moderator').eq('id', uid).maybeSingle();
  const sender = (me as { name: string; avatar_url: string | null; is_sensei?: boolean; is_moderator?: boolean } | null) ?? { name: 'Someone', avatar_url: null };

  let to: string[] = [];
  let gmsg: GroupMsg | null = null;
  let data: Record<string, unknown> = {};

  if (body.kind === 'dm') {
    const { data: m } = await admin.from('messages').select('id, sender_id, body, kind, file_name, created_at, conversation_id').eq('id', String(body.id)).maybeSingle();
    const msg = m as (Row & { conversation_id: string }) | null;
    if (!msg || msg.sender_id !== uid) return Response.json({ ok: false });
    const { data: c } = await admin.from('conversations').select('user_a, user_b').eq('id', msg.conversation_id).maybeSingle();
    const conv = c as { user_a: string; user_b: string } | null;
    if (!conv) return Response.json({ ok: false });
    to = [conv.user_a === uid ? conv.user_b : conv.user_a];
    data = { title: sender.name, body: what(msg).slice(0, 300), icon: sender.avatar_url, tag: msg.conversation_id, url: link(`/messages/${msg.conversation_id}`) };
  } else if (body.kind === 'group') {
    let { data: m, error: e1 } = await admin.from('group_messages').select('id, sender_id, body, kind, file_name, created_at, group_id, reply_to').eq('id', String(body.id)).maybeSingle();
    if (e1) ({ data: m } = await admin.from('group_messages').select('id, sender_id, body, kind, file_name, created_at').eq('id', String(body.id)).maybeSingle());
    const msg = m as (Row & { group_id?: string | null; reply_to?: string | null }) | null;
    if (!msg || msg.sender_id !== uid) return Response.json({ ok: false });
    gmsg = msg;
    if (msg.group_id) {
      // one of the Grand Sensei's own groups: everyone in it
      const [{ data: ppl }, { data: g }] = await Promise.all([
        admin.from('group_people').select('user_id, profile:profiles!group_people_user_id_fkey(banned_at)').eq('group_id', msg.group_id),
        admin.from('groups').select('name, photo_url').eq('id', msg.group_id).maybeSingle(),
      ]);
      to = ((ppl ?? []) as unknown as { user_id: string; profile: { banned_at: string | null } | null }[]).filter((p) => p.user_id !== uid && !p.profile?.banned_at).map((p) => p.user_id);
      const group = (g as { name?: string; photo_url?: string | null } | null) ?? {};
      data = {
        title: group.name || 'Group',
        body: `${sender.name.split(' ')[0]}: ${what(msg)}`.slice(0, 300),
        icon: group.photo_url || sender.avatar_url,
        tag: `g-${msg.group_id}`,
        url: link(`/messages/g/${msg.group_id}`),
      };
    } else {
      const [{ data: people }, { data: removed }, { data: g }] = await Promise.all([
        admin.from('profiles').select('id, banned_at').or('is_student.eq.true,is_sensei.eq.true,is_moderator.eq.true'),
        admin.from('group_removed').select('user_id'),
        admin.from('group_settings').select('name, photo_url').eq('id', 1).maybeSingle(),
      ]);
      const out = new Set([...((removed ?? []) as { user_id: string }[]).map((r) => r.user_id), uid]);
      to = ((people ?? []) as { id: string; banned_at?: string | null }[]).filter((p) => !p.banned_at && !out.has(p.id)).map((p) => p.id);
      const group = (g as { name?: string; photo_url?: string | null } | null) ?? {};
      data = {
        title: group.name || 'Motion Dojo Community',
        body: `${sender.name.split(' ')[0]}: ${what(msg)}`.slice(0, 300),
        icon: group.photo_url || sender.avatar_url,
        tag: 'group',
        url: link('/messages/group'),
      };
    }
  } else {
    return Response.json({ ok: false });
  }
  // Group messages: each student chooses all, important only (the default) or off
  if (body.kind === 'group' && to.length) to = await byAlertLevel(admin, to, gmsg, sender);
  if (!to.length) return Response.json({ ok: true, sent: 0 });

  const { data: subs } = await admin.from('push_subscriptions').select('endpoint, p256dh, auth').in('user_id', to);
  const list = (subs ?? []) as PushSub[];
  const results = await Promise.all(list.map((s) => sendPush(s, data, keys)));
  const gone = list.filter((_, i) => !results[i]).map((s) => s.endpoint);
  if (gone.length) await admin.from('push_subscriptions').delete().in('endpoint', gone);
  return Response.json({ ok: true, sent: list.length - gone.length });
}
