import crypto from 'node:crypto';
import { presign, r2Config } from '@/lib/r2';
import { adminClient, caller } from '@/lib/server-auth';

/**
 * Hands the app a one-time link to upload one file straight to Cloudflare R2.
 *  - purpose "video": a post video, into the public bucket (anyone can watch)
 *  - purpose "chat":  a chat file or voice note, into the private bucket,
 *                     only for someone in that conversation
 * Answers 503 when R2 isn't configured, and the app falls back to Supabase.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LIMIT = { video: 100 * 1024 * 1024, chat: 50 * 1024 * 1024, group: 50 * 1024 * 1024 };

const ext = (name: string, type: string) => {
  const fromName = (name.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
  if (fromName && fromName !== name.toLowerCase()) return fromName;
  return (type.split('/')[1] || 'bin').replace(/[^a-z0-9]/g, '').slice(0, 8) || 'bin';
};

export async function POST(req: Request) {
  const cfg = r2Config();
  const admin = adminClient();
  if (!cfg || !admin) return Response.json({ error: 'not_configured' }, { status: 503 });

  const uid = await caller(req, admin);
  if (!uid) return Response.json({ error: 'Sign in first.' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { purpose?: string; conversationId?: string; name?: string; type?: string; size?: number };
  const purpose = body.purpose === 'chat' ? 'chat' : body.purpose === 'video' ? 'video' : body.purpose === 'group' ? 'group' : null;
  const size = Number(body.size) || 0;
  const type = String(body.type || 'application/octet-stream');
  if (!purpose) return Response.json({ error: 'Unknown upload.' }, { status: 400 });
  if (size > LIMIT[purpose]) return Response.json({ error: `Files can be up to ${LIMIT[purpose] / 1024 / 1024} MB.` }, { status: 413 });

  const rand = crypto.randomBytes(6).toString('hex');
  let key: string;
  let bucket: string;
  if (purpose === 'video') {
    const { data: meRow } = await admin.from('profiles').select('is_student, is_sensei').eq('id', uid).maybeSingle();
    const me = meRow as { is_student: boolean; is_sensei: boolean } | null;
    if (!me || !(me.is_student || me.is_sensei)) return Response.json({ error: 'Only members can post videos.' }, { status: 403 });
    if (!type.startsWith('video/')) return Response.json({ error: 'That isn’t a video.' }, { status: 400 });
    bucket = cfg.publicBucket;
    key = `videos/${uid}/${Date.now()}-${rand}.${ext(String(body.name || ''), type)}`;
  } else if (purpose === 'group') {
    const { data: meRow } = await admin.from('profiles').select('is_student, is_sensei, is_moderator').eq('id', uid).maybeSingle();
    const me = meRow as { is_student: boolean; is_sensei: boolean; is_moderator: boolean } | null;
    if (!me || !(me.is_student || me.is_sensei || me.is_moderator)) return Response.json({ error: 'Only members can send files to the group.' }, { status: 403 });
    bucket = cfg.privateBucket;
    key = `group/${uid}-${Date.now()}-${rand}.${ext(String(body.name || ''), type)}`;
  } else {
    const conv = String(body.conversationId || '');
    const { data: cRow } = await admin.from('conversations').select('user_a, user_b').eq('id', conv).maybeSingle();
    const c = cRow as { user_a: string; user_b: string } | null;
    if (!c || (c.user_a !== uid && c.user_b !== uid)) return Response.json({ error: 'You’re not in this chat.' }, { status: 403 });
    bucket = cfg.privateBucket;
    key = `${conv}/${uid}-${Date.now()}-${rand}.${ext(String(body.name || ''), type)}`;
  }

  const uploadUrl = presign({ method: 'PUT', host: cfg.host, bucket, key, accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, expires: 900 });
  return Response.json({ uploadUrl, key, publicUrl: purpose === 'video' ? `${cfg.publicUrl}/${key}` : null });
}
