import { describe, expect, it, vi } from 'vitest';
import { normalizeSnapshot, validateRegion } from '../src/lib/capture/snapshot';
import { normalizeCapture } from '../src/lib/capture/normalize';
import { pixelCrop, takeSnapshot } from '../extension/snapshot';
import { createCaptureSession, type PendingCapture } from '../extension/session';
import { captureFixture } from './capture-fixture';

function jpeg(width = 200, height = 160) {
  return new Uint8Array([255,216,255,192,0,17,8,height >> 8,height & 255,width >> 8,width & 255,3,1,17,0,2,17,0,3,17,0,255,217]);
}
const image = (width = 200, height = 160) => ({ status: 'available', dataUrl: `data:image/jpeg;base64,${Buffer.from(jpeg(width, height)).toString('base64')}`, width, height });
const region = { x: 10, y: 20, width: 100, height: 80, viewportWidth: 360, viewportHeight: 240, scrollX: 0, scrollY: 0 };
const candidate = { region, mediaIndex: 1, mediaSource: 'blob:https://www.instagram.com/fixture' };
const url = 'https://www.instagram.com/reel/UNIT_TEST_ONLY/';
const activeTab = { id: 7, windowId: 9, url };

function browser() {
  const captureVisibleTab = vi.fn(async () => 'data:image/png;base64,AA==');
  const query = vi.fn(async () => [activeTab]);
  const executeScript = vi.fn(async () => [{ result: true }]);
  vi.stubGlobal('chrome', { tabs: { query, captureVisibleTab }, scripting: { executeScript } });
  const close = vi.fn();
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 720, height: 480, close })));
  const drawImage = vi.fn();
  vi.stubGlobal('OffscreenCanvas', class {
    getContext() { return { drawImage }; }
    async convertToBlob() { return new Blob([jpeg()], { type: 'image/jpeg' }); }
  });
  return { captureVisibleTab, query, executeScript, close, drawImage };
}

describe('display-only snapshot validation', () => {
  it('checks JPEG dimensions and discards permission/source claims', () => {
    expect(normalizeSnapshot({ ...image(), source: 'official_api', processingEligibility: 'allowed', html: '<script>bad</script>' }))
      .toEqual({ ...image(), source: 'browser_snapshot', processingEligibility: 'unverified' });
    expect(() => normalizeSnapshot({ ...image(), width: 1 })).toThrow('dimensions');
    expect(() => normalizeSnapshot(image(721))).toThrow('dimensions');
    expect(() => normalizeSnapshot({ ...image(), dataUrl: 'data:image/svg+xml,<svg onload="attack()"/>' })).toThrow();
    expect(() => normalizeSnapshot({ ...image(), dataUrl: 'data:image/jpeg;base64,' + 'A'.repeat(128 * 1024) })).toThrow();
  });

  it('keeps pixels outside inspection JSON and AI readiness', () => {
    const original = normalizeCapture(captureFixture());
    const capture = normalizeCapture({ ...original, snapshot: image() });
    expect(capture.inspection).toEqual(original.inspection);
    expect(JSON.stringify(capture.inspection)).not.toContain('data:image');
    expect(capture.snapshot?.status).toBe('available');
  });

  it('preserves old envelopes and bounds unavailable reasons', () => {
    expect(normalizeCapture(captureFixture()).snapshot).toBeUndefined();
    expect(() => normalizeSnapshot({ status: 'unavailable', reason: 'x'.repeat(1001) })).toThrow();
    expect(() => normalizeSnapshot({ status: 'available', dataUrl: 'data:image/jpeg;base64,AAAA', width: 1, height: 1 })).toThrow();
  });

  it('consumes the snapshot once through the same temporary session', async () => {
    let pending: PendingCapture | null = null;
    const session = createCaptureSession({ get: async () => pending, set: async value => { pending = value; }, clear: async () => { pending = null; } }, () => 100, () => 'fixture');
    await session.put({ ...captureFixture(), snapshot: image() });
    expect((await session.take('fixture')).snapshot?.status).toBe('available');
    expect(await session.peek()).toBeNull();
    await expect(session.take('fixture')).rejects.toThrow('missing');
  });
});

describe('snapshot crop and source guards', () => {
  it('maps CSS bounds to screenshot pixels and caps the longest output edge', () => {
    expect(pixelCrop(region, 720, 480)).toEqual({ x: 20, y: 40, width: 200, height: 160, outputWidth: 200, outputHeight: 160 });
    expect(pixelCrop({ ...region, width: 350, height: 220 }, 1440, 960).outputWidth).toBe(720);
    expect(() => pixelCrop(region, 1000, 480)).toThrow('changed');
    expect(() => validateRegion({ ...region, x: -1 })).toThrow();
    expect(() => validateRegion({ ...region, width: Infinity })).toThrow();
    expect(() => validateRegion({ ...region, width: 1000 })).toThrow();
  });

  it('captures only after checking the source and crops before handoff', async () => {
    const mocks = browser();
    const result = await takeSnapshot(7, 9, url, candidate);
    expect(result.status).toBe('available');
    expect(mocks.captureVisibleTab).toHaveBeenCalledOnce();
    expect(mocks.drawImage).toHaveBeenCalledWith(expect.anything(), 20, 40, 200, 160, 0, 0, 200, 160);
    expect(mocks.executeScript).toHaveBeenCalledTimes(2);
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain('data:image/png');
  });

  it('does not capture another active tab or an obscured/moved media element', async () => {
    const mocks = browser(); mocks.query.mockResolvedValue([{ ...activeTab, id: 8 }]);
    expect((await takeSnapshot(7, 9, url, candidate)).status).toBe('unavailable');
    expect(mocks.captureVisibleTab).not.toHaveBeenCalled();
    mocks.query.mockResolvedValue([activeTab]); mocks.executeScript.mockResolvedValue([{ result: false }]);
    expect((await takeSnapshot(7, 9, url, candidate)).status).toBe('unavailable');
    expect(mocks.captureVisibleTab).not.toHaveBeenCalled();
  });

  it('discards pixels when the source changes during capture and tolerates unavailable screenshots', async () => {
    const mocks = browser(); mocks.query.mockResolvedValueOnce([activeTab]).mockResolvedValue([{ ...activeTab, url: 'https://www.instagram.com/p/OTHER/' }]);
    expect((await takeSnapshot(7, 9, url, candidate)).status).toBe('unavailable');
    expect(globalThis.createImageBitmap).not.toHaveBeenCalled();
    mocks.query.mockResolvedValue([activeTab]); mocks.captureVisibleTab.mockRejectedValue(new Error('Denied'));
    expect((await takeSnapshot(7, 9, url, candidate)).status).toBe('unavailable');
  });
});
