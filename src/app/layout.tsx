import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Motion } from '@/components/Motion';

const title = 'Motion Dojo Connect';
const description = 'Profiles and work from Black Belt in Motion Design.';

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
        {/* photos, videos and data: open the connections before they're needed */}
        {process.env.NEXT_PUBLIC_SUPABASE_URL && <link rel="preconnect" href={process.env.NEXT_PUBLIC_SUPABASE_URL} crossOrigin="anonymous" />}
        {process.env.NEXT_PUBLIC_R2_PUBLIC_URL && <link rel="preconnect" href={process.env.NEXT_PUBLIC_R2_PUBLIC_URL} />}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400&display=swap" rel="stylesheet" />
      </head>
      <body>
        {children}
        <Motion />
      </body>
    </html>
  );
}
