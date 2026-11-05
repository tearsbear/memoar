/// <reference types="chrome" />
import { normalizeSnapshot, validateRegion, type CaptureSnapshot, type SnapshotRegion } from '../src/lib/capture/snapshot';
import type { SnapshotCandidate } from './snapshot-region';

export function pixelCrop(region: SnapshotRegion, bitmapWidth: number, bitmapHeight: number) {
  validateRegion(region);
  const sx = bitmapWidth / region.viewportWidth, sy = bitmapHeight / region.viewportHeight;
  if (sx < 0.5 || sy < 0.5 || sx > 5 || sy > 5 || Math.abs(sx - sy) > 0.05) throw new Error('Viewport dimensions changed during snapshot.');
  const width = Math.floor(region.width * sx), height = Math.floor(region.height * sy);
  const scale = Math.min(1, 720 / Math.max(width, height));
  return { x: Math.floor(region.x * sx), y: Math.floor(region.y * sy), width, height, outputWidth: Math.max(1, Math.round(width * scale)), outputHeight: Math.max(1, Math.round(height * scale)) };
}

export async function takeSnapshot(tabId: number, windowId: number, url: string, candidate: SnapshotCandidate | null): Promise<CaptureSnapshot> {
  if (!candidate) return { status: 'unavailable', reason: 'No single unobscured visible media region was identified. Captured fields are retained.' };
  try {
    const region = validateRegion(candidate.region);
    if (!Number.isInteger(candidate.mediaIndex) || candidate.mediaIndex < 0 || candidate.mediaIndex > 10000 || typeof candidate.mediaSource !== 'string' || candidate.mediaSource.length > 4096) throw new Error('Invalid media region.');
    const guard = async () => {
      const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (active?.id !== tabId || active.windowId !== windowId || active.url !== url) throw new Error('Source tab changed.');
      const [probe] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, world: 'ISOLATED', args: [candidate, url],
        func: (target: SnapshotCandidate, expectedUrl: string) => {
          const panel = (globalThis as typeof globalThis & { __memoarPopover?: { host: HTMLElement } }).__memoarPopover?.host.getBoundingClientRect();
          const region = target.region;
          if (panel && panel.left < region.x + region.width && panel.right > region.x && panel.top < region.y + region.height && panel.bottom > region.y) return false;
          const node = document.querySelectorAll<HTMLImageElement | HTMLVideoElement>('img, video')[target.mediaIndex];
          if (!node || location.href !== expectedUrl || (node.currentSrc || node.getAttribute('src') || '') !== target.mediaSource) return false;
          const r = node.getBoundingClientRect(), b = target.region;
          const x = Math.max(0, r.left), y = Math.max(0, r.top);
          if ([x - b.x, y - b.y, Math.min(innerWidth, r.right) - x - b.width, Math.min(innerHeight, r.bottom) - y - b.height,
            innerWidth - b.viewportWidth, innerHeight - b.viewportHeight, scrollX - b.scrollX, scrollY - b.scrollY].some(delta => Math.abs(delta) > 1)) return false;
          let frame = node.parentElement;
          for (let next = frame?.parentElement, depth = 0; next && depth < 8; next = next.parentElement, depth++) {
            const bounds = next.getBoundingClientRect();
            if ([bounds.left - r.left, bounds.top - r.top, bounds.width - r.width, bounds.height - r.height].some(delta => Math.abs(delta) > 2)) break;
            frame = next;
          }
          return [[0.2, 0.2], [0.8, 0.2], [0.5, 0.5], [0.2, 0.8], [0.8, 0.8]].every(([px, py]) => frame?.contains(document.elementsFromPoint(x + b.width * px, y + b.height * py)[0]));
        },
      });
      if (probe?.result !== true) throw new Error('Media moved, changed, or became obscured.');
    };
    await guard();
    const screenshot = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
    await guard();
    const encoded = screenshot.split(',')[1];
    if (!screenshot.startsWith('data:image/png;base64,') || encoded.length > 32 * 1024 * 1024) throw new Error('Unsupported screenshot.');
    const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    try {
      const crop = pixelCrop(region, bitmap.width, bitmap.height);
      const canvas = new OffscreenCanvas(crop.outputWidth, crop.outputHeight);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Snapshot encoder unavailable.');
      context.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.outputWidth, crop.outputHeight);
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.65 });
      const jpeg = new Uint8Array(await blob.arrayBuffer());
      let binary = ''; for (const byte of jpeg) binary += String.fromCharCode(byte);
      return normalizeSnapshot({ status: 'available', dataUrl: `data:image/jpeg;base64,${btoa(binary)}`, width: crop.outputWidth, height: crop.outputHeight })!;
    } finally { bitmap.close(); }
  } catch {
    return { status: 'unavailable', reason: 'Snapshot could not be captured safely, encoded, or kept within its size limit. Captured fields are retained. Keep the media visible and capture again.' };
  }
}
