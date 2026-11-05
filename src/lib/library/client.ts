import { EXTENSION_ID, isRecord } from '../capture/protocol';
import { MEDIA_CHUNK_BYTES } from '../capture/media-cache';
import { normalizeCapture } from '../capture/normalize';
import type { LibraryRequest } from './protocol';
import { libraryStore } from './store';
import type { SavedPost } from './types';
import { parseEnrichment } from './enrichment';

export const dashboardCache = libraryStore('memoar-dashboard-cache');
export function extensionRequest(extensionId: string, message: LibraryRequest): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const runtime = (globalThis as typeof globalThis & { chrome?: { runtime?: { lastError?: { message?: string }; sendMessage: (id: string, message: unknown, callback: (value: unknown) => void) => void } } }).chrome?.runtime;
    if (!runtime || !EXTENSION_ID.test(extensionId)) { reject(new Error('Open Memoar from the extension in the same Chrome profile, or enter its ID below.')); return; }
    const timer = setTimeout(() => reject(new Error('Memoar extension did not respond. Check that it is enabled and try again.')), 8000);
    try { runtime.sendMessage(extensionId, message, value => {
      clearTimeout(timer);
      if (runtime.lastError || !isRecord(value) || value.ok !== true) { reject(new Error(isRecord(value) && typeof value.error === 'string' ? value.error : 'Memoar extension is unavailable. Check the extension and retry.')); return; }
      resolve(value);
    }); } catch { clearTimeout(timer); reject(new Error('Could not connect to Memoar in this browser.')); }
  });
}
export function validateSavedPost(value: unknown): SavedPost {
  if (!isRecord(value) || value.version !== 1 || typeof value.id !== 'string' || typeof value.savedAt !== 'string' || !Number.isFinite(Date.parse(value.savedAt)) || typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt)) || !['pending', 'processing', 'completed', 'failed_retryable', 'failed_terminal'].includes(String(value.aiStatus)) || !Array.isArray(value.mediaStored) || value.mediaStored.length > 20 || !value.mediaStored.every(index => Number.isInteger(index) && Number(index) >= 0 && Number(index) < 20)) throw new Error('The extension returned an invalid saved post.');
  const capture = normalizeCapture(value.capture);
  if (value.id !== `${capture.inspection.platform}:${capture.inspection.fields.postId.value}`) throw new Error('Saved post identity does not match its capture.');
  if (value.enrichment !== null) parseEnrichment(value.enrichment);
  return { ...value, capture } as SavedPost;
}
export async function importLibrary(extensionId: string, progress: (count: number, total: number) => void) {
  const before = await extensionRequest(extensionId, { type: 'MEMOAR_LIBRARY_SUMMARY' });
  const total = Number(before.count);
  if (!Number.isInteger(total) || total < 0 || total > 100000) throw new Error('Library size is invalid.');
  const posts: SavedPost[] = [];
  for (let offset = 0; offset < total; offset += 4) {
    const response = await extensionRequest(extensionId, { type: 'MEMOAR_LIST_POSTS', offset });
    if (!Array.isArray(response.posts) || !response.posts.length || response.posts.length > 4 || response.total !== total) throw new Error('Your library changed during import. Please retry.');
    posts.push(...response.posts.map(validateSavedPost)); progress(posts.length, total);
  }
  const after = await extensionRequest(extensionId, { type: 'MEMOAR_LIBRARY_SUMMARY' });
  if (before.revision !== after.revision || posts.length !== total || new Set(posts.map(post => post.id)).size !== total) throw new Error('Your library changed during import. Please retry.');
  await dashboardCache.reconcile(posts);
  return posts;
}
const imageLoads = new Map<string, Promise<Blob>>();
export function loadSavedImage(extensionId: string, post: SavedPost, index: number): Promise<Blob> {
  const key = `${extensionId}:${post.id}:${post.updatedAt}:${index}`;
  let promise = imageLoads.get(key);
  if (!promise) {
    promise = (async () => {
      const cached = (await dashboardCache.assets(post.id)).find(asset => asset.itemIndex === index);
      if (cached) return cached.blob;
      let offset = 0, total = 0, mimeType = ''; const chunks: Uint8Array<ArrayBuffer>[] = [];
      do {
        const response = await extensionRequest(extensionId, { type: 'MEMOAR_GET_ASSET', id: post.id, itemIndex: index, offset });
        if (!Number.isInteger(response.byteLength) || Number(response.byteLength) < 1 || Number(response.byteLength) > 12 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(String(response.mimeType)) || typeof response.base64 !== 'string' || response.base64.length > Math.ceil(MEDIA_CHUNK_BYTES / 3) * 4) throw new Error('Saved image is invalid.');
        if (offset && (total !== response.byteLength || mimeType !== response.mimeType)) throw new Error('Saved image changed during transfer.');
        total = Number(response.byteLength); mimeType = String(response.mimeType);
        const binary = atob(response.base64), bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
        if (bytes.byteLength !== Math.min(MEDIA_CHUNK_BYTES, total - offset)) throw new Error('Saved image transfer was incomplete.');
        chunks.push(bytes); offset += bytes.byteLength;
      } while (offset < total);
      const blob = new Blob(chunks, { type: mimeType });
      await dashboardCache.cacheAsset(post.id, { itemIndex: index, mimeType, blob });
      return blob;
    })().finally(() => { imageLoads.delete(key); });
    imageLoads.set(key, promise);
  }
  return promise;
}
