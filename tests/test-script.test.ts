import { expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildTestScript, readExportImages, wavAsset } from '../src/lib/inspection/test-script';
import { normalizeCapture } from '../src/lib/capture/normalize';
import { captureFixture } from './capture-fixture';
import { enrichmentPrompt } from '../src/lib/inspection/enrichment';

const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1cAAAAASUVORK5CYII=', 'base64'));
function report(image = true) {
  const raw = captureFixture();
  if (image) Object.assign(raw.inspection, { media: { kind: 'single', totalSlides: 1, navigation: 'not_requested', completeness: 'complete', reason: 'Test fixture.', items: [{ position: 1, type: 'image', url: 'https://scontent.cdninstagram.com/fixture.png', referenceUrl: null, posterUrl: null, width: 1, height: 1, assetAccess: 'verified_accessible', reason: 'Test fixture.', processingEligibility: 'unverified', verification: { method: 'cors_get', mimeType: 'image/png', byteLength: png.length, checkedAt: '2026-11-04T09:00:00Z' } }] } });
  return normalizeCapture(raw).inspection;
}
const asset = { name: 'media/slide-1.png', mimeType: 'image/png', bytes: png, position: 1 };

it('reads and decodes media again at export with no credentials, and fails on stale/opaque/incorrect resources', async () => {
  const transport = vi.fn(async () => new Response(png, { headers: { 'content-type': 'image/png' } }));
  const decode = vi.fn(async () => ({ width: 1, height: 1, close: vi.fn() })) as unknown as typeof createImageBitmap;
  const assets = await readExportImages(report(), 'museSpark', '', { transport, decode });
  expect(assets[0].bytes).toEqual(png);
  expect(transport).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ credentials: 'omit', mode: 'cors', redirect: 'error' }));
  await expect(readExportImages(report(), 'museSpark', '', { transport: async () => new Response('expired', { status: 403 }), decode })).rejects.toThrow('HTTP 403');
  await expect(readExportImages(report(), 'museSpark', '', { transport: async () => new Response('html', { headers: { 'content-type': 'text/html' } }), decode })).rejects.toThrow('JPEG');
  await expect(readExportImages(report(), 'museSpark', '', { transport, decode: async () => { throw new Error('Decode failed'); } })).rejects.toThrow('Decode failed');
});

