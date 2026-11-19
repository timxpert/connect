import { adminClient } from '@/lib/server-auth';
import { pushKeys } from '@/lib/webpush';

/** The public push key phones subscribe with */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const admin = adminClient();
  if (!admin) return Response.json({ error: 'not_configured' }, { status: 503 });
  const keys = await pushKeys(admin);
  if (!keys) return Response.json({ error: 'Run supabase/push.sql in Supabase.' }, { status: 503 });
  return Response.json({ key: keys.publicKey });
}
