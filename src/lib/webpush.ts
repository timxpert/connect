import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

/* Web Push, done by hand (no extra package): the notifications a phone shows
   when Connect is closed, like WhatsApp.
   - Keys (VAPID) are made once and kept in the push_keys table, which only
     the server can read. Nothing to set up in Vercel.
   - Each message is encrypted for the phone (RFC 8291, aes128gcm) and signed
     (RFC 8292) before it goes to Google/Apple/Mozilla's push service. */

export type PushSub = { endpoint: string; p256dh: string; auth: string };
type Keys = { publicKey: string; privateJwk: crypto.JsonWebKey };

const b64u = (b: Buffer) => b.toString('base64url');
const fromB64u = (s: string) => Buffer.from(s, 'base64url');

let cached: Keys | null = null;

/** The server's push keys, made the first time they're needed */
export async function pushKeys(admin: SupabaseClient): Promise<Keys | null> {
  if (cached) return cached;
  const { data, error } = await admin.from('push_keys').select('public_key, private_jwk').eq('id', 1).maybeSingle();
  if (error) return null; // push.sql not run yet
  if (data) {
    const row = data as { public_key: string; private_jwk: crypto.JsonWebKey };
    cached = { publicKey: row.public_key, privateJwk: row.private_jwk };
    return cached;
  }
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  const pub = publicKey.export({ format: 'jwk' });
  const raw = Buffer.concat([Buffer.from([4]), fromB64u(pub.x!), fromB64u(pub.y!)]);
  const keys = { publicKey: b64u(raw), privateJwk: jwk };
  // first writer wins if two requests race
  await admin.from('push_keys').insert({ id: 1, public_key: keys.publicKey, private_jwk: keys.privateJwk });
  const { data: again } = await admin.from('push_keys').select('public_key, private_jwk').eq('id', 1).maybeSingle();
  const row = again as { public_key: string; private_jwk: crypto.JsonWebKey } | null;
  cached = row ? { publicKey: row.public_key, privateJwk: row.private_jwk } : keys;
  return cached;
}

function vapidHeader(endpoint: string, keys: Keys) {
  const aud = new URL(endpoint).origin;
  const head = b64u(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(Buffer.from(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'mailto:hello@joinmotiondojo.com' })));
  const key = crypto.createPrivateKey({ key: keys.privateJwk, format: 'jwk' });
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${keys.publicKey}`;
}

function encrypt(sub: PushSub, payload: Buffer) {
  const uaPublic = fromB64u(sub.p256dh);
  const authSecret = fromB64u(sub.auth);
  const ecdh = crypto.createECDH('prime256v1');
  const asPublic = ecdh.generateKeys();
  const shared = ecdh.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const salt = crypto.randomBytes(16);
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const sealed = Buffer.concat([cipher.update(Buffer.concat([payload, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, sealed]);
}

/** Sends one notification. Returns false when the phone has unsubscribed (remove it). */
export async function sendPush(sub: PushSub, data: Record<string, unknown>, keys: Keys): Promise<boolean> {
  try {
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: vapidHeader(sub.endpoint, keys),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: '86400',
        Urgency: 'high',
      },
      body: encrypt(sub, Buffer.from(JSON.stringify(data))),
    });
    return !(res.status === 404 || res.status === 410);
  } catch {
    return true;
  }
}
