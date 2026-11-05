import { LibraryProvider } from '@/components/library-provider';
import { LibraryShell } from '@/components/library-shell';
export default function AppLayout({ children }: { children: React.ReactNode }) { return <LibraryProvider><LibraryShell>{children}</LibraryShell></LibraryProvider>; }
