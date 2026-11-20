import { cookies } from 'next/headers';

// Lets phones install Connect like an app. The colour behind the app (shown
// for a moment while it opens or while the keyboard moves) follows the theme
// the person uses: Dojo Midnight for dark, white for light. Phones save it
// when the app is installed and refresh it from time to time.
export const dynamic = 'force-dynamic';

export async function GET() {
  const dark = (await cookies()).get('cx-theme')?.value === 'dark';
  const ground = dark ? '#140a2e' : '#ffffff';
  const manifest = {
    name: 'Motion Dojo Connect',
    short_name: 'Connect',
    description: 'Profiles, lessons and messages for Black Belt in Motion Design.',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: ground,
    theme_color: ground,
    icons: [
      { src: '/assets/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/assets/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/assets/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
  return new Response(JSON.stringify(manifest), {
    headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'no-store' },
  });
}
