import { normalizeCapture, type CaptureEnvelope } from './normalize';
import { CAPTURE_ID, EXTENSION_ID, isRecord, isMemoarOrigin, MEMOAR_ORIGIN, type MediaTransferRequest } from './protocol';
import { attachCapturedAssets, MEDIA_CHUNK_BYTES, parseCapturedAssetInfo, type CapturedAsset } from './media-cache';

type BridgeRequest = { type: 'TAKE_CAPTURE'; captureId: string } | MediaTransferRequest;
type ExternalRuntime = { sendMessage: (id: string, request: BridgeRequest, callback: (response: unknown) => void) => void; lastError?: { message?: string } };
export type ChromeWebRuntime = { runtime?: ExternalRuntime };

function requestMessage(runtime: ExternalRuntime | undefined, extensionId: string, request: BridgeRequest): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    if (!EXTENSION_ID.test(extensionId) || !CAPTURE_ID.test(request.captureId)) { reject(new Error('Invalid extension or capture ID.')); return; }
    if (!runtime) { reject(new Error('The Chrome extension bridge is unavailable. Open Memoar in Chrome, or use Paste captured JSON.')); return; }
    const timer = setTimeout(() => reject(new Error('Extension handoff timed out. Use Copy captured JSON → Paste captured JSON, or capture again.')), 5000);
    try {
      runtime.sendMessage(extensionId, request, response => {
        clearTimeout(timer);
        const runtimeError = runtime.lastError;
        if (runtimeError) { reject(new Error('Could not connect to the extension. Check that it is enabled, or use Paste captured JSON.')); return; }
        if (!isRecord(response) || response.ok !== true) { reject(new Error(isRecord(response) && typeof response.error === 'string' ? response.error : 'Extension returned no capture.')); return; }
        resolve(response);
      });
    } catch { clearTimeout(timer); reject(new Error('The extension bridge could not be opened. Use Paste captured JSON.')); }
  });
}

export async function requestCapture(runtime: ExternalRuntime | undefined, extensionId: string, captureId: string): Promise<CaptureEnvelope> {
  const response = await requestMessage(runtime, extensionId, { type: 'TAKE_CAPTURE', captureId });
  const capture = normalizeCapture(response.payload);
  const media = capture.inspection.media;
  if (response.mediaAssets === undefined || !media) return capture;
  const assets: CapturedAsset[] = [];
  const deadline = Date.now() + 60000;
  try {
    const manifest = parseCapturedAssetInfo(response.mediaAssets, media);
    for (const info of manifest) {
      const bytes = new Uint8Array(info.byteLength);
      for (let offset = 0; offset < bytes.length; offset += MEDIA_CHUNK_BYTES) {
        if (Date.now() >= deadline) throw new Error('Media handoff timed out.');
        const chunk = await requestMessage(runtime, extensionId, { type: 'TAKE_MEDIA_CHUNK', captureId, itemIndex: info.itemIndex, offset });
        const expected = Math.min(MEDIA_CHUNK_BYTES, bytes.length - offset);
        if (typeof chunk.base64 !== 'string' || chunk.base64.length !== Math.ceil(expected / 3) * 4 || /[^A-Za-z0-9+/=]/.test(chunk.base64)) throw new Error('Invalid captured media chunk.');
        const decoded = atob(chunk.base64);
        if (decoded.length !== expected) throw new Error('Captured media chunk was truncated.');
        for (let i = 0; i < decoded.length; i++) bytes[offset + i] = decoded.charCodeAt(i);
      }
      assets.push({ ...info, bytes });
    }
  } catch {
    capture.inspection.warnings.push('Some captured media bytes could not be imported. Keep the source post tab open, capture again, then use Open in Memoar before exporting.');
  } finally {
    attachCapturedAssets(media, assets);
    await requestMessage(runtime, extensionId, { type: 'RELEASE_MEDIA', captureId }).catch(() => {});
  }
  return capture;
}

export function createCaptureImporter() {
  const imports = new Map<string, Promise<CaptureEnvelope>>();
  return (runtime: ExternalRuntime | undefined, extensionId: string, captureId: string) => {
    const key = `${extensionId}:${captureId}`;
    let request = imports.get(key);
    if (!request) {
      request = requestCapture(runtime, extensionId, captureId);
      imports.set(key, request);
    }
    return request;
  };
}

export function captureLinkParameters(url: URL): { captureId: string; extensionId: string } | null {
  if (!url.searchParams.has('captureId') && !url.searchParams.has('extensionId')) return null;
  if (!isMemoarOrigin(url.origin)) throw new Error(`Open the inspector at ${MEMOAR_ORIGIN} for extension handoff.`);
  const captureId = url.searchParams.get('captureId') ?? '';
  const extensionId = url.searchParams.get('extensionId') ?? '';
  if (url.searchParams.getAll('captureId').length !== 1 || url.searchParams.getAll('extensionId').length !== 1 || !CAPTURE_ID.test(captureId) || !EXTENSION_ID.test(extensionId)) {
    throw new Error('The extension capture link is invalid. Capture the post again or paste captured JSON.');
  }
  return { captureId, extensionId };
}
