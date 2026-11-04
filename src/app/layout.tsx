import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'Memoar / Post Inspector',
  description: 'Inspect Meta post URL access, official previews, and AI payload readiness.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en" data-theme="dark" data-astryx-theme="neutral"><body><Providers>{children}</Providers></body></html>;
}
