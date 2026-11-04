import { expect, it, vi } from 'vitest';
import { verifyMedia } from '../extension/verify-media';
import { normalizeCapture } from '../src/lib/capture/normalize';
import { inspectMp4, MAX_VIDEO_BYTES, mediaDigest } from '../src/lib/capture/mp4';
import { modelExport } from '../src/lib/inspection/model-export';
import { buildTestScript, readExportImages } from '../src/lib/inspection/test-script';
import type { MediaCapture } from '../src/lib/inspection/types';
import { captureFixture } from './capture-fixture';
import { mp4Box, mp4Fixture } from './mp4-fixture';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { enrichmentPrompt } from '../src/lib/inspection/enrichment';

function media(): MediaCapture {
  return { kind: 'single', totalSlides: 1, composition: 'video_only', completeness: 'complete', navigation: 'not_requested', reason: 'Fixture metadata.', items: [{
    position: 1, type: 'video', url: 'https://scontent.cdninstagram.com/fixture.mp4', referenceUrl: null, posterUrl: null,
    width: 1080, height: 1920, assetAccess: 'reference_only', processingEligibility: 'unverified', reason: 'Fixture reference.',
  }] };
}
const decodeVideo = vi.fn(async () => ({ width: 1080, height: 1920, duration: 2 }));
async function capture(audio = true) {
  const bytes = mp4Fixture(audio);
  const verified = await verifyMedia(media(), { transport: async () => new Response(bytes, { headers: { 'content-type': 'video/mp4', 'content-length': String(bytes.length) } }), decodeVideo });
  const raw = captureFixture();
  return normalizeCapture({ ...raw, inspection: { ...raw.inspection, media: verified } });
}

it('validates progressive MP4 sample bytes, dimensions, timing, audio presence and proof across the session handoff', async () => {
  for (const audio of [true, false]) {
    const envelope = await capture(audio);
    expect(normalizeCapture(JSON.parse(JSON.stringify(envelope)))).toEqual(envelope);
    const report = envelope.inspection;
    expect(report.media!.items[0]).toMatchObject({ assetAccess: 'verified_accessible', verification: { mimeType: 'video/mp4', durationSeconds: 2, audio: audio ? 'present' : 'absent', sha256: await mediaDigest(mp4Fixture(audio)) } });
    expect(report.aiReadiness.museSpark.find(input => input.modality === 'video')).toMatchObject({ technicallyAccessible: true, status: 'unknown', processingEligibility: 'unverified' });
    expect(report.aiReadiness.museSpark.find(input => input.modality === 'audio')!.technicallyAccessible).toBe(audio);
    expect(report.aiReadiness.museVoiceTranscribe[0].technicallyAccessible).toBe(false);
    expect(modelExport(report, 'museSpark').inputs.media[0].type).toBe('video');
  }
});

it('keeps reference_only on CORS, denied, expired, HTML, oversize, partial, truncated and undecodable video responses', async () => {
  const bytes = mp4Fixture();
  const cases = [async () => { throw new Error('CORS'); }, async () => new Response('denied', { status: 403 }), async () => new Response('expired', { status: 410 }),
    async () => new Response('<html>login</html>', { headers: { 'content-type': 'text/html' } }),
    async () => new Response(bytes, { headers: { 'content-type': 'video/mp4', 'content-length': String(MAX_VIDEO_BYTES + 1) } }),
    async () => new Response(bytes, { status: 206, headers: { 'content-type': 'video/mp4' } }),
    async () => new Response(bytes.slice(0, -1), { headers: { 'content-type': 'video/mp4' } }),
    async () => new Response(bytes, { headers: { 'content-type': 'video/mp4', 'content-length': String(bytes.length + 1) } })];
  for (const transport of cases) {
    const verified = await verifyMedia(media(), { transport, decodeVideo });
    expect(verified.items[0].assetAccess).toBe('reference_only'); expect(verified.items[0].verification).toBeUndefined();
    expect(verified.items[0].reason).not.toMatch(/is private|was deleted/);
  }
  const verified = await verifyMedia(media(), { transport: async () => new Response(bytes, { headers: { 'content-type': 'video/mp4' } }), decodeVideo: async () => { throw new Error('Codec decoding failed.'); } });
  expect(verified.items[0].assetAccess).toBe('reference_only');
});

it('rejects fragmented/protected containers and sample tables that point outside downloaded media', () => {
  const valid = mp4Fixture();
  expect(inspectMp4(valid)).toMatchObject({ width: 1080, height: 1920, durationSeconds: 2, audio: 'present' });
  const fragmented = new Uint8Array(valid.length + 8); fragmented.set(valid); fragmented.set(mp4Box('moof'), valid.length);
  expect(() => inspectMp4(fragmented)).toThrow('DASH');
  for (const [marker, mutate] of [
    ['avc1', (bytes: Uint8Array<ArrayBuffer>, offset: number) => bytes.set(new TextEncoder().encode('encv'), offset)],
    ['stco', (bytes: Uint8Array<ArrayBuffer>, offset: number) => new DataView(bytes.buffer).setUint32(offset + 12, bytes.length + 10)],
    ['stts', (bytes: Uint8Array<ArrayBuffer>, offset: number) => new DataView(bytes.buffer).setUint32(offset + 16, 0)],
  ] as const) {
    const bytes = valid.slice(), offset = Buffer.from(bytes).indexOf(marker);
    mutate(bytes, offset); expect(() => inspectMp4(bytes)).toThrow();
  }
});

