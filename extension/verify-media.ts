import type { MediaCapture } from '../src/lib/inspection/types';
import { validateMediaReference } from '../src/lib/capture/normalize';
import { decodeMp4, inspectMp4, MAX_VIDEO_BYTES, mediaDigest } from '../src/lib/capture/mp4';
import { readResourceBytes } from '../src/lib/capture/media-resource';

type Dependencies = {
  transport?: typeof fetch;
  decode?: (blob: Blob) => Promise<{ width: number; height: number; close(): void }>;
  now?: () => Date;
  decodeVideo?: typeof decodeMp4;
  onVerified?: (itemIndex: number, bytes: Uint8Array<ArrayBuffer>, mimeType: string) => void;
};

export async function verifyMedia(media: MediaCapture, dependencies: Dependencies = {}): Promise<MediaCapture> {
  const result = structuredClone(media);
  const deadline = Date.now() + 15000;
  for (const [itemIndex, item] of result.items.entries()) {
    delete item.verification;
    if (!item.url) { item.assetAccess = 'unavailable'; continue; }
    if (item.url.startsWith('blob:')) { item.assetAccess = 'reference_only'; continue; }
    item.assetAccess = 'reference_only';
    if (Date.now() >= deadline) { item.reason = 'Media verification time budget was exhausted. The temporary URL remains reference_only.'; continue; }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(item.type === 'video' ? 7500 : 2500, deadline - Date.now()));
    try {
      validateMediaReference(item.url, 'instagram');
      const response = await (dependencies.transport ?? fetch)(item.url, { method: 'GET', mode: 'cors', credentials: 'omit', redirect: 'error', cache: 'no-store', signal: controller.signal });
      if (!response.ok || response.type === 'opaque' || response.redirected) {
        await response.body?.cancel();
        if (item.type === 'image' && [403, 404, 410].includes(response.status)) item.assetAccess = 'unavailable';
        item.reason = `Resource verification returned HTTP ${response.status}. This does not establish post privacy or deletion.`;
        continue;
      }
      const mimeType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      if (item.type === 'video') {
        if (response.status !== 200 || mimeType !== 'video/mp4' || response.headers.has('content-range')) {
          await response.body?.cancel(); throw new Error('A complete video/mp4 response is required; partial/DASH streams are not accepted.');
        }
        const bytes = await readResourceBytes(response, MAX_VIDEO_BYTES);
        const metadata = inspectMp4(bytes);
        const decoded = await (dependencies.decodeVideo ?? decodeMp4)(new Blob([bytes], { type: mimeType }), controller.signal);
        if (Math.abs(decoded.duration - metadata.durationSeconds) > Math.max(0.25, metadata.durationSeconds * 0.01)) throw new Error('MP4 decoded duration does not match sample timing.');
        item.width = decoded.width; item.height = decoded.height;
        item.verification = { method: 'cors_get', mimeType, byteLength: bytes.length, checkedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
          durationSeconds: metadata.durationSeconds, audio: metadata.audio, sha256: await mediaDigest(bytes) };
        item.assetAccess = 'verified_accessible';
        dependencies.onVerified?.(itemIndex, bytes, mimeType);
        item.reason = `Anonymous CORS GET returned a complete MP4 within 25 MiB. Sample ranges/timing and first-frame decoding were checked; audio track ${metadata.audio}. CDN access is temporary and AI permission remains unverified.`;
        continue;
      }
      const maximum = 10 * 1024 * 1024;
      if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'].includes(mimeType) || Number(response.headers.get('content-length')) > maximum) {
        await response.body?.cancel();
        if (!mimeType.startsWith('image/')) item.assetAccess = 'unavailable';
        item.reason = 'Unsupported MIME type or image exceeds the 10 MiB verification limit.'; continue;
      }
      const reader = response.body?.getReader();
      if (!reader) continue;
      const parts: Uint8Array<ArrayBuffer>[] = [];
      let size = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > maximum) { await reader.cancel(); throw new Error('Image size limit.'); }
          parts.push(new Uint8Array(value));
        }
      } finally { reader.releaseLock(); }
      const blob = new Blob(parts, { type: mimeType });
      const image = await (dependencies.decode ?? createImageBitmap)(blob);
      try {
        if (image.width <= 0 || image.height <= 0) throw new Error('Image could not be decoded.');
        item.width = image.width; item.height = image.height;
        item.assetAccess = 'verified_accessible';
        item.verification = { method: 'cors_get', mimeType, byteLength: size, checkedAt: (dependencies.now ?? (() => new Date()))().toISOString() };
        if (dependencies.onVerified) dependencies.onVerified(itemIndex, new Uint8Array(await blob.arrayBuffer()), mimeType);
        item.reason = 'Anonymous CORS GET returned a supported image MIME type and readable, decoded image bytes. Access is observed at capture time; AI permission remains unverified.';
      } finally { image.close(); }
    } catch (error) {
      item.assetAccess = 'reference_only'; delete item.verification;
      item.reason = item.type === 'video'
        ? `MP4 verification failed: ${error instanceof Error ? error.message.slice(0, 300) : 'CORS, network, decoding, or time limit.'} The temporary URL remains reference_only; audio and processing permission are not assumed.`
        : 'Independent image verification could not finish (CORS, network, decoding, or time limit). The observed URL remains a reference only.';
    } finally { clearTimeout(timer); }
  }
  return result;
}
