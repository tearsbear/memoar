'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@astryxdesign/core/Button';
import { useLibrary } from './library-provider';
import { postTitle } from '@/lib/library/search';
import { REVIEW_DEMO_INTERVAL_MS, reviewIntervalMs } from '@/lib/library/review';

export function ReviewQueue() {
  const library = useLibrary(); const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  if (!library.preferences.reminders) return null;
  const cadence = reviewIntervalMs(library.preferences.cadence);
  const post = [...library.posts].filter(item => now - Date.parse(item.lastOpenedAt || item.savedAt) >= Math.max(REVIEW_DEMO_INTERVAL_MS, library.preferences.ageDays * 86400000) && (!item.lastReviewedAt || now - Date.parse(item.lastReviewedAt) >= cadence) && (!item.remindAfter || Date.parse(item.remindAfter) <= now)).sort((a, b) => a.savedAt.localeCompare(b.savedAt))[0];
  if (!post) return null;
  const act = async (action: 'keep' | 'later') => { setError(''); try { await library.mutate({ type: 'MEMOAR_REVIEW', id: post.id, action }); } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not update your review.'); } };
  return <section className="review-card"><div><p className="overline">Worth revisiting?</p><h2>{postTitle(post)}</h2><p>You kept this on {new Date(post.savedAt).toLocaleDateString('en', { month: 'long', day: 'numeric' })}.</p></div><div className="action-row"><Link className="memoar-link-button" href={`/app/saved/${encodeURIComponent(post.id)}`}>Review this save</Link><Button label="Keep" clickAction={() => act('keep')} /><Button label="Remind me later" variant="ghost" clickAction={() => act('later')} /></div>{error && <p role="alert" className="memoar-error">{error}</p>}</section>;
}
