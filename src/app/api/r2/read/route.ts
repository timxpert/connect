import { presign, r2Config } from '@/lib/r2';
import { adminClient, caller } from '@/lib/server-auth';

/**
 * Short-lived links to read private chat files from R2. Each file lives under
 * <conversation id>/..., and links are only given to people in that chat.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const cfg = r2Config();
  const admin = adminClient();
  if (!cfg || !admin) return Response.json({ error: 'not_configured' }, { status: 503 });
  const uid = await caller(req, admin);
  if (!uid) return Response.json({ error: 'Sign in first.' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { keys?: unknown };
  const keys = (Array.isArray(body.keys) ? body.keys : []).map(String).filter((k) => /^([0-9a-f-]{36}|group)\/[\w.-]+$/i.test(k)).slice(0, 200);
  if (!keys.length) return Response.json({ urls: {} });

  const convs = [...new Set(keys.map((k) => k.split('/')[0]).filter((c) => c !== 'group'))];
  const { data } = convs.length ? await admin.from('conversations').select('id, user_a, user_b').in('id', convs) : { data: [] };
  const rows = (data ?? []) as { id: string; user_a: string; user_b: string }[];
  const mine = new Set(rows.filter((c) => c.user_a === uid || c.user_b === uid).map((c) => c.id));
  // Dojo group files: anyone in the group
  if (keys.some((k) => k.startsWith('group/'))) {
    const { data: meRow } = await admin.from('profiles').select('is_student, is_sensei, is_moderator').eq('id', uid).maybeSingle();
    const me = meRow as { is_student: boolean; is_sensei: boolean; is_moderator: boolean } | null;
    if (me && (me.is_student || me.is_sensei || me.is_moderator)) mine.add('group');
  }

  const urls: Record<string, string> = {};
  for (const k of keys) {
    if (!mine.has(k.split('/')[0])) continue;
    urls[k] = presign({ method: 'GET', host: cfg.host, bucket: cfg.privateBucket, key: k, accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, expires: 6 * 3600 });
  }
  return Response.json({ urls });
}
