'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { LibraryProvider, useLibrary } from './library-provider';
import { LibraryConnection } from './library-connection';
import { MemoarBrand } from './memoar-brand';
function SetupContent() {
  const library = useLibrary(), router = useRouter();
  useEffect(() => { if (library.connected && !library.busy && library.lastImport && !library.error) router.replace('/app'); }, [library.connected, library.busy, library.lastImport, library.error, router]);
  return <main className="setup-screen"><div className="setup-glow" aria-hidden="true" /><Link className="setup-brand" href="/" aria-label="Memoar home"><MemoarBrand /></Link><div className="setup-content">{library.busy || library.loading ? <div className="setup-progress" role="status"><h1>A place for your ideas.</h1><p>{library.progress}</p><span className="setup-progress-dot" aria-hidden="true" /></div> : <LibraryConnection />}</div><p className="setup-footnote">Your library stays with this browser profile.</p></main>;
}
export function SetupMemoar() { return <LibraryProvider><SetupContent /></LibraryProvider>; }
