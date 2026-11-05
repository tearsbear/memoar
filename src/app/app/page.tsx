'use client';
import Link from 'next/link';
import { useLibrary } from '@/components/library-provider';
import { SavedGrid } from '@/components/saved-card';
import { collections } from '@/lib/library/search';
import { ReviewQueue } from '@/components/review-queue';

export default function HomePage() {
  const { posts } = useLibrary();
  const groups = collections(posts), recent = [...posts].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  const ready = posts.filter(post => post.aiStatus === 'completed').length;
  return <>
    <header className="view-heading"><p className="overline">A place for your ideas</p><h1>Your saved world.</h1><p>A little inspiration, always worth coming back to.</p></header>
    {!posts.length ? <div className="empty-library"><h2>Start with something worth keeping.</h2><p>Open a post, click Memoar in Chrome, then choose <strong>Add to Memoar</strong>. Your first save will show up here.</p><Link className="memoar-link-button" href="/getting-started">See how to save a post</Link></div> : <>
      <div className="library-stats"><div><strong>{posts.length}</strong><span>Saved {posts.length === 1 ? 'post' : 'posts'}</span></div><div><strong>{ready}</strong><span>Organized with AI</span></div><div><strong>{groups.length}</strong><span>Collections to revisit</span></div><div><strong>{new Set(posts.map(post => post.capture.inspection.platform)).size}</strong><span>Platforms in your library</span></div></div>
      {groups.length > 0 && <section className="memoar-section"><div className="memoar-section-heading"><h2>Threads of inspiration</h2><Link href="/app/explore?view=collections">All collections ↗</Link></div><div className="collection-strip">{groups.slice(0, 5).map(group => <Link className="collection-tile" key={group.id} href={`/app/collections/${encodeURIComponent(group.id)}`}><span>{group.posts.length} {group.posts.length === 1 ? 'save' : 'saves'}</span><h3>{group.title}</h3><span className="collection-arrow" aria-hidden="true">↗</span></Link>)}</div></section>}
      <ReviewQueue />
      <section className="memoar-section"><div className="memoar-section-heading"><h2>Recently kept</h2><Link href="/app/explore">All your saves ↗</Link></div><SavedGrid posts={recent.slice(0, 12)} /></section>
    </>}
  </>;
}
