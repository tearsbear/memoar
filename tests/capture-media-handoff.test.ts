import { afterEach, expect, it, vi } from 'vitest';
import { requestCapture } from '../src/lib/capture/bridge';
import { capturedAssets, MEDIA_CHUNK_BYTES, parseCapturedAssetInfo } from '../src/lib/capture/media-cache';
import { isMediaTransferRequest } from '../src/lib/capture/protocol';
import { normalizeCapture } from '../src/lib/capture/normalize';
import { mediaDigest } from '../src/lib/capture/mp4';
import { readExportImages } from '../src/lib/inspection/test-script';
import { captureFixture } from './capture-fixture';
import { mp4Box, mp4Fixture } from './mp4-fixture';
import { claimMediaTransfer, rememberMediaTransfer, transferMedia } from '../extension/media-transfer';

const id = '12345678-1234-4234-8234-123456789abc', extensionId = 'a'.repeat(32);
async function fixture(large = false) {
  let bytes = mp4Fixture();
  if (large) {
    const padding = mp4Box('free', new Uint8Array(MEDIA_CHUNK_BYTES));
    const combined = new Uint8Array(bytes.length + padding.length); combined.set(bytes); combined.set(padding, bytes.length); bytes = combined;
  }
  const raw = captureFixture();
  const capture = normalizeCapture({ ...raw, inspection: { ...raw.inspection, media: {
    kind: 'single', totalSlides: 1, completeness: 'complete', navigation: 'not_requested', reason: 'Fixture capture.', items: [{
      position: 1, type: 'video', url: 'https://scontent.cdninstagram.com/fixture.mp4', referenceUrl: null, posterUrl: null,
      width: 1080, height: 1920, assetAccess: 'verified_accessible', reason: 'Fixture verification.', processingEligibility: 'unverified',
      verification: { method: 'cors_get', mimeType: 'video/mp4', byteLength: bytes.length, checkedAt: '2026-11-05T00:00:00Z', durationSeconds: 2, audio: 'present', sha256: await mediaDigest(bytes) },
    }],
  } } });
  return { capture, bytes, info: { itemIndex: 0, mimeType: 'video/mp4', byteLength: bytes.length } };
}
afterEach(() => vi.unstubAllGlobals());

it('imports chunked actual MP4 bytes and exports with no CDN request from localhost', async () => {
  const { capture, bytes, info } = await fixture(true);
  const sendMessage = vi.fn((_extension: string, request: unknown, callback: (response: unknown) => void) => {
    const message = request as { type: string; offset?: number };
    if (message.type === 'TAKE_CAPTURE') callback({ ok: true, payload: capture, mediaAssets: [info] });
    else if (message.type === 'TAKE_MEDIA_CHUNK') callback({ ok: true, base64: Buffer.from(bytes.subarray(message.offset!, message.offset! + MEDIA_CHUNK_BYTES)).toString('base64') });
    else callback({ ok: true });
  });
  const imported = await requestCapture({ sendMessage }, extensionId, id);
  expect(capturedAssets(imported.inspection.media)![0].bytes).toEqual(bytes);
  const transport = vi.fn(async () => { throw new Error('CORS from localhost'); });
  const assets = await readExportImages(imported.inspection, 'museSpark', '', { transport });
  expect(assets[0].bytes).toEqual(bytes); expect(transport).not.toHaveBeenCalled();
  expect(sendMessage.mock.calls.map(call => (call[1] as { type: string }).type)).toEqual(['TAKE_CAPTURE', 'TAKE_MEDIA_CHUNK', 'TAKE_MEDIA_CHUNK', 'RELEASE_MEDIA']);
  expect(JSON.stringify(imported)).not.toMatch(/"base64"|"bytes"|"mediaAssets"/);
});

