import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

/**
 * Student sign-in: email + student ID (e.g. MD-7KQ2-X9PB).
 * Checks the pair against the enrolment list, then hands the browser a
 * one-time token it exchanges for a session. No email is sent.
 *
 * Needs SUPABASE_SERVICE_ROLE_KEY (the sb_secret_… key) in this Vercel
 * project as a Secret. It never reaches the browser.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WRONG = 'That email and member ID don’t match. Check both, or ask the community manager for your ID.';

/** "md 7kq2x9pb", "MD-7KQ2-X9PB", "7KQ2X9PB" -> "MD-7KQ2-X9PB" */
function normaliseId(v: unknown) {
  const raw = String(v ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  const body = raw.startsWith('MD') && raw.length === 10 ? raw.slice(2) : raw;
  return body.length === 8 ? `MD-${body.slice(0, 4)}-${body.slice(4)}` : '';
}

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return Response.json({ message: 'Sign-in isn’t switched on yet. Please try again later or message the community manager.' }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as { email?: unknown; studentId?: unknown };
  const email = String(body.email ?? '').trim().toLowerCase();
  const id = normaliseId(body.studentId);
  // Small fixed delay: makes guessing IDs slow without bothering real students
  await new Promise((r) => setTimeout(r, 400));
  if (!/^\S+@\S+\.\S+$/.test(email) || !id) return Response.json({ message: WRONG }, { status: 401 });

  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: row, error } = await admin.from('enrolments').select('email, student_id').eq('email', email).maybeSingle();
  if (error) {
    console.error('[student-login] lookup', error.message);
    return Response.json({ message: 'Something went wrong. Try again in a minute.' }, { status: 500 });
  }
  if (!row?.student_id || !same(String(row.student_id), id)) return Response.json({ message: WRONG }, { status: 401 });

  // First sign-in creates the account; later ones reuse it
  let link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (link.error) {
    const created = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (created.error && !/already/i.test(created.error.message)) {
      console.error('[student-login] create', created.error.message);
      return Response.json({ message: 'Something went wrong. Try again in a minute.' }, { status: 500 });
    }
    link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  }
  const token_hash = link.data?.properties?.hashed_token;
  if (link.error || !token_hash) {
    console.error('[student-login] link', link.error?.message);
    return Response.json({ message: 'Something went wrong. Try again in a minute.' }, { status: 500 });
  }
  return Response.json({ token_hash });
}