it('does not promote imported video flags without duration, audio and integrity proof', async () => {
  const envelope = await capture();
  for (const key of ['durationSeconds', 'audio', 'sha256'] as const) {
    const raw = structuredClone(envelope); delete raw.inspection.media!.items[0].verification![key];
    expect(normalizeCapture(raw).inspection.media!.items[0].assetAccess).toBe('reference_only');
  }
});

it('re-reads exact MP4 bytes for export, bundles them and preserves Files API use and reasoning settings', async () => {
  const report = (await capture()).inspection, bytes = mp4Fixture();
  const transport = vi.fn(async () => new Response(bytes, { headers: { 'content-type': 'video/mp4' } }));
  const assets = await readExportImages(report, 'museSpark', '', { transport });
  expect(assets[0]).toMatchObject({ name: 'media/slide-1.mp4', mimeType: 'video/mp4', position: 1, bytes });
  expect(transport).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ credentials: 'omit', redirect: 'error', mode: 'cors' }));
  const artifact = await buildTestScript(report, 'museSpark', assets, '', 'files');
  expect(artifact.files!.map(file => file.name)).toEqual(['test-muse-spark.mjs', 'media/slide-1.mp4']);
  const source = new TextDecoder().decode(artifact.bytes);
  expect(source).toContain("form.append('purpose', 'user_data')");
  expect(source).toContain("type: 'input_video', file_id: file.id");
  expect(source).toContain("const REASONING_EFFORT = 'low'"); expect(source).toContain('max_output_tokens: 8192');
  expect(source).toContain("method: 'DELETE'"); expect(source).not.toMatch(/cdninstagram|blob:/);
  const changed = bytes.slice(); changed[28] = 2;
  await expect(readExportImages(report, 'museSpark', '', { transport: async () => new Response(changed, { headers: { 'content-type': 'video/mp4' } }) })).rejects.toThrow('changed since capture');
});

it('exports a mixed carousel in order and uploads/cleans up video only when the generated script is run', async () => {
  const envelope = await capture(), video = envelope.inspection.media!.items[0];
  const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1cAAAAASUVORK5CYII=', 'base64'));
  const image = { ...video, type: 'image' as const, url: 'https://scontent.cdninstagram.com/image.png', width: 1, height: 1,
    verification: { method: 'cors_get' as const, mimeType: 'image/png', byteLength: png.length, checkedAt: '2026-11-05T00:00:00.000Z' } };
  const report = normalizeCapture({ ...envelope, inspection: { ...envelope.inspection, media: { ...envelope.inspection.media,
    discovery: 'embedded_json', kind: 'carousel', totalSlides: 3, items: [{ ...image, position: 1 }, { ...video, position: 2 }, { ...image, position: 3 }] } } }).inspection;
  const assets = await readExportImages(report, 'museSpark', '', {
    transport: async url => new Response(String(url).endsWith('.mp4') ? mp4Fixture() : png, { headers: { 'content-type': String(url).endsWith('.mp4') ? 'video/mp4' : 'image/png' } }),
    decode: vi.fn(async () => ({ width: 1, height: 1, close() {} })) as unknown as typeof createImageBitmap,
  });
  expect(assets.map(asset => asset.name)).toEqual(['media/slide-1.png', 'media/slide-2.mp4', 'media/slide-3.png']);
  const artifact = await buildTestScript(report, 'museSpark', assets, '', 'files');
  const directory = await mkdtemp(join(tmpdir(), 'memoar-video-script-'));
  try {
    await mkdir(join(directory, 'media'));
    for (const file of artifact.files!) await writeFile(join(directory, file.name), file.bytes);
    await writeFile(join(directory, 'transport.mjs'), `
      import { writeFileSync } from 'node:fs';
      const calls = [];
      globalThis.fetch = async (url, options) => {
        calls.push({ url, method: options.method }); writeFileSync('calls.json', JSON.stringify(calls));
        if (url.endsWith('/files') && options.method === 'POST') {
          if (options.body.get('purpose') !== 'user_data' || options.body.get('file').type !== 'video/mp4') throw Error('Invalid upload');
          return Response.json({ id: 'file-fixture', status: 'uploaded' });
        }
        if (options.method === 'DELETE') return Response.json({ deleted: true });
        if (!url.endsWith('/responses')) throw Error('Unexpected endpoint');
        writeFileSync('request.json', options.body);
        return Response.json({ output: [{ content: [{ type: 'output_text', text: '{"visibleText":[]}' }] }] });
      };
    `);
    const run = spawnSync(process.execPath, ['--import', join(directory, 'transport.mjs'), join(directory, artifact.name)], { cwd: directory, env: { ...process.env, MODEL_API_KEY: 'fixture-test-key' }, encoding: 'utf8' });
    expect(run.status, run.stderr).toBe(0);
    const request = JSON.parse(await readFile(join(directory, 'request.json'), 'utf8'));
    expect(request.input[0].content[0].text.startsWith(enrichmentPrompt)).toBe(true);
    expect(request.reasoning).toEqual({ effort: 'low' }); expect(request.max_output_tokens).toBe(8192);
    expect(request.input[0].content.filter((part: { type: string }) => part.type !== 'input_text').map((part: { type: string }) => part.type)).toEqual(['input_image', 'input_video', 'input_image']);
    expect(request.input[0].content.find((part: { type: string }) => part.type === 'input_video')).toEqual({ type: 'input_video', file_id: 'file-fixture' });
    expect(JSON.parse(await readFile(join(directory, 'calls.json'), 'utf8')).map((call: { method: string }) => call.method)).toEqual(['POST', 'POST', 'DELETE']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
