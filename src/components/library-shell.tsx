'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense, useState } from 'react';
import { MemoarSymbol } from './memoar-brand';
import { useLibrary } from './library-provider';
import { LibraryConnection } from './library-connection';

export function NavIcon({ name }: { name: 'home' | 'explore' | 'settings' | 'search' | 'arrow' }) {
  if (name === 'settings') return <svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492M5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0" />
    <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 0 0 2.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 0 0 1.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 0 0-1.115 2.693l.16.291c.415.764-.42 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 0 0-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 0 0-2.692-1.115l-.292.16c-.764.415-1.6-.42-1.184-1.185l.159-.291A1.873 1.873 0 0 0 1.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 0 0 3.06 4.377l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 0 0 2.692-1.115z" />
  </svg>;
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === 'home' ? <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" /></> : name === 'explore' ? <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></> : name === 'search' ? <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></> : <><path d="M4 12h15m-6-6 6 6-6 6" /></>}
  </svg>;
}
export function FloatingSearch() {
  const router = useRouter(), pathname = usePathname(), params = useSearchParams(); const [draft, setDraft] = useState('');
  const currentChips = () => new URL(window.location.href).searchParams.getAll('q');
  const chips = params.getAll('q');
  function navigate(next: string[]) {
    const url = new URL('/app/explore', window.location.origin);
    if (pathname === '/app/explore') { const old = new URL(window.location.href); for (const key of ['platform', 'category', 'collection', 'status', 'sort']) { const value = old.searchParams.get(key); if (value) url.searchParams.set(key, value); } }
    next.forEach(chip => url.searchParams.append('q', chip)); router.push(url.pathname + url.search);
  }
  return <form className="floating-search" role="search" onSubmit={event => { event.preventDefault(); const term = draft.trim().slice(0, 120); if (term) { const next = [...new Set([...currentChips(), term])].slice(0, 12); navigate(next); setDraft(''); } }}>
    <NavIcon name="search" />
    <div className="search-content">
      {chips.map((chip, index) => <button type="button" key={chip} className="search-chip" aria-label={`Remove ${chip}`} onClick={() => navigate(currentChips().filter((_value, i) => i !== index))}>{chip}<span aria-hidden="true">×</span></button>)}
      <input aria-label="Find saved posts" placeholder={chips.length ? 'Add another term…' : 'Find something you’ve saved…'} value={draft} maxLength={120} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Backspace' && !draft) navigate(currentChips().slice(0, -1)); if (event.key === 'Escape') event.currentTarget.blur(); }} />
    </div>
    <button className="search-submit" aria-label="Search saved posts" type="submit" disabled={!draft.trim()}><NavIcon name="arrow" /></button>
  </form>;
}
export function LibraryShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname(), library = useLibrary();
  return <div className="library-layout">
    <Link href="/app" className="rail-brand" aria-label="Memoar home"><MemoarSymbol /></Link>
    <nav className="nav-rail" aria-label="Main navigation">{([
      ['home', 'Home', '/app'], ['explore', 'Explore', '/app/explore'], ['settings', 'Settings', '/app/settings'],
    ] as const).map(([icon, label, href]) => <Link href={href} key={href} aria-label={label} title={label} aria-current={(href === '/app' ? pathname === href : pathname.startsWith(href) || (icon === 'explore' && /\/app\/(saved|collections)/.test(pathname))) ? 'page' : undefined}><NavIcon name={icon} /><span className="rail-tooltip">{label}</span></Link>)}</nav>
    <Link className="rail-help" href="/getting-started" aria-label="Install guide" title="Install guide">?</Link>
    <main className="library-main">
      <div className="library-topline"><Link className="mobile-memoar-symbol" href="/app" aria-label="Memoar home"><MemoarSymbol /></Link>{library.busy && <span role="status">Updating your library…</span>}</div>
      {library.error && library.posts.length > 0 && <div className="connection-notice" role="status"><span>Your cached saves are available. {library.error}</span><button type="button" onClick={() => void library.refresh()}>Reconnect</button></div>}
      {library.loading || (library.busy && !library.posts.length && !library.connected) ? <div className="library-loading" aria-busy="true"><MemoarSymbol /><p>{library.progress}</p></div> : !library.connected && !library.posts.length && pathname !== '/app/settings' ? <LibraryConnection /> : children}
    </main>
    <Suspense fallback={null}><FloatingSearch /></Suspense>
  </div>;
}
