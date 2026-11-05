'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@astryxdesign/core/Button';
import { useLibrary } from './library-provider';
import { SavedGrid, SavedImage, platformNames } from './saved-card';
import { collections, searchScore } from '@/lib/library/search';

export function ExploreLibrary({ collectionId }: { collectionId?: string }) {
  const library = useLibrary(), params = useSearchParams(), router = useRouter(); const [limit, setLimit] = useState(48);
  const queryKey = params.toString(); useEffect(() => setLimit(48), [queryKey, collectionId]);
  const groups = collections(library.posts), collection = groups.find(group => group.id === (collectionId || params.get('collection')));
  const platform = params.get('platform') || '', category = params.get('category') || '', status = params.get('status') || '', sort = params.get('sort') || 'recent';
  const chips = params.getAll('q').slice(0, 12).map(chip => chip.slice(0, 120));
  const categories = [...new Set(library.posts.map(post => post.enrichment?.category).filter((value): value is string => Boolean(value)))].sort();
  const visible = (collectionId || params.get('collection') ? collection?.posts ?? [] : library.posts).filter(post => (!platform || post.capture.inspection.platform === platform) && (!category || post.enrichment?.category === category) && (!status || (status === 'failed' ? post.aiStatus.startsWith('failed') : post.aiStatus === status))).map(post => ({ post, score: searchScore(post, chips) })).filter(result => result.score > 0).sort((a, b) => sort === 'relevance' && chips.length ? b.score - a.score || b.post.savedAt.localeCompare(a.post.savedAt) : sort === 'oldest' ? a.post.savedAt.localeCompare(b.post.savedAt) : b.post.savedAt.localeCompare(a.post.savedAt)).map(result => result.post);
  function filter(key: string, value: string) { const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key); router.push(`?${next}`); }
  const showCollections = params.get('view') === 'collections' && !collectionId;
  const filtered = Boolean(chips.length || platform || category || status || params.get('collection'));
  return <>
    <header className="view-heading explore-heading">{collectionId && <Link className="back-link" href="/app/explore?view=collections">← Collections</Link>}<h1>{collectionId ? collection?.title || 'Collection unavailable' : 'Explore'}</h1><p>{collectionId ? `${visible.length} ${visible.length === 1 ? 'save' : 'saves'} connected by a shared interest.` : 'Follow an idea. Find a connection. Come back to something good.'}</p></header>
    {!collectionId && <div className="view-switch" aria-label="Library view"><button aria-pressed={!showCollections} onClick={() => filter('view', '')}>All saves</button><button aria-pressed={showCollections} onClick={() => filter('view', 'collections')}>Collections <span>{groups.length}</span></button></div>}
    {showCollections ? groups.length ? <div className="collection-grid">{groups.map(group => {
      const href = `/app/collections/${encodeURIComponent(group.id)}`;
      return <Link className="collection-cover" key={group.id} href={href}>
        <div className="collection-cover-heading"><h2>{group.title}</h2><span className="collection-count">{group.posts.length} {group.posts.length === 1 ? 'save' : 'saves'}</span></div>
        <div className="collection-cover-images">{group.posts.slice(0, 3).map(post => <SavedImage post={post} key={post.id} />)}</div>
      </Link>;
    })}</div> : <div className="empty-library"><h2>Ideas will find their connections.</h2><p>Collections grow automatically as Muse Spark organizes your saved posts in the background.</p><Link href="/app/explore" className="memoar-link-button">View saved posts</Link></div> : <>
      <div className="explore-filters"><div className="platform-filters" aria-label="Filter by platform"><button aria-pressed={!platform} onClick={() => filter('platform', '')}>All platforms</button>{Object.entries(platformNames).map(([key, name]) => <button key={key} aria-pressed={platform === key} onClick={() => filter('platform', key)}><img src={`/platforms/${key}.svg`} width="16" height="16" alt="" />{name}</button>)}</div>
        <div className="filter-selects"><label><span className="visually-hidden">Category</span><select value={category} onChange={event => filter('category', event.target.value)}><option value="">All categories</option>{categories.map(value => <option key={value}>{value}</option>)}</select></label><label><span className="visually-hidden">AI status</span><select value={status} onChange={event => filter('status', event.target.value)}><option value="">All statuses</option><option value="completed">Ready</option><option value="pending">Pending</option><option value="processing">Organizing</option><option value="failed">Needs attention</option></select></label><label><span className="visually-hidden">Sort saves</span><select value={sort} onChange={event => filter('sort', event.target.value)}><option value="recent">Recently saved</option><option value="oldest">Oldest first</option>{chips.length > 0 && <option value="relevance">Relevance</option>}</select></label></div>
      </div>
      <div className="result-heading"><p>{visible.length} {visible.length === 1 ? 'save' : 'saves'}{chips.length ? ` matching ${chips.map(chip => `“${chip}”`).join(' + ')}` : ''}</p>{filtered && <Link href={collectionId ? `/app/collections/${encodeURIComponent(collectionId)}` : '/app/explore'}>Clear filters</Link>}</div>
      {visible.length ? <><SavedGrid posts={visible.slice(0, limit)} />{visible.length > limit && <div className="load-more"><Button label="Show more saves" onClick={() => setLimit(value => value + 48)} /></div>}</> : <div className="empty-library"><h2>{filtered ? 'No saves match just yet.' : 'Your saved posts will show up here.'}</h2><p>{filtered ? 'Remove a search term or clear a filter to give your ideas more room.' : 'Save a post with the Memoar extension, then return here to find it again.'}</p><Link className="memoar-link-button" href={filtered ? collectionId ? `/app/collections/${encodeURIComponent(collectionId)}` : '/app/explore' : '/getting-started'}>{filtered ? 'Clear filters' : 'See how to save a post'}</Link></div>}
    </>}
  </>;
}
