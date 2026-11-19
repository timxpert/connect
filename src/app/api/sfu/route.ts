import { adminClient, caller } from '@/lib/server-auth';

/* Group calls: passes requests to Cloudflare Realtime (the server that shares
   everyone's sound and video in a group call), adding the app secret here so it
   never reaches a phone. Needs CLOUDFLARE_SFU_APP_ID and CLOUDFLARE_SFU_APP_SECRET
   in Vercel (secret, never NEXT_PUBLIC). Only signed-in members can use it. */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// the only calls a phone may make
const ALLOWED: [string, RegExp][] = [
  ['POST', /^sessions\/new$/],
  ['POST', /^sessions\/[A-Za-z0-9_-]+\/tracks\/new$/],
  ['PUT', /^sessions\/[A-Za-z0-9_-]+\/renegotiate$/],
  ['PUT', /^sessions\/[A-Za-z0-9_-]+\/tracks\/close$/],
];

export async function POST(req: Request) {
  const id = process.env.CLOUDFLARE_SFU_APP_ID;
  const secret = process.env.CLOUDFLARE_SFU_APP_SECRET;
  if (!id || !secret) return Response.json({ errorCode: 'not_set_up', errorDescription: 'Group calls aren’t set up yet.' }, { status: 503 });
  const admin = adminClient();
  if (!admin) return Response.json({ errorCode: 'not_set_up' }, { status: 503 });
  const uid = await caller(req, admin);
  if (!uid) return Response.json({ errorCode: 'auth', errorDescription: 'Sign in first.' }, { status: 401 });
  const { data: me } = await admin.from('profiles').select('is_student, is_sensei, is_moderator, banned_at').eq('id', uid).maybeSingle();
  const p = me as { is_student?: boolean; is_sensei?: boolean; is_moderator?: boolean; banned_at?: string | null } | null;
  if (!p || p.banned_at || !(p.is_student || p.is_sensei || p.is_moderator)) return Response.json({ errorCode: 'members_only', errorDescription: 'Group calls are for members.' }, { status: 403 });

  const { path, method = 'POST', body } = (await req.json().catch(() => ({}))) as { path?: string; method?: string; body?: unknown };
  if (!path || !ALLOWED.some(([m, re]) => m === method && re.test(path))) return Response.json({ errorCode: 'bad_request' }, { status: 400 });
  const res = await fetch(`https://rtc.live.cloudflare.com/v1/apps/${id}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return new Response(text, { status: res.status, headers: { 'Content-Type': 'application/json' } });
}
