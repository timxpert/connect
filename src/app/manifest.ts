import type { MetadataRoute } from 'next';

// Lets phones add Connect to the home screen and open it like an app
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Motion Dojo Connect',
    short_name: 'Connect',
    description: 'Profiles, lessons and messages for Black Belt in Motion Design.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f6f4fb',
    theme_color: '#ffffff',
    icons: [
      { src: '/assets/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/assets/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/assets/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
