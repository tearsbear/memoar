import type { MediaCapture } from '../inspection/types';
import { isRecord } from './protocol';

export const MAX_HANDOFF_MEDIA_BYTES = 50 * 1024 * 1024;
export const MEDIA_CHUNK_BYTES = 512 * 1024;
export type CapturedAssetInfo = { itemIndex: number; mimeType: string; byteLength: number };
export type CapturedAsset = CapturedAssetInfo & { bytes: Uint8Array<ArrayBuffer> };

// Bytes stay outside inspection JSON and are released with the in-memory report.
const cache = new WeakMap<MediaCapture, CapturedAsset[]>();
export function attachCapturedAssets(media: MediaCapture, assets: CapturedAsset[]): void { cache.set(media, assets); }
export function capturedAssets(media: MediaCapture | undefined): CapturedAsset[] | undefined { return media ? cache.get(media) : undefined; }

export function parseCapturedAssetInfo(value: unknown, media: MediaCapture | undefined): CapturedAssetInfo[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) throw new Error('Invalid captured media manifest.');
  const seen = new Set<number>();
  let total = 0;
  return value.map(entry => {
    if (!isRecord(entry) || !Number.isInteger(entry.itemIndex)) throw new Error('Invalid captured media index.');
    const itemIndex = Number(entry.itemIndex), item = media?.items[itemIndex];
    if (itemIndex < 0 || !item || seen.has(itemIndex) || item.assetAccess !== 'verified_accessible' || !item.verification
      || entry.mimeType !== item.verification.mimeType || entry.byteLength !== item.verification.byteLength) throw new Error('Captured bytes do not match media verification.');
    seen.add(itemIndex); total += item.verification.byteLength;
    if (total > MAX_HANDOFF_MEDIA_BYTES) throw new Error('Captured media exceeds the 50 MiB handoff limit.');
    return { itemIndex, mimeType: item.verification.mimeType, byteLength: item.verification.byteLength };
  });
}
