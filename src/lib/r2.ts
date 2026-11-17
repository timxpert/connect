import crypto from 'node:crypto';

/* Cloudflare R2 speaks the S3 API. This makes short-lived signed links
   (AWS Signature V4, query-string form) so phones can upload and read files
   directly from R2 without ever seeing the secret key. Server only. */

const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const hmac = (key: crypto.BinaryLike, data: string) => crypto.createHmac('sha256', key).update(data).digest();
const sha256 = (data: string) => crypto.createHash('sha256').update(data).digest('hex');

export type SignOptions = {
  method: 'GET' | 'PUT';
  host: string; // e.g. <account>.r2.cloudflarestorage.com
  bucket: string;
  key: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string; // R2 uses "auto"
  expires?: number; // seconds, max 7 days
  now?: Date;
  /** Path-style (/bucket/key, R2's default) or virtual-host style (bucket.host/key) */
  style?: 'path' | 'virtual';
  /** Extra query parameters, e.g. { cors: '' } to read a bucket's CORS rules */
  extra?: Record<string, string>;
};

export function presign(o: SignOptions): string {
  const region = o.region ?? 'auto';
  const now = o.now ?? new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); // YYYYMMDDTHHMMSSZ
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${region}/s3/aws4_request`;
  const host = o.style === 'virtual' ? `${o.bucket}.${o.host}` : o.host;
  const path = (o.style === 'virtual' ? '' : `/${enc(o.bucket)}`) + (o.key ? '/' + o.key.split('/').map(enc).join('/') : '');

  const query: [string, string][] = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${o.accessKeyId}/${scope}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(Math.min(o.expires ?? 900, 604800))],
    ['X-Amz-SignedHeaders', 'host'],
    ...Object.entries(o.extra ?? {}),
  ];
  const canonicalQuery = query
    .map(([k, v]) => [enc(k), enc(v)])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const canonicalRequest = [o.method, path, canonicalQuery, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const kDate = hmac(`AWS4${o.secretAccessKey}`, day);
  const kSigning = hmac(hmac(hmac(kDate, region), 's3'), 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(toSign).digest('hex');
  return `https://${host}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/** R2 settings from the environment, or null when R2 isn't set up */
export function r2Config() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const publicBucket = process.env.R2_PUBLIC_BUCKET;
  const privateBucket = process.env.R2_PRIVATE_BUCKET;
  const publicUrl = (process.env.NEXT_PUBLIC_R2_PUBLIC_URL || '').replace(/\/$/, '');
  if (!accountId || !accessKeyId || !secretAccessKey || !publicBucket || !privateBucket || !publicUrl) return null;
  return { host: `${accountId}.r2.cloudflarestorage.com`, accessKeyId, secretAccessKey, publicBucket, privateBucket, publicUrl };
}

/** Signs a request with an Authorization header (needed for bucket settings such as CORS) */
export function signHeaders(o: {
  method: string;
  host: string;
  path: string; // already encoded, e.g. /md-media or /md-media/a.txt
  query?: Record<string, string>;
  headers?: Record<string, string>;
  payloadHash?: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  service?: string;
  now?: Date;
}): Record<string, string> {
  const region = o.region ?? 'auto';
  const service = o.service ?? 's3';
  const now = o.now ?? new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${region}/${service}/aws4_request`;
  const payloadHash = o.payloadHash ?? sha256('');
  const headers: Record<string, string> = { host: o.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate, ...(o.headers ?? {}) };
  const names = Object.keys(headers)
    .map((h) => h.toLowerCase())
    .sort();
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()]));
  const canonicalHeaders = names.map((h) => `${h}:${lower[h]}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalQuery = Object.entries(o.query ?? {})
    .map(([k, v]) => [enc(k), enc(v)])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const canonicalRequest = [o.method, o.path, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const kDate = hmac(`AWS4${o.secretAccessKey}`, day);
  const kSigning = hmac(hmac(hmac(kDate, region), service), 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(toSign).digest('hex');
  const out: Record<string, string> = { ...headers };
  delete out.host;
  out.Authorization = `AWS4-HMAC-SHA256 Credential=${o.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return out;
}
