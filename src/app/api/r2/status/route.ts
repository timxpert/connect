import { presign, signHeaders } from '@/lib/r2';

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
    // R2 keys: Access Key ID is 32 characters, Secret Access Key is 64
    accessKeyIdLength: env('R2_ACCESS_KEY_ID').length,
    secretLength: env('R2_SECRET_ACCESS_KEY').length,
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
    const report: Record<string, unknown> = { name: bucket };
    try {
      // 1. CORS rules (bucket settings need a header-signed request)
      const path = `/${encodeURIComponent(bucket)}`;
      const headers = signHeaders({ ...base, method: 'GET', path, query: { cors: '' } });
      const res = await fetch(`https://${base.host}${path}?cors=`, { headers, cache: 'no-store' });
      const text = await res.text();
      report.corsHttp = res.status;
      if (res.ok) {
        report.corsOrigins = [...text.matchAll(/<AllowedOrigin>([^<]*)<\/AllowedOrigin>/g)].map((m) => m[1]);
        report.corsMethods = [...text.matchAll(/<AllowedMethod>([^<]*)<\/AllowedMethod>/g)].map((m) => m[1]);
        report.corsHeaders = [...text.matchAll(/<AllowedHeader>([^<]*)<\/AllowedHeader>/g)].map((m) => m[1]);
      } else {
        report.corsError = tag(text, 'Code');
        report.corsMessage = tag(text, 'Message');
      }
      // 2. A real upload with the same kind of link phones get, then tidy up
      const key = `_connect-check/${Date.now()}.txt`;
      const put = await fetch(presign({ ...base, method: 'PUT', bucket, key, expires: 60 }), { method: 'PUT', body: 'ok', headers: { 'Content-Type': 'text/plain' } });
      report.uploadHttp = put.status;
      if (!put.ok) {
        const t = await put.text();
        report.uploadError = tag(t, 'Code');
        report.uploadMessage = tag(t, 'Message');
      } else {
        const delPath = `${path}/${key.split('/').map(encodeURIComponent).join('/')}`;
        await fetch(`https://${base.host}${delPath}`, { method: 'DELETE', headers: signHeaders({ ...base, method: 'DELETE', path: delPath }) }).catch(() => {});
      }
    } catch (e) {
      report.error = (e as Error).message;
    }
    (out.buckets as Record<string, unknown>)[label] = report;
  }
  return Response.json(out);
}
