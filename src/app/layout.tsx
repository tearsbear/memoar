import type { Metadata } from 'next';
import './globals.css';
import './memoar.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'Memoar · Keep what inspires you',
  description: 'A personal, searchable home for the social posts and ideas you want to find again.',
  icons: { icon: '/memoar-icon.png' },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en" data-theme="light" data-astryx-theme="neutral"><body><Providers>{children}</Providers></body></html>;
}
