import { captureCarousel } from './capture-carousel';
import { snapshotCandidate } from './snapshot-region';
import { CAPTURE_TTL_MS } from '../src/lib/capture/protocol';
import { MAX_HANDOFF_MEDIA_BYTES, type CapturedAsset } from '../src/lib/capture/media-cache';

type IsolatedCaptureWindow = typeof globalThis & {
  __memoarCaptureRequest?: { nonce: string; url: string; allSlides: boolean };
  __memoarCapturedMedia?: { nonce: string; expiresAt: number; assets: CapturedAsset[] };
};
const isolated = globalThis as IsolatedCaptureWindow;
const request = isolated.__memoarCaptureRequest;
delete isolated.__memoarCaptureRequest;
if (request) {
  if (isolated.__memoarCapturedMedia) isolated.__memoarCapturedMedia.assets.length = 0;
  const retained = { nonce: request.nonce, expiresAt: Date.now() + CAPTURE_TTL_MS, assets: [] as CapturedAsset[] };
  isolated.__memoarCapturedMedia = retained;
  const expire = setTimeout(() => { if (isolated.__memoarCapturedMedia === retained) delete isolated.__memoarCapturedMedia; retained.assets.length = 0; }, CAPTURE_TTL_MS);
  let size = 0;
  void captureCarousel(document, request.url, request.allSlides, { onVerified: (itemIndex, bytes, mimeType) => {
    if (size + bytes.length > MAX_HANDOFF_MEDIA_BYTES) throw new Error('Captured media exceeds the 50 MiB handoff limit.');
    size += bytes.length; retained.assets.push({ itemIndex, mimeType, byteLength: bytes.length, bytes });
  } }).then(
    payload => {
      let candidate = null;
      try { candidate = snapshotCandidate(document, request.url); } catch { /* DOM fields remain usable without a snapshot. */ }
      return chrome.runtime.sendMessage({ type: 'CAPTURE_RESULT', nonce: request.nonce, payload, candidate,
        mediaAssets: retained.assets.map(({ itemIndex, mimeType, byteLength }) => ({ itemIndex, mimeType, byteLength })) });
    },
    error => {
      clearTimeout(expire); retained.assets.length = 0;
      if (isolated.__memoarCapturedMedia === retained) delete isolated.__memoarCapturedMedia;
      return chrome.runtime.sendMessage({ type: 'CAPTURE_ERROR', nonce: request.nonce, message: error instanceof Error ? error.message : 'Capture failed.' });
    },
  );
}
