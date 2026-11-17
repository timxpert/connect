import { presign } from '@/lib/r2';

/**
 * Temporary setup check for R2. Shows which settings are present (never their
 * values) and what Cloudflare says about the buckets and their CORS rules.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NAMES = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_PUBLIC_BUCKET', 'R2_PRIVATE_BUCKET', 'NEXT_PUBLIC_R2_PUBLIC_URL', 'SUPABASE_SERVICE_ROLE_KEY'];

const tag = (xml: string, t: string) => xml.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`))?.[1] ?? null;

export async function GET() {
  const present = Object.fromEntries(NAMES.map((n) => [n, Boolean(process.env[n]?.trim())]));
  const env = (n: string) => (process.env[n] || '').trim();
  const accountId = env('R2_ACCOUNT_ID');
  const out: Record<string, unknown> = {
    present,
    accountIdLooksRight: /^[0-9a-f]{32}$/i.test(accountId),
    // Shape only (the ID isn't a secret, but no need to show it): length and stray parts
    accountIdShape: {
      length: accountId.length,
      startsWith: accountId.slice(0, 4),
      hasHttps: /https?:/i.test(accountId),
      hasDot: accountId.includes('.'),
      hasSlash: accountId.includes('/'),
      hasSpaceOrQuote: /[\s"']/.test(accountId),
      nonHexCharacters: accountId.replace(/[0-9a-f]/gi, '').slice(0, 12),
    },
    deployedAt: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    publicUrl: env('NEXT_PUBLIC_R2_PUBLIC_URL') || null,
    buckets: {},
  };
  if (!accountId || !env('R2_ACCESS_KEY_ID') || !env('R2_SECRET_ACCESS_KEY')) return Response.json(out);

  const base = { host: `${accountId}.r2.cloudflarestorage.com`, accessKeyId: env('R2_ACCESS_KEY_ID'), secretAccessKey: env('R2_SECRET_ACCESS_KEY') };
  for (const [label, bucket] of [
    ['public', env('R2_PUBLIC_BUCKET')],
    ['private', env('R2_PRIVATE_BUCKET')],
  ] as const) {
    if (!bucket) continue;
    try {
      const url = presign({ ...base, method: 'GET', bucket, key: '', extra: { cors: '' }, expires: 60 });
      const res = await fetch(url, { cache: 'no-store' });
      const text = await res.text();
      (out.buckets as Record<string, unknown>)[label] = {
        name: bucket,
        http: res.status,
        error: res.ok ? null : tag(text, 'Code') || text.slice(0, 200),
        corsOrigins: res.ok ? [...text.matchAll(/<AllowedOrigin>([^<]*)<\/AllowedOrigin>/g)].map((m) => m[1]) : null,
        corsMethods: res.ok ? [...text.matchAll(/<AllowedMethod>([^<]*)<\/AllowedMethod>/g)].map((m) => m[1]) : null,
        corsHeaders: res.ok ? [...text.matchAll(/<AllowedHeader>([^<]*)<\/AllowedHeader>/g)].map((m) => m[1]) : null,
      };
    } catch (e) {
      (out.buckets as Record<string, unknown>)[label] = { name: bucket, error: (e as Error).message };
    }
  }
  return Response.json(out);
}
