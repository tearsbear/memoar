import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCaptureSession, type PendingCapture } from '../extension/session';
import { CAPTURE_TTL_MS, isMemoarSender, isTakeRequest } from '../src/lib/capture/protocol';
import { captureLinkParameters, createCaptureImporter, requestCapture } from '../src/lib/capture/bridge';
import { normalizeCapture } from '../src/lib/capture/normalize';
import { captureFixture } from './capture-fixture';

const id = '12345678-1234-4234-8234-123456789abc';
const extensionId = 'a'.repeat(32);
afterEach(() => vi.useRealTimers());

describe('temporary one-time handoff', () => {
  function session() {
    let pending: PendingCapture | null = null;
    let now = 100;
    const storage = {
      get: async () => pending,
      set: async (value: PendingCapture) => { pending = value; },
      clear: async () => { pending = null; },
    };
    const captures = createCaptureSession(storage, () => now, () => id);
    return { captures, advance: (time: number) => { now += time; } };
  }

  it('consumes once, including simultaneous requests', async () => {
    const { captures } = session();
    await captures.put(captureFixture());
    const result = await Promise.allSettled([captures.take(id), captures.take(id)]);
    expect(result.map(value => value.status)).toEqual(['fulfilled', 'rejected']);
    expect(await captures.peek()).toBeNull();
  });

  it('replaces the previous capture and removes expired payloads', async () => {
    const { captures, advance } = session();
    await captures.put(captureFixture());
    const newer = captureFixture(); newer.inspection.fields.captionText.value = 'New fixture';
    await captures.put(newer);
    expect((await captures.peek())?.payload.inspection.fields.captionText.value).toBe('New fixture');
    advance(CAPTURE_TTL_MS);
    await expect(captures.take(id)).rejects.toThrow('expired');
    expect(await captures.peek()).toBeNull();
  });

  it('does not consume a valid capture for the wrong ID', async () => {
    const { captures } = session(); await captures.put(captureFixture());
    await expect(captures.take('wrong')).rejects.toThrow();
    expect(await captures.peek()).not.toBeNull();
  });

  it('requires the exact allowed web origin and top frame', () => {
    expect(isMemoarSender({ url: 'http://localhost:3000/', origin: 'http://localhost:3000', frameId: 0 })).toBe(true);
    for (const sender of [
      { url: 'http://localhost:3001/', frameId: 0 }, { url: 'http://localhost.evil.tld:3000/', frameId: 0 },
      { url: 'http://127.0.0.1:3000/', frameId: 0 }, { url: 'http://localhost:3000/', frameId: 1 },
      { url: 'http://localhost:3000/', frameId: 0, id: extensionId },
      { url: 'http://localhost:3000/', frameId: 0, origin: 'null' },
    ]) expect(isMemoarSender(sender)).toBe(false);
    expect(isTakeRequest({ type: 'TAKE_CAPTURE', captureId: id })).toBe(true);
    expect(isTakeRequest({ type: 'TAKE_CAPTURE', captureId: id, enumerateAll: true })).toBe(false);
  });
});

describe('client bridge', () => {
  it('deduplicates import requests without sending any captured contents', async () => {
    const payload = normalizeCapture(captureFixture());
    const runtime = { sendMessage: vi.fn((_id: string, _message: unknown, callback: (response: unknown) => void) => callback({ ok: true, payload })) };
    const importer = createCaptureImporter();
    const first = importer(runtime, extensionId, id);
    const duplicate = importer(runtime, extensionId, id);
    expect(first).toBe(duplicate);
    await expect(first).resolves.toEqual(payload);
    expect(runtime.sendMessage).toHaveBeenCalledTimes(1);
    expect(runtime.sendMessage.mock.calls[0][1]).toEqual({ type: 'TAKE_CAPTURE', captureId: id });
  });

  it('terminates after five seconds and reports unavailable bridge explicitly', async () => {
    vi.useFakeTimers();
    const request = requestCapture({ sendMessage: () => {} }, extensionId, id);
    const assertion = expect(request).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(5000); await assertion;
    await expect(requestCapture(undefined, extensionId, id)).rejects.toThrow('unavailable');
  });

  it('validates capture links and refuses identity-shaped query abuse', () => {
    const url = new URL(`http://localhost:3000/?captureId=${id}&extensionId=${extensionId}`);
    expect(captureLinkParameters(url)).toEqual({ captureId: id, extensionId });
    expect(captureLinkParameters(new URL('http://localhost:3000/'))).toBeNull();
    url.searchParams.append('captureId', id);
    expect(() => captureLinkParameters(url)).toThrow('invalid');
    expect(() => captureLinkParameters(new URL(`http://127.0.0.1:3000/?captureId=${id}&extensionId=${extensionId}`))).toThrow('localhost');
  });

  it('rejects forged bridge responses rather than accepting them as normalized results', async () => {
    const runtime = { sendMessage: (_id: string, _request: unknown, callback: (response: unknown) => void) => callback({ ok: true, payload: { html: '<script>bad</script>' } }) };
    await expect(requestCapture(runtime, extensionId, id)).rejects.toThrow('version 1');
  });
});
