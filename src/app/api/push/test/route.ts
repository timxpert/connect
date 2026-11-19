import { adminClient, caller } from '@/lib/server-auth';
import { pushKeys, sendPushStatus, type PushSub } from '@/lib/webpush';

/* "Send me a test notification": sends one to each of the caller's phones and
   says what happened, so problems can be found. */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const admin = adminClient();
  if (!admin) return Response.json({ ok: false, why: 'The server isn’t set up for notifications.' });
  const uid = await caller(req, admin);
  if (!uid) return Response.json({ ok: false, why: 'Sign in first.' }, { status: 401 });
  const keys = await pushKeys(admin);
  if (!keys) return Response.json({ ok: false, why: 'Run push.sql in Supabase first.' });
  const { data: subs, error } = await admin.from('push_subscriptions').select('endpoint, p256dh, auth').eq('user_id', uid);
  if (error) return Response.json({ ok: false, why: 'Run push.sql in Supabase first.' });
  const list = (subs ?? []) as PushSub[];
  if (!list.length) return Response.json({ ok: false, why: 'This phone isn’t signed up for notifications yet.' });
  const origin = new URL(req.url).origin;
  const results = await Promise.all(
    list.map((s) => sendPushStatus(s, { title: 'Motion Dojo Connect', body: 'Notifications are working.', tag: 'test', url: `${origin}/`, force: true }, keys)),
  );
  const gone = list.filter((_, i) => results[i].status === 404 || results[i].status === 410).map((s) => s.endpoint);
  if (gone.length) await admin.from('push_subscriptions').delete().in('endpoint', gone);
  const ok = results.some((r) => r.status >= 200 && r.status < 300);
  return Response.json({
    ok,
    sent: results.filter((r) => r.status >= 200 && r.status < 300).length,
    phones: list.length,
    why: ok ? '' : results.map((r) => `${r.status || 'no answer'} ${r.text}`.trim()).join(' · '),
  });
}
