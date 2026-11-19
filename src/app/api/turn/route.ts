import { adminClient, caller } from '@/lib/server-auth';

/* Connection details for calls. Most calls go straight from phone to phone;
   when a network blocks that, Cloudflare's relay (TURN) carries the call.
   Needs CLOUDFLARE_TURN_KEY_ID and CLOUDFLARE_TURN_KEY_TOKEN in Vercel
   (secret, never NEXT_PUBLIC). Without them calls still work on most networks. */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STUN = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];

export async function GET(req: Request) {
  const admin = adminClient();
  if (!admin) return Response.json({ iceServers: STUN });
  const uid = await caller(req, admin);
  if (!uid) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const id = process.env.CLOUDFLARE_TURN_KEY_ID;
  const token = process.env.CLOUDFLARE_TURN_KEY_TOKEN;
  if (!id || !token) return Response.json({ iceServers: STUN, relay: false });
  try {
    const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${id}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: 12 * 3600 }),
    });
    if (!res.ok) return Response.json({ iceServers: STUN, relay: false });
    const body = (await res.json()) as { iceServers?: unknown };
    const servers = Array.isArray(body.iceServers) ? body.iceServers : body.iceServers ? [body.iceServers] : [];
    return Response.json({ iceServers: [...STUN, ...servers], relay: true });
  } catch {
    return Response.json({ iceServers: STUN, relay: false });
  }
}
