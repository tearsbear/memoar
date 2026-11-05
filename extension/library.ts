import { libraryStore } from '../src/lib/library/store';
import { defaultPreferences, type LibraryPreferences, type LibraryAsset, type SavedPost } from '../src/lib/library/types';
import type { LibraryRequest } from '../src/lib/library/protocol';
import { parseEnrichment } from '../src/lib/library/enrichment';
import { parsePostUrl } from '../src/lib/inspection/parse-url';
import type { CaptureEnvelope } from '../src/lib/capture/normalize';
import { MEMOAR_ORIGIN, LOCAL_MEMOAR_ORIGIN } from '../src/lib/capture/protocol';
import { MEDIA_CHUNK_BYTES } from '../src/lib/capture/media-cache';
import { claimMediaTransfer, transferMedia } from './media-transfer';
import { reviewIntervalMs } from '../src/lib/library/review';

export const savedLibrary = libraryStore('memoar-library');
export async function preferences(): Promise<LibraryPreferences> {
  const stored = await chrome.storage.local.get(['preferences', 'reviewDefaultsApplied']);
  const prefs = { ...defaultPreferences, ...stored.preferences as Partial<LibraryPreferences>, aiEnabled: true, reminders: true };
  if (stored.reviewDefaultsApplied !== true) {
    prefs.cadence = 'daily'; prefs.ageDays = 0;
    await chrome.storage.local.set({ preferences: prefs, reviewDefaultsApplied: true });
  }
  return prefs;
}
export async function saveToLibrary(captureId: string, capture: CaptureEnvelope): Promise<SavedPost> {
  const parsed = parsePostUrl(capture.inspection.normalizedUrl);
  const id = `${parsed.platform}:${parsed.postId}`;
  const previous = await savedLibrary.get(id);
  if (previous) return previous;
  const prefs = await preferences();
  const assets: LibraryAsset[] = [];
  let note: string | null = null;
  const manifest = await claimMediaTransfer(captureId) ?? [];
  let storedImages = 0;
  for (const asset of manifest) {
    const video = asset.mimeType === 'video/mp4';
    if ((!video && storedImages + asset.byteLength > 12 * 1024 * 1024) || (video && !prefs.aiEnabled)) {
      note = 'Some media is available only through the original post.'; continue;
    }
    try {
      const bytes = new Uint8Array(asset.byteLength);
      for (let offset = 0; offset < bytes.length; offset += MEDIA_CHUNK_BYTES) {
        const chunk = await transferMedia({ type: 'TAKE_MEDIA_CHUNK', captureId, itemIndex: asset.itemIndex, offset });
        const decoded = atob(chunk.base64 ?? '');
        if (decoded.length !== Math.min(MEDIA_CHUNK_BYTES, bytes.length - offset)) throw new Error('Incomplete media.');
        for (let i = 0; i < decoded.length; i++) bytes[offset + i] = decoded.charCodeAt(i);
      }
      assets.push({ itemIndex: asset.itemIndex, mimeType: asset.mimeType, blob: new Blob([bytes], { type: asset.mimeType }), ...(video ? { temporaryUntil: Date.now() + 86400000 } : {}) });
      if (!video) storedImages += asset.byteLength;
    } catch { note = 'Some media could not be stored. Your captured text and available preview are saved.'; }
  }
  const now = new Date().toISOString();
  const post: SavedPost = { version: 1, id, capture, savedAt: now, updatedAt: now, aiStatus: 'pending', aiConsent: prefs.aiEnabled,
    aiError: null, enrichment: null, attempts: 0, nextAttemptAt: 0, leaseUntil: 0, model: null,
    mediaStored: assets.filter(asset => !asset.temporaryUntil).map(asset => asset.itemIndex), mediaNote: note };
  await savedLibrary.put(post, assets);
  return post;
}
let working = false;
export async function runEnrichmentQueue() {
  if (working) return;
  working = true;
  try {
    await savedLibrary.purgeTemporary();
    if (!(await preferences()).aiEnabled) return;
    for (const item of await savedLibrary.list()) {
      if (MEMOAR_ORIGIN !== LOCAL_MEMOAR_ORIGIN && item.aiError?.startsWith('This post is too large for the AI server.')) await savedLibrary.update(item.id, value => ({ ...value, aiStatus: 'failed_terminal', aiError: 'This post exceeds the hosted 4 MiB AI request limit. Retrying here will not help. Switch to the local extension build and local server, then retry there. Your post remains saved.', aiErrorCode: 'payload_too_large', aiErrorOrigin: MEMOAR_ORIGIN, leaseUntil: 0, updatedAt: new Date().toISOString() }));
      if (!item.aiConsent) await savedLibrary.update(item.id, value => ({ ...value, aiConsent: true, nextAttemptAt: 0, updatedAt: new Date().toISOString() }));
      if (item.aiStatus === 'processing' && item.leaseUntil <= Date.now() && item.attempts >= 3) await savedLibrary.update(item.id, value => ({ ...value, aiStatus: 'failed_terminal', aiError: 'Processing was interrupted. Retry organizing when ready.', leaseUntil: 0, updatedAt: new Date().toISOString() }));
    }
    const token = (await chrome.storage.local.get('enrichmentAccessCode')).enrichmentAccessCode;
    const post = (await savedLibrary.list()).find(item => item.aiConsent && item.nextAttemptAt <= Date.now() && (item.aiStatus === 'pending' || item.aiStatus === 'failed_retryable' || (item.aiStatus === 'processing' && item.leaseUntil <= Date.now())) && item.attempts < 3);
    if (!post) return;
    if (typeof token !== 'string' || !token) {
      await savedLibrary.update(post.id, value => ({ ...value, aiStatus: 'failed_retryable', aiError: 'Open Memoar to connect background organizing.', nextAttemptAt: Date.now() + 300000, updatedAt: new Date().toISOString() })); return;
    }
    await savedLibrary.update(post.id, value => ({ ...value, aiStatus: 'processing', attempts: value.attempts + 1, leaseUntil: Date.now() + 300000, updatedAt: new Date().toISOString() }));
    // Chrome API activity keeps an active job alive; the persisted lease handles termination.
    const keepAlive = setInterval(() => { void chrome.runtime.getPlatformInfo().catch(() => {}); }, 20000);
    let oversized = false;
    const sizeError = MEMOAR_ORIGIN === LOCAL_MEMOAR_ORIGIN
      ? 'This post exceeds the local 53 MiB AI request limit. Retrying unchanged will not help. Your post remains saved.'
      : 'This post exceeds the hosted 4 MiB AI request limit. Retrying here will not help. Switch to the local extension build and local server, then retry there. Your post remains saved.';
    try {
      const form = new FormData();
      form.set('capture', JSON.stringify(post.capture));
      for (const asset of await savedLibrary.assets(post.id)) form.append(`media-${asset.itemIndex}`, asset.blob, `slide-${asset.itemIndex}.${asset.mimeType === 'video/mp4' ? 'mp4' : 'image'}`);
      const response = await fetch(`${MEMOAR_ORIGIN}/api/enrich`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form, redirect: 'error', signal: AbortSignal.timeout(240000) });
      if (!response.ok) {
        if (response.status === 413) { oversized = true; throw new Error(sizeError); }
        const failure = await response.json();
        throw new Error(typeof failure.error === 'string' ? failure.error : 'AI processing is temporarily unavailable.');
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error('AI processing returned no result.');
      const decoder = new TextDecoder(); let buffer = '', result: { ok?: boolean; enrichment?: unknown; error?: string; code?: string; inputNote?: string } | undefined;
      try {
        while (true) {
          const chunk = await reader.read(); if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          if (buffer.length > 2 * 1024 * 1024) throw new Error('AI result exceeded its size limit.');
          let end: number;
          while ((end = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
            if (!line.trim()) continue;
            const event = JSON.parse(line);
            if (event.type === 'result') result = event;
          }
        }
      } finally { reader.releaseLock(); }
      if (result?.code === 'payload_too_large') { oversized = true; throw new Error(sizeError); }
      if (!result?.ok) throw new Error(result?.error || 'AI processing was interrupted. Try again.');
      const enrichment = parseEnrichment(result.enrichment);
      await savedLibrary.update(post.id, value => value.savedAt !== post.savedAt ? value : ({ ...value, aiStatus: 'completed', enrichment, model: 'muse-spark-1.3', aiInputNote: result?.inputNote, aiError: null, aiErrorCode: undefined, aiErrorOrigin: undefined, leaseUntil: 0, updatedAt: new Date().toISOString() }));
      await savedLibrary.dropTemporary(post.id, post.savedAt);
    } catch (error) {
      await savedLibrary.update(post.id, value => value.savedAt !== post.savedAt ? value : ({ ...value, aiStatus: oversized || value.attempts >= 3 ? 'failed_terminal' : 'failed_retryable', aiError: error instanceof Error ? error.message.slice(0, 300) : 'Could not organize this post.', aiErrorCode: oversized ? 'payload_too_large' : undefined, aiErrorOrigin: oversized ? MEMOAR_ORIGIN : undefined, leaseUntil: 0, nextAttemptAt: Date.now() + value.attempts * 60000, updatedAt: new Date().toISOString() }));
    } finally { clearInterval(keepAlive); }
  } finally { working = false; }
}
export async function libraryMessage(request: LibraryRequest): Promise<Record<string, unknown>> {
  switch (request.type) {
    case 'MEMOAR_TEST_NOTIFICATION':
    case 'MEMOAR_NOTIFICATION_STATUS': throw new Error('Notification requests must be handled by the background worker.');
    case 'MEMOAR_SET_ACCESS_CODE':
      await chrome.storage.local.set({ enrichmentAccessCode: request.code });
      for (const post of await savedLibrary.list()) if (post.aiConsent && post.aiStatus === 'failed_retryable' && post.attempts === 0) await savedLibrary.update(post.id, value => ({ ...value, aiStatus: 'pending', aiError: null, nextAttemptAt: 0, updatedAt: new Date().toISOString() }));
      return {};
    case 'MEMOAR_PING': return { protocolVersion: 1, version: chrome.runtime.getManifest().version };
    case 'MEMOAR_LIBRARY_SUMMARY': {
      const posts = await savedLibrary.list();
      return { count: posts.length, revision: posts.map(post => `${post.id}:${post.updatedAt}`).sort().join('|') };
    }
    case 'MEMOAR_LIST_POSTS': {
      const posts = (await savedLibrary.list()).sort((a, b) => a.id.localeCompare(b.id));
      return { posts: posts.slice(request.offset, request.offset + 4), total: posts.length };
    }
    case 'MEMOAR_GET_POST': return { post: await savedLibrary.get(request.id) ?? null };
    case 'MEMOAR_GET_ASSET': {
      const asset = (await savedLibrary.assets(request.id)).find(item => item.itemIndex === request.itemIndex && !item.temporaryUntil);
      if (!asset || request.offset >= asset.blob.size || request.offset % MEDIA_CHUNK_BYTES) throw new Error('Saved image is unavailable.');
      const bytes = new Uint8Array(await asset.blob.slice(request.offset, request.offset + MEDIA_CHUNK_BYTES).arrayBuffer());
      let text = ''; for (let i = 0; i < bytes.length; i += 16384) text += String.fromCharCode(...bytes.subarray(i, i + 16384));
      return { base64: btoa(text), byteLength: asset.blob.size, mimeType: asset.mimeType };
    }
    case 'MEMOAR_DELETE_POST': await savedLibrary.remove(request.id); return {};
    case 'MEMOAR_CLEAR': await savedLibrary.clear(); return {};
    case 'MEMOAR_REVIEW': {
      const interval = reviewIntervalMs((await preferences()).cadence);
      await savedLibrary.update(request.id, post => ({ ...post, ...(request.action === 'open' ? { lastOpenedAt: new Date().toISOString() } : request.action === 'keep' ? { lastReviewedAt: new Date().toISOString(), remindAfter: undefined } : { remindAfter: new Date(Date.now() + interval).toISOString() }), updatedAt: new Date().toISOString() })); return {};
    }
    case 'MEMOAR_RETRY_AI': {
      const post = await savedLibrary.get(request.id);
      if (post?.aiErrorCode === 'payload_too_large' && post.aiErrorOrigin === MEMOAR_ORIGIN) throw new Error(post.aiError || 'This post exceeds the server upload limit. Retrying unchanged will not help.');
      await savedLibrary.update(request.id, value => ({ ...value, aiStatus: 'pending', aiConsent: true, attempts: 0, nextAttemptAt: 0, aiError: null, aiErrorCode: undefined, aiErrorOrigin: undefined, updatedAt: new Date().toISOString() })); return {};
    }
    case 'MEMOAR_PREFERENCES': return { preferences: await preferences() };
    case 'MEMOAR_SET_PREFERENCES': {
      const prefs: LibraryPreferences = { aiEnabled: true, reminders: true, cadence: request.cadence, ageDays: request.ageDays };
      await chrome.storage.local.set({ preferences: prefs });
      if (prefs.aiEnabled) for (const post of await savedLibrary.list()) if (!post.aiConsent) await savedLibrary.update(post.id, value => ({ ...value, aiConsent: true, nextAttemptAt: 0, updatedAt: new Date().toISOString() }));
      return { preferences: prefs };
    }
  }
}