it('retains the inspection after missing/truncated bytes and gives an actionable export error without fetching', async () => {
  const { capture, info } = await fixture();
  for (const response of [{ ok: false, error: 'Source tab closed.' }, { ok: true, base64: 'AQ==' }]) {
    const runtime = { sendMessage: (_extension: string, request: unknown, callback: (response: unknown) => void) => {
      const type = (request as { type: string }).type;
      callback(type === 'TAKE_CAPTURE' ? { ok: true, payload: capture, mediaAssets: [info] } : type === 'RELEASE_MEDIA' ? { ok: true } : response);
    } };
    const imported = await requestCapture(runtime, extensionId, id);
    expect(imported.inspection.fields.captionText.value).toBe('Fixture caption #test');
    expect(imported.inspection.warnings.at(-1)).toContain('media bytes could not be imported');
    const transport = vi.fn();
    await expect(readExportImages(imported.inspection, 'museSpark', '', { transport })).rejects.toThrow('Captured media bytes are missing');
    expect(transport).not.toHaveBeenCalled();
  }
});

it('bounds descriptors to verified media and rejects unrelated or oversized chunk request shapes', async () => {
  const { capture, info } = await fixture();
  expect(parseCapturedAssetInfo([info], capture.inspection.media)).toEqual([info]);
  for (const invalid of [[info, info], [{ ...info, itemIndex: 1 }], [{ ...info, byteLength: info.byteLength + 1 }], [{ ...info, mimeType: 'text/html' }]]) {
    expect(() => parseCapturedAssetInfo(invalid, capture.inspection.media)).toThrow();
  }
  expect(isMediaTransferRequest({ type: 'TAKE_MEDIA_CHUNK', captureId: id, itemIndex: 0, offset: 0 })).toBe(true);
  for (const request of [{ type: 'TAKE_MEDIA_CHUNK', captureId: id, itemIndex: -1, offset: 0 },
    { type: 'TAKE_MEDIA_CHUNK', captureId: id, itemIndex: 0, offset: -1 },
    { type: 'RELEASE_MEDIA', captureId: id, arbitraryUrl: 'https://other.example/' }]) expect(isMediaTransferRequest(request)).toBe(false);
});

it('requires a claimed, unexpired capture and clears the source bytes after handoff', async () => {
  const { capture, info } = await fixture();
  const stored: Record<string, unknown> = {};
  const executeScript = vi.fn(async () => [{ result: 'fixture-chunk' }]);
  vi.stubGlobal('chrome', { storage: { session: {
    get: async (key: string) => ({ [key]: stored[key] }),
    set: async (value: Record<string, unknown>) => { Object.assign(stored, value); },
    remove: async (key: string) => { delete stored[key]; },
  } }, tabs: { get: vi.fn(async () => ({ url: capture.inspection.normalizedUrl })) }, scripting: { executeScript } });
  await rememberMediaTransfer(id, capture, 7, capture.inspection.normalizedUrl, 'fixture-nonce', Date.now() + 60000, [info]);
  await expect(transferMedia({ type: 'TAKE_MEDIA_CHUNK', captureId: id, itemIndex: 0, offset: 0 })).rejects.toThrow('expired');
  expect(await claimMediaTransfer(id)).toEqual([info]);
  await expect(transferMedia({ type: 'TAKE_MEDIA_CHUNK', captureId: id, itemIndex: 0, offset: 1 })).rejects.toThrow('Invalid');
  await expect(transferMedia({ type: 'TAKE_MEDIA_CHUNK', captureId: id, itemIndex: 0, offset: 0 })).resolves.toEqual({ base64: 'fixture-chunk' });
  await transferMedia({ type: 'RELEASE_MEDIA', captureId: id });
  expect(stored.mediaTransfer).toBeUndefined();
  expect(executeScript).toHaveBeenCalledTimes(2);
  await rememberMediaTransfer(id, capture, 7, capture.inspection.normalizedUrl, 'fixture-nonce', Date.now() - 1, [info]);
  expect(await claimMediaTransfer(id)).toBeUndefined(); expect(stored.mediaTransfer).toBeUndefined();
});