it('embeds small image bytes, produces runnable native-only scripts, and detects missing credentials', async () => {
  const result = await buildTestScript(report(), 'museSpark', [asset]);
  expect(result.name).toBe('test-muse-spark.mjs');
  const source = new TextDecoder().decode(result.bytes);
  expect(source).not.toMatch(/cdninstagram|blob:/);
  expect(source).toContain(Buffer.from(png).toString('base64'));
  const directory = await mkdtemp(join(tmpdir(), 'memoar-script-'));
  try {
    const script = join(directory, result.name); await writeFile(script, result.bytes);
    expect(spawnSync(process.execPath, ['--check', script]).status).toBe(0);
    const env = { ...process.env }; delete env.MODEL_API_KEY;
    const missing = spawnSync(process.execPath, [script], { cwd: directory, env, encoding: 'utf8' });
    expect(missing.status).toBe(1); expect(missing.stderr).toContain('MODEL_API_KEY is missing');
    await writeFile(join(directory, '.env.local'), 'MODEL_API_KEY=fixture-test-key\n');
    await writeFile(join(directory, 'transport.mjs'), `import {writeFileSync} from 'node:fs'; globalThis.fetch=async(url,options)=>{if(url!=='https://api.meta.ai/v1/responses')throw Error('Unexpected endpoint');writeFileSync('request.json',options.body);return new Response(JSON.stringify({id:'fixture-response',model:'muse-spark-1.3',output:[{content:[{type:'output_text',text:JSON.stringify({visibleText:['Holiday Drinks','HOLIDAY DRINKS','Holiday Drin…'],rawVisibleText:['Holiday Drinks','HOLIDAY DRINKS','Holiday Drin…','Participating locations only.']})}]}],usage:{input_tokens:4,output_tokens:2},metadata:{api_key:'fixture-test-key',echo:JSON.parse(options.body).input[0].content.at(-1).image_url}}),{headers:{'content-type':'application/json'}})};`);
    const run = spawnSync(process.execPath, ['--import', join(directory, 'transport.mjs'), script], { cwd: directory, env, encoding: 'utf8' });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout.trim()).toBe(`Saved: ${join(directory, 'muse-spark-response.json')}, ${join(directory, 'muse-spark-result.json')}`);
    const body = JSON.parse(await readFile(join(directory, 'request.json'), 'utf8'));
    expect(body.model).toBe('muse-spark-1.3'); expect(body.reasoning).toEqual({ effort: 'low' });
    expect(body.max_output_tokens).toBe(8192);
    expect(body.store).toBe(false);
    expect(body.input[0].content.at(-1).image_url).toBe(`data:image/png;base64,${Buffer.from(png).toString('base64')}`);
    expect(body.text.format.strict).toBe(true);
    expect(body.text.format.schema.properties.objects.items.type).toBe('object');
    expect(body.text.format.schema.properties.objects.items.properties.position.properties.slide.type).toContain('null');
    expect(body.text.format.schema.required).toContain('captionContext');
    const responseText = await readFile(join(directory, 'muse-spark-response.json'), 'utf8');
    const response = JSON.parse(responseText);
    expect(response).toMatchObject({ id: 'fixture-response', model: 'muse-spark-1.3', usage: { input_tokens: 4, output_tokens: 2 } });
    expect(responseText).not.toContain('fixture-test-key');
    expect(responseText).not.toContain(Buffer.from(png).toString('base64'));
    expect(JSON.parse(response.output[0].content[0].text).visibleText).toHaveLength(3);
    const normalized = JSON.parse(await readFile(join(directory, 'muse-spark-result.json'), 'utf8'));
    expect(normalized.visibleText).toEqual(['Holiday Drinks']);
    expect(normalized.rawVisibleText).toEqual(['Holiday Drinks', 'HOLIDAY DRINKS', 'Holiday Drin…', 'Participating locations only.']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('saves incomplete responses with their reason, rejects valid-looking partial JSON and removes stale results', async () => {
  const partial = { output: [{ content: [{ type: 'output_text', text: '{"visibleText":[],"rawVisibleText":[]}' }] }] };
  const incomplete = { ...partial, status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, usage: { output_tokens: 8192 } };
  const cases = [
    { body: JSON.stringify(incomplete), contentType: 'application/json', reason: 'max_output_tokens' },
    { body: JSON.stringify({ ...incomplete, incomplete_details: null }), contentType: 'application/json', reason: 'not provided by API' },
    { body: 'data: ' + JSON.stringify({ type: 'response.incomplete', response: incomplete }) + '\n\n', contentType: 'text/event-stream', reason: 'max_output_tokens' },
    { body: 'data: ' + JSON.stringify({ type: 'response.output_text.delta', delta: '{"visibleText":[]}' }) + '\n\n', contentType: 'text/event-stream', reason: 'stream ended before completion' },
  ];
  const artifact = await buildTestScript(report(false), 'museSpark', []);
  for (const fixture of cases) {
    const directory = await mkdtemp(join(tmpdir(), 'memoar-incomplete-'));
    try {
      const script = join(directory, artifact.name);
      await writeFile(script, artifact.bytes);
      await writeFile(join(directory, 'muse-spark-result.json'), '{"previous":"success"}');
      await writeFile(join(directory, 'transport.mjs'), `globalThis.fetch=async()=>new Response(${JSON.stringify(fixture.body)},{headers:{'content-type':${JSON.stringify(fixture.contentType)}}});`);
      const run = spawnSync(process.execPath, ['--import', join(directory, 'transport.mjs'), script], { cwd: directory, env: { ...process.env, MODEL_API_KEY: 'fixture-test-key' }, encoding: 'utf8' });
      expect(run.status).toBe(1);
      expect(run.stdout).toBe('');
      expect(run.stderr).toContain(`Meta response incomplete (reason: ${fixture.reason})`);
      const response = JSON.parse(await readFile(join(directory, 'muse-spark-response.json'), 'utf8'));
      if (fixture.contentType === 'application/json') expect(response).toEqual(JSON.parse(fixture.body));
      else expect(response.events).toHaveLength(1);
      await expect(readFile(join(directory, 'muse-spark-result.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
});

it('bundles ordered carousel assets and script in a valid ZIP and rejects missing assets or target', async () => {
  const inspection = report(); inspection.media!.kind = 'carousel';
  const result = await buildTestScript(inspection, 'sam31', [asset], 'drink cup');
  expect(result.name).toBe('test-sam.zip');
  const directory = await mkdtemp(join(tmpdir(), 'memoar-zip-'));
  try {
    const file = join(directory, result.name); await writeFile(file, result.bytes);
    const verify = spawnSync('python3', ['-c', 'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; assert z.namelist()==["test-sam.mjs","media/slide-1.png"]; z.extractall(sys.argv[2])', file, directory], { encoding: 'utf8' });
    expect(verify.status, verify.stderr).toBe(0);
    expect(new Uint8Array(await readFile(join(directory, asset.name)))).toEqual(png);
    expect(spawnSync(process.execPath, ['--check', join(directory, 'test-sam.mjs')]).status).toBe(0);
    await writeFile(join(directory, '.env.local'), 'MODEL_API_KEY=fixture-test-key\n');
    await writeFile(join(directory, 'transport.mjs'), `import{writeFileSync}from'node:fs';globalThis.fetch=async(url,options)=>{if(url!=='https://api.meta.ai/v1/responses')throw Error('Wrong endpoint');writeFileSync('request.json',options.body);return new Response('data: '+JSON.stringify({type:'response.output_text.delta',delta:'test mask'})+'\\n\\ndata: '+JSON.stringify({type:'response.completed',response:{status:'completed',usage:{input_tokens:2}}})+'\\n\\n',{headers:{'content-type':'text/event-stream'}})};`);
    const env = { ...process.env }; delete env.MODEL_API_KEY;
    const run = spawnSync(process.execPath, ['--import', join(directory, 'transport.mjs'), join(directory, 'test-sam.mjs')], { cwd: directory, env, encoding: 'utf8' });
    expect(run.status, run.stderr).toBe(0);
    const response = JSON.parse(await readFile(join(directory, 'sam-response.json'), 'utf8'));
    expect(response.usage).toEqual({ input_tokens: 2 });
    expect(response.events).toHaveLength(2);
    expect(JSON.parse(await readFile(join(directory, 'sam-result.json'), 'utf8'))).toEqual({ output_text: 'test mask' });
    const request = JSON.parse(await readFile(join(directory, 'request.json'), 'utf8'));
    expect(request.model).toBe('sam-3.1'); expect(request.stream).toBe(true);
    expect(request.input[0].content[0]).toEqual({ type: 'input_text', text: 'drink cup' });
    expect(request.input[0].content[1].image_url).toBe(`data:image/png;base64,${Buffer.from(png).toString('base64')}`);
    await rm(join(directory, asset.name));
    const missing = spawnSync(process.execPath, [join(directory, 'test-sam.mjs')], { cwd: directory, env, encoding: 'utf8' });
    expect(missing.status).toBe(1); expect(missing.stderr).toContain('Missing local media');
  } finally { await rm(directory, { recursive: true, force: true }); }
  await expect(buildTestScript(report(), 'sam31', [asset])).rejects.toThrow('target');
  await expect(buildTestScript(report(), 'museSpark', [])).rejects.toThrow('Missing image bytes');
  expect((await buildTestScript(report(false), 'museSpark', [])).name).toBe('test-muse-spark.mjs');
  await expect(buildTestScript(report(), 'museVoiceTranscribe', [])).rejects.toThrow('WAV');
  expect(() => wavAsset(new Uint8Array(44))).toThrow('WAV');
});

it('validates WAV sample chunks and sends native multipart audio to the transcription endpoint', async () => {
  const bytes = new Uint8Array(46), view = new DataView(bytes.buffer), put = (offset: number, value: string) => bytes.set(new TextEncoder().encode(value), offset);
  put(0, 'RIFF'); view.setUint32(4, 38, true); put(8, 'WAVE'); put(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  put(36, 'data'); view.setUint32(40, 2, true);
  const audio = wavAsset(bytes);
  const artifact = await buildTestScript(report(false), 'museVoiceTranscribe', [audio]);
  const directory = await mkdtemp(join(tmpdir(), 'memoar-voice-'));
  try {
    const archive = join(directory, artifact.name); await writeFile(archive, artifact.bytes);
    const extract = spawnSync('python3', ['-c', 'import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', archive, directory]);
    expect(extract.status).toBe(0);
    await writeFile(join(directory, '.env.local'), 'MODEL_API_KEY=fixture-test-key\n');
    await writeFile(join(directory, 'transport.mjs'), `import{writeFileSync}from'node:fs';globalThis.fetch=async(url,options)=>{if(url!=='https://api.meta.ai/v1/asr/transcribe')throw Error('Wrong endpoint');const request=JSON.parse(await options.body.get('request').text());writeFileSync('request.json',JSON.stringify({request,audioType:options.body.get('audio').type,audioSize:options.body.get('audio').size}));return new Response(JSON.stringify({turns:[]}),{headers:{'content-type':'application/json'}})};`);
    const env = { ...process.env }; delete env.MODEL_API_KEY;
    const result = spawnSync(process.execPath, ['--import', join(directory, 'transport.mjs'), join(directory, 'test-muse-voice.mjs')], { cwd: directory, env, encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(await readFile(join(directory, 'muse-voice-transcribe-response.json'), 'utf8'))).toEqual({ turns: [] });
    expect(JSON.parse(await readFile(join(directory, 'muse-voice-transcribe-result.json'), 'utf8'))).toEqual([]);
    expect(JSON.parse(await readFile(join(directory, 'request.json'), 'utf8'))).toEqual({ request: { model: 'muse-voice-transcribe-1.0', mode: 'DIARIZATION', audioEncoding: 'WAV' }, audioType: 'audio/wav', audioSize: 46 });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('preserves text-only and ordered-carousel Spark requests with the improved schema', async () => {
  for (const carousel of [false, true]) {
    const inspection = report(carousel);
    const assets = carousel ? [asset, { ...asset, name: 'media/slide-2.png', position: 2 }] : [];
    if (carousel) {
      const media = inspection.media!;
      media.kind = 'carousel'; media.totalSlides = 2;
      media.items.push({ ...media.items[0], position: 2, url: 'https://scontent.cdninstagram.com/fixture-2.png' });
    }
    const artifact = await buildTestScript(inspection, 'museSpark', assets, '', 'files');
    const directory = await mkdtemp(join(tmpdir(), 'memoar-enrichment-'));
    try {
      for (const file of artifact.files!) {
        const { mkdir } = await import('node:fs/promises');
        if (file.name.startsWith('media/')) await mkdir(join(directory, 'media'), { recursive: true });
        await writeFile(join(directory, file.name), file.bytes);
      }
      await writeFile(join(directory, '.env.local'), 'MODEL_API_KEY=fixture-test-key\n');
      await writeFile(join(directory, 'transport.mjs'), `import{writeFileSync}from'node:fs';globalThis.fetch=async(url,options)=>{if(url!=='https://api.meta.ai/v1/responses')throw Error('Unexpected endpoint');writeFileSync('request.json',options.body);return Response.json({output:[{content:[{type:'output_text',text:'{"visibleText":[],"rawVisibleText":[]}'}]}]})};`);
      const env = { ...process.env }; delete env.MODEL_API_KEY;
      const run = spawnSync(process.execPath, ['--import', join(directory, 'transport.mjs'), join(directory, 'test-muse-spark.mjs')], { cwd: directory, env, encoding: 'utf8' });
      expect(run.status, run.stderr).toBe(0);
      const request = JSON.parse(await readFile(join(directory, 'request.json'), 'utf8'));
      expect(request.reasoning).toEqual({ effort: 'low' });
      expect(request.text.format.schema.properties.objects.items.type).toBe('object');
      expect(request.text.format.schema.properties.slides.items.required).toEqual(['position', 'summary', 'keyInsights']);
      const content = request.input[0].content;
      expect(content[0].text.startsWith(enrichmentPrompt)).toBe(true);
      expect(content[0].text).toContain('For text-only posts set visualDescription to null');
      expect(content[0].text).toContain('Fixture caption #test');
      expect(content.filter((item: { type: string }) => item.type === 'input_image')).toHaveLength(carousel ? 2 : 0);
      expect(content.slice(1).filter((item: { type: string }) => item.type === 'input_text').map((item: { text: string }) => item.text)).toEqual(carousel ? ['Slide position: 1', 'Slide position: 2'] : []);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
});
