'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { SavedPost } from '@/lib/library/types';
import { loadSavedImage } from '@/lib/library/client';
import { postTitle } from '@/lib/library/search';
import { useLibrary } from './library-provider';

export const platformNames = { instagram: 'Instagram', threads: 'Threads', facebook: 'Facebook' };
export function PlatformLabel({ platform }: { platform: keyof typeof platformNames }) { return <span className="platform-label"><img src={`/platforms/${platform}.svg`} width="15" height="15" alt="" />{platformNames[platform]}</span>; }
export function SavedImage({ post, index, detail = false }: { post: SavedPost; index?: number; detail?: boolean }) {
  const { extensionId } = useLibrary(); const [src, setSrc] = useState(''), [failed, setFailed] = useState(false);
  const itemIndex = index ?? post.mediaStored[0];
  const snapshot = post.capture.snapshot;
  const item = post.capture.inspection.media?.items[itemIndex ?? 0];
  useEffect(() => {
    let active = true, objectUrl = ''; setSrc(''); setFailed(false);
    if (itemIndex !== undefined && post.mediaStored.includes(itemIndex)) void loadSavedImage(extensionId, post, itemIndex).then(blob => { if (active) { objectUrl = URL.createObjectURL(blob); setSrc(objectUrl); } }).catch(() => { if (active) setSrc(''); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [extensionId, post.id, post.updatedAt, itemIndex]);
  // Snapshots remain display-only and are never included in enrichment input.
  const fallback = snapshot?.status === 'available' && (index === undefined || index === 0) ? snapshot.dataUrl : '';
  const source = src || (!failed ? fallback : '');
  if (!source) return <div className={`text-preview ${detail ? 'text-preview-detail' : ''}`}><span className="preview-quote">“</span><p>{post.capture.inspection.fields.captionText.value || post.capture.inspection.fields.textContent.value || 'The original post holds the rest of this idea.'}</p><span>{item?.type === 'video' ? 'Video stays on the original post' : 'Saved without a local image'}</span></div>;
  return <figure className="saved-image"><img src={source} alt={detail ? 'Captured post media' : ''} width={src ? item?.width ?? undefined : snapshot?.status === 'available' ? snapshot.width : undefined} height={src ? item?.height ?? undefined : snapshot?.status === 'available' ? snapshot.height : undefined} loading="lazy" onError={() => { if (src) setSrc(''); else setFailed(true); }} />{detail && !src && <figcaption>Captured preview only. Open the original for full media.</figcaption>}</figure>;
}
export function SavedCard({ post }: { post: SavedPost }) {
  const platform = post.capture.inspection.platform;
  return <article className="saved-card"><Link href={`/app/saved/${encodeURIComponent(post.id)}`} className="saved-card-link">
    <div className="saved-card-media"><SavedImage post={post} /><span className="card-open">Open save ↗</span></div>
    <div className="saved-card-copy"><PlatformLabel platform={platform} /><h3>{postTitle(post)}</h3><p>{post.capture.inspection.fields.authorHandle.value ? `@${post.capture.inspection.fields.authorHandle.value.replace(/^@/, '')}` : 'Author not captured'}<span> · </span><time dateTime={post.savedAt}>{new Date(post.savedAt).toLocaleDateString('en', { month: 'short', day: 'numeric' })}</time></p>
      <span className="card-status">{post.aiStatus === 'completed' ? post.enrichment?.category || 'Ready to explore' : post.aiStatus === 'pending' ? 'Waiting to organize' : post.aiStatus === 'processing' ? 'Organizing…' : 'Saved · AI needs attention'}</span>
    </div>
  </Link></article>;
}
export function SavedGrid({ posts }: { posts: SavedPost[] }) { return <div className="saved-masonry">{posts.map(post => <SavedCard key={post.id} post={post} />)}</div>; }
