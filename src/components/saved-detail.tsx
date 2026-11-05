'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@astryxdesign/core/Button';
import { useLibrary } from './library-provider';
import { SavedGrid, SavedImage, PlatformLabel } from './saved-card';
import { ConfirmDialog } from './confirm-dialog';
import { postTitle, relatedPosts } from '@/lib/library/search';
import { dashboardCache, extensionRequest, validateSavedPost } from '@/lib/library/client';
import type { SavedPost } from '@/lib/library/types';

export function SavedDetail({ id: routeId }: { id: string }) {
  let id = routeId;
  try { id = decodeURIComponent(routeId); } catch { /* Keep invalid route values unmatched. */ }
  const library = useLibrary(), router = useRouter();
  const [origin, setOrigin] = useState('');
  useEffect(() => { setOrigin(window.location.origin); }, []);
  const [slide, setSlide] = useState(0), [confirming, setConfirming] = useState(false), [error, setError] = useState(''); const opened = useRef('');
  const [fetched, setFetched] = useState<SavedPost | null>(null), [checkedId, setCheckedId] = useState('');
  const post = library.posts.find(item => item.id === id) || (fetched?.id === id ? fetched : undefined);
  useEffect(() => {
    if (post || !library.connected || library.busy || checkedId === id) return;
    let active = true;
    void extensionRequest(library.extensionId, { type: 'MEMOAR_GET_POST', id }).then(async response => {
      if (response.post) { const record = validateSavedPost(response.post); if (active) setFetched(record); await dashboardCache.put(record); }
    }).catch(failure => { if (active) setError(failure instanceof Error ? failure.message : 'Could not load this save.'); }).finally(() => { if (active) setCheckedId(id); });
    return () => { active = false; };
  }, [id, post, library.connected, library.busy, library.extensionId, checkedId]);
  useEffect(() => { if (post && library.connected && !library.busy && opened.current !== id) { opened.current = id; void library.mutate({ type: 'MEMOAR_REVIEW', id, action: 'open' }).catch(() => { opened.current = ''; }); } }, [id, post, library.connected, library.busy]);
  if (!post && (library.loading || library.busy || library.connected && checkedId !== id)) return <div className="empty-library" role="status" aria-busy="true"><h2>Opening your save…</h2><p>Checking your library for this post.</p></div>;
  if (!post) return <div className="empty-library"><h1>This save isn’t in your library.</h1><p>{error || 'It may have been removed, or the extension needs to finish connecting.'}</p><Link href="/app/explore" className="memoar-link-button">Back to your saves</Link></div>;
  const inspection = post.capture.inspection, media = inspection.media?.items ?? [], related = relatedPosts(post, library.posts);
  const slides = media.length ? media : [null];
  const current = slides[Math.min(slide, slides.length - 1)];
  const caption = inspection.fields.captionText.value || inspection.fields.textContent.value;
  const oversized = post.aiErrorCode === 'payload_too_large' || post.aiError?.startsWith('This post is too large for the AI server.');
  const sizeBlocked = oversized && !post.aiError?.includes('4 MiB') && (post.aiErrorOrigin ? !origin || post.aiErrorOrigin === origin : origin !== 'http://localhost:3000');
  return <>
    <Link href="/app/explore" className="saved-back-button" aria-label="Back to your saved posts" title="Back to your saved posts"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg></Link>
    <div className="saved-detail"><section className="detail-media"><SavedImage post={post} index={slide} detail />{slides.length > 1 && <div className="carousel-controls"><button aria-label="Previous captured slide" disabled={slide === 0} onClick={() => setSlide(value => value - 1)}>←</button><span>{slide + 1} of {slides.length} captured{current?.position ? ` · Original slide ${current.position}` : ''}</span><button aria-label="Next captured slide" disabled={slide >= slides.length - 1} onClick={() => setSlide(value => value + 1)}>→</button></div>}{current?.type === 'video' && <p className="media-note">Video is not kept as a permanent local file. <a href={inspection.normalizedUrl} target="_blank" rel="noreferrer">Watch the original ↗</a></p>}{inspection.media?.completeness === 'partial' && <p className="media-note">Partial capture. Some original slides or media were not captured.</p>}{post.mediaNote && <p className="media-note">{post.mediaNote}</p>}</section>
    <section className="detail-copy"><PlatformLabel platform={inspection.platform} /><h1>{postTitle(post)}</h1><p className="detail-meta">{inspection.fields.authorHandle.value ? `@${inspection.fields.authorHandle.value.replace(/^@/, '')}` : 'Author not captured'} · Saved {new Date(post.savedAt).toLocaleDateString('en', { dateStyle: 'medium' })}</p>
      <div className="action-row"><a href={inspection.normalizedUrl} className="memoar-link-button" target="_blank" rel="noreferrer">Open original ↗</a><Button label="Remove from Memoar" variant="ghost" onClick={() => setConfirming(true)} /></div>
      {caption && <section className="detail-section"><h2>Caption from the post</h2><p className="captured-caption">{caption}</p></section>}
      {post.enrichment ? <><section className="detail-section"><h2>Tags &amp; keywords</h2><div className="topic-chips">{[post.enrichment.category, ...post.enrichment.topics].filter((term): term is string => Boolean(term)).map((term, index) => <Link key={`${term}-${index}`} href={`/app/explore?q=${encodeURIComponent(term)}`}>{term}</Link>)}</div></section><p className="media-note">Organized by Muse Spark. AI descriptions may be imperfect; check the captured post for context.</p></> : <section className="detail-section ai-state"><h2>{oversized ? 'AI upload limit reached.' : post.aiStatus === 'processing' ? 'Finding the connections…' : post.aiStatus === 'pending' ? 'Waiting to organize.' : 'Your save is safe.'}</h2><p>{post.aiError || 'Your post is saved locally. Organizing happens in the background.'}</p>{oversized && <p>Retrying unchanged will not fix a processing size limit. For an older 4 MiB hosted failure, update the extension and configure private temporary storage before retrying. Video input may expire after 24 hours.</p>}{post.aiStatus.startsWith('failed') && !sizeBlocked && <Button label={post.aiErrorCode === 'storage_not_configured' ? 'Retry after setup' : 'Retry organizing'} clickAction={async () => { setError(''); try { await library.mutate({ type: 'MEMOAR_RETRY_AI', id }); } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not retry.'); } }} />}{error && <p className="memoar-error" role="alert">{error}</p>}</section>}
    </section></div>
    <section className="memoar-section"><div className="memoar-section-heading"><h2>Related saved posts</h2></div>{related.length ? <SavedGrid posts={related} /> : <p className="muted">No related saves yet.</p>}</section>
    {confirming && <ConfirmDialog title="Remove this post from Memoar?" description="This removes your local Memoar copy, not the original social post." label="Remove post" onCancel={() => setConfirming(false)} onConfirm={async () => { await library.mutate({ type: 'MEMOAR_DELETE_POST', id }); router.push('/app/explore'); }} />}
  </>;
}
