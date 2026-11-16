import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Motion } from '@/components/Motion';

const title = 'Motion Dojo Connect';
const description = 'Profiles and work from the Keyframe Ninjas, the students of Black Belt in Motion Design.';

export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description, siteName: 'Motion Dojo Connect', type: 'website' },
  twitter: { card: 'summary', title, description },
  icons: { icon: '/assets/favicon-128.png', apple: '/assets/favicon.png' },
};

export const viewport: Viewport = {
  themeColor: '#F6F4FB',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&display=swap" rel="stylesheet" />
        {/* Clash Display is served by Fontshare (Indian Type Foundry), free for commercial use */}
        <link rel="preconnect" href="https://api.fontshare.com" crossOrigin="anonymous" />
        <link href="https://api.fontshare.com/v2/css?f[]=clash-display@500,600,700&display=swap" rel="stylesheet" />
      </head>
      <body>
        {children}
        <Motion />
      </body>
    </html>
  );
}
