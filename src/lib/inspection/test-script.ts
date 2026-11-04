import type { Model, PostInspection } from './types';
import { canExportModel, modelExport } from './model-export';
import { validateMediaReference } from '../capture/normalize';
import { zipFiles } from './zip';
import { cleanVisibleText, enrichmentPrompt, enrichmentSchema } from './enrichment';
import { inspectMp4, MAX_VIDEO_BYTES, mediaDigest } from '../capture/mp4';
import { readResourceBytes } from '../capture/media-resource';
import { capturedAssets } from '../capture/media-cache';

export type ScriptAsset = { name: string; mimeType: string; bytes: Uint8Array<ArrayBuffer>; position: number | null };
type PackedAsset = { name: string; mimeType: string; position: number | null; sha256: string; base64?: string; path?: string };
const names: Record<Model, string> = { museSpark: 'test-muse-spark.mjs', sam31: 'test-sam.mjs', museVoiceTranscribe: 'test-muse-voice.mjs' };

export async function readExportImages(inspection: PostInspection, model: 'museSpark' | 'sam31', target: string, dependencies: {
  transport?: typeof fetch; decode?: typeof createImageBitmap;
} = {}): Promise<ScriptAsset[]> {
  const candidates = modelExport(inspection, model, target).inputs.media;
  if (inspection.media?.kind === 'carousel' && candidates.some(item => item.position === null)) throw new Error('Carousel order is unknown. Capture all slides before exporting ordered media.');
  const assets: ScriptAsset[] = [];
  const retained = capturedAssets(inspection.media);
  for (const candidate of [...candidates].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))) {
    validateMediaReference(candidate.url, inspection.platform);
    let response: Response;
    if (retained !== undefined) {
      const itemIndex = inspection.media!.items.findIndex(item => item.position === candidate.position && item.type === candidate.type && item.url === candidate.url);
      const asset = retained.find(item => item.itemIndex === itemIndex);
      if (!asset || asset.mimeType !== candidate.mimeType) throw new Error('Captured media bytes are missing. Keep the source post tab open, capture again, and use Open in Memoar before exporting.');
      response = new Response(asset.bytes, { headers: { 'content-type': asset.mimeType, 'content-length': String(asset.bytes.length) } });
    } else {
      try {
        response = await (dependencies.transport ?? fetch)(candidate.url, { method: 'GET', mode: 'cors', credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000) });
      } catch {
        throw new Error('Could not read media from Memoar (CORS or network). Capture again with the updated extension and use Open in Memoar to import the actual file bytes.');
      }
    }
    if (!response.ok || response.redirected || response.type === 'opaque') { await response.body?.cancel(); throw new Error(`Media ${candidate.position ?? '?'} cannot be read anonymously (HTTP ${response.status}). Recapture; no script was exported.`); }
    const mimeType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (candidate.type === 'video') {
      if (response.status !== 200 || mimeType !== 'video/mp4' || response.headers.has('content-range')) { await response.body?.cancel(); throw new Error('Export requires a complete MP4, not a DASH segment or partial response.'); }
      const bytes = await readResourceBytes(response, MAX_VIDEO_BYTES);
      const metadata = inspectMp4(bytes);
      if (await mediaDigest(bytes) !== candidate.sha256 || metadata.durationSeconds !== candidate.durationSeconds || metadata.audio !== candidate.audio) throw new Error('Video bytes changed since capture. Recapture the post before exporting.');
      if (assets.reduce((sum, asset) => sum + asset.bytes.length, 0) + bytes.length > 50 * 1024 * 1024) throw new Error('Export exceeds 50 MiB.');
      assets.push({ name: `media/slide-${candidate.position ?? assets.length + 1}.mp4`, mimeType, position: candidate.position, bytes });
      continue;
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) { await response.body?.cancel(); throw new Error('Export supports JPEG, PNG and WebP image bytes only.'); }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Image response has no readable bytes.');
    const parts: Uint8Array<ArrayBuffer>[] = []; let size = 0;
    try {
      while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 10 * 1024 * 1024) { await reader.cancel(); throw new Error('Image exceeds 10 MiB.'); } parts.push(new Uint8Array(value)); }
    } finally { reader.releaseLock(); }
    if (!size || assets.reduce((sum, asset) => sum + asset.bytes.length, 0) + size > 50 * 1024 * 1024) throw new Error('Empty image or export exceeds 50 MiB.');
    const blob = new Blob(parts, { type: mimeType });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const ascii = (start: number, end: number) => new TextDecoder().decode(bytes.slice(start, end));
    const matches = mimeType === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : mimeType === 'image/png' ? bytes[0] === 137 && ascii(1, 4) === 'PNG'
      : ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
    if (!matches) throw new Error('Image bytes do not match the returned MIME type.');
    const decoded = await (dependencies.decode ?? createImageBitmap)(blob);
    try { if (!decoded.width || !decoded.height) throw new Error('Image could not be decoded.'); } finally { decoded.close(); }
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[mimeType];
    assets.push({ name: `media/slide-${candidate.position ?? assets.length + 1}.${ext}`, mimeType, position: candidate.position, bytes });
  }
  return assets;
}

export function wavAsset(bytes: Uint8Array<ArrayBuffer>): ScriptAsset {
  const ascii = (start: number, end: number) => new TextDecoder().decode(bytes.slice(start, end));
  if (bytes.length < 44 || bytes.length > 25 * 1024 * 1024 || ascii(0, 4) !== 'RIFF' || ascii(8, 12) !== 'WAVE') throw new Error('Select an actual WAV audio file between 44 bytes and 25 MiB.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let format = false, data = false;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const size = view.getUint32(offset + 4, true), start = offset + 8;
    if (start + size > bytes.length) throw new Error('Truncated WAV audio.');
    if (ascii(offset, offset + 4) === 'fmt ' && size >= 16) format = [1, 3].includes(view.getUint16(start, true)) && view.getUint16(start + 2, true) > 0 && view.getUint32(start + 4, true) > 0;
    if (ascii(offset, offset + 4) === 'data' && size > 0) data = true;
    offset = start + size + size % 2;
  }
  if (!format || !data) throw new Error('WAV must contain supported PCM/float format and actual audio samples.');
  return { name: 'media/audio.wav', mimeType: 'audio/wav', bytes, position: null };
}

export async function buildTestScript(inspection: PostInspection, model: Model, assets: ScriptAsset[], target = '', format: 'download' | 'files' = 'download') {
  if (model !== 'museVoiceTranscribe' && !canExportModel(inspection, model, target)) throw new Error('Required input or segmentation target is missing.');
  if (model === 'museVoiceTranscribe' && (assets.length !== 1 || assets[0].mimeType !== 'audio/wav')) throw new Error('Actual WAV audio bytes are required.');
  const candidates = model === 'museVoiceTranscribe' ? [] : modelExport(inspection, model, target).inputs.media;
  if (model !== 'museVoiceTranscribe' && assets.length !== candidates.length) throw new Error('Missing image bytes or video bytes. Export cannot fall back to CDN URLs.');
  const ordered = [...candidates].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  if (model !== 'museVoiceTranscribe' && assets.some((asset, index) => asset.position !== ordered[index].position || asset.mimeType !== ordered[index].mimeType)) throw new Error('Export media types or slide order do not match capture.');
  const bundle = model === 'museVoiceTranscribe' || inspection.media?.kind === 'carousel' && assets.length > 0 || assets.length > 1 || assets.some(asset => asset.mimeType === 'video/mp4' || asset.bytes.length > 512 * 1024);
  const packed: PackedAsset[] = [];
  for (const asset of assets) {
    if (!asset.bytes.length) throw new Error('Media bytes are empty.');
    const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', asset.bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    let base64 = '';
    if (!bundle) { for (let i = 0; i < asset.bytes.length; i += 16384) base64 += String.fromCharCode(...asset.bytes.subarray(i, i + 16384)); base64 = btoa(base64); }
    packed.push({ name: asset.name, mimeType: asset.mimeType, position: asset.position, sha256, ...(bundle ? { path: asset.name } : { base64 }) });
  }
  const text = modelExport(inspection, 'museSpark').inputs.text;
  const config = { model: { museSpark: 'muse-spark-1.3', sam31: 'sam-3.1', museVoiceTranscribe: 'muse-voice-transcribe-1.0' }[model], context: text, target: target.trim(), assets: packed,
    ...(model === 'museSpark' ? { schema: enrichmentSchema, enrichmentPrompt } : {}),
    incompleteCapture: inspection.media?.completeness === 'partial' || (inspection.media?.items.length ?? 0) > candidates.length,
    videoAudio: candidates.filter(item => item.type === 'video').map(item => ({ position: item.position, audio: item.audio })) };
  const script = `// Run from the Memoar project root with Node.js 22+: node ${names[model]}
// This script sends the embedded/local inputs to Meta only when you run it.
import { readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const config = ${JSON.stringify(config, null, 2)};
const REASONING_EFFORT = 'low'; // Change here for Muse Spark testing.
const cleanVisibleText = ${cleanVisibleText.toString()};
async function main() {
  if (typeof process.loadEnvFile !== 'function') throw new Error('Node.js 22+ is required.');
  try { process.loadEnvFile('.env.local'); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    try { process.loadEnvFile('.env'); } catch (fallback) { if (fallback.code !== 'ENOENT') throw fallback; }
  }
  const key = process.env.MODEL_API_KEY?.trim();
  if (!key) throw new Error('MODEL_API_KEY is missing. Set it in .env.local in the project root.');
  const media = [];
  for (const asset of config.assets) {
    let bytes;
    try { bytes = asset.path ? await readFile(new URL(asset.path, import.meta.url)) : Buffer.from(asset.base64, 'base64'); }
    catch { throw new Error('Missing local media: ' + asset.name + '. Extract the entire ZIP beside this script.'); }
    if (!bytes.length || createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error('Media is empty or changed: ' + asset.name);
    media.push({ ...asset, bytes });
  }
  const saved = [];
  const sensitiveInputs = [key, ...media.map(asset => asset.bytes.toString('base64'))];
  const uploaded = [];
  async function mediaPart(asset) {
    if (asset.mimeType !== 'video/mp4') return { type: 'input_image', image_url: 'data:' + asset.mimeType + ';base64,' + asset.bytes.toString('base64') };
    const form = new FormData();
    form.append('purpose', 'user_data');
    form.append('expires_after[anchor]', 'created_at');
    form.append('expires_after[seconds]', '3600');
    form.append('file', new Blob([asset.bytes], { type: asset.mimeType }), asset.name.split('/').at(-1));
    const response = await fetch('https://api.meta.ai/v1/files', { method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: form, redirect: 'error', signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error('Meta Files upload HTTP ' + response.status);
    const file = await response.json();
    if (typeof file.id !== 'string' || !/^file-[A-Za-z0-9_-]+$/.test(file.id)) throw new Error('Meta Files upload returned no valid file ID.');
    uploaded.push(file.id);
    return { type: 'input_video', file_id: file.id };
  }
  function redact(value) {
    if (typeof value !== 'string') return value;
    for (const input of sensitiveInputs) value = value.replaceAll(input, '[REDACTED]');
    return value;
  }
  async function saveJson(name, value) {
    const path = new URL(name, import.meta.url);
    const json = JSON.stringify(value, (field, item) => /^(authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|cookie|set-cookie)$/i.test(field) ? '[REDACTED]' : redact(item), 2);
    await writeFile(path, json + '\\n', { mode: 0o600 });
    saved.push(fileURLToPath(path));
    return fileURLToPath(path);
  }
  async function request(body, stem, voice = false) {
    const response = await fetch('https://api.meta.ai/v1/' + (voice ? 'asr/transcribe' : 'responses'), {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(120000),
      headers: { Authorization: 'Bearer ' + key, ...(voice ? {} : { 'Content-Type': 'application/json' }) },
      body: voice ? body : JSON.stringify(body)
    });
    const raw = await response.text();
    let data;
    let output = '';
    let failed = false;
    let incompleteReason = null;
    if (response.headers.get('content-type')?.includes('text/event-stream')) {
      const events = []; let final; let completed = false;
      for (const block of raw.split(/\\r?\\n\\r?\\n/)) {
        const data = block.split(/\\r?\\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\\n');
        if (!data || data === '[DONE]') continue;
        let event; try { event = JSON.parse(data); } catch { throw new Error('Meta returned an invalid stream event.'); }
        events.push(event);
        if (event.type === 'error' || event.type === 'response.failed') failed = true;
        if (event.type === 'response.incomplete' || event.response?.status === 'incomplete') incompleteReason = event.response?.incomplete_details?.reason || event.incomplete_details?.reason || 'not provided by API';
        if (event.type === 'response.completed' || event.response?.status === 'completed') completed = true;
        if (event.type === 'response.output_text.delta') output += event.delta || '';
        if (event.response) final = event.response;
      }
      if (!completed && !failed && incompleteReason === null) incompleteReason = 'stream ended before completion';
      data = { ...(final || { output_text: output }), events };
    } else {
      try { data = JSON.parse(raw); } catch { throw new Error('Meta returned a non-JSON response (HTTP ' + response.status + ').'); }
    }
    const responsePath = await saveJson(stem + '-response.json', data);
    await rm(new URL(stem + '-result.json', import.meta.url), { force: true });
    if (incompleteReason !== null || data?.status === 'incomplete') {
      const reason = redact(String(incompleteReason || data.incomplete_details?.reason || 'not provided by API')).replace(/[\\r\\n]+/g, ' ').slice(0, 120);
      throw new Error('Meta response incomplete (reason: ' + reason + '). No result saved. Full response: ' + responsePath);
    }
    if (!response.ok) throw new Error('Meta API HTTP ' + response.status + '. Saved: ' + responsePath);
    if (!data || typeof data !== 'object' || failed || data.error || data.status === 'failed') throw new Error('Meta response failed. Saved: ' + responsePath);
    const text = (Array.isArray(data.output) ? data.output : []).flatMap(item => item.content || []).filter(item => item.type === 'output_text').map(item => item.text).join('') || data.output_text || output;
    let result;
    if (config.model === 'muse-spark-1.3') {
      try { result = JSON.parse(text); } catch { throw new Error('Enrichment is missing or invalid JSON. Saved: ' + responsePath); }
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Enrichment must be a JSON object. Saved: ' + responsePath);
      if (Array.isArray(result.visibleText)) result.visibleText = cleanVisibleText(result.visibleText);
    } else if (voice) {
      result = data.turns ?? data;
    } else {
      try { result = JSON.parse(text); } catch { result = text ? { output_text: text } : data.output ?? data; }
    }
    await saveJson(stem + '-result.json', result);
  }
  try {
  if (config.model === 'muse-voice-transcribe-1.0') {
    if (media.length !== 1 || media[0].mimeType !== 'audio/wav') throw new Error('Actual WAV audio bytes are required.');
    const body = new FormData();
    body.append('request', new Blob([JSON.stringify({ model: config.model, mode: 'DIARIZATION', audioEncoding: 'WAV' })], { type: 'application/json' }), 'request.json');
    body.append('audio', new Blob([media[0].bytes], { type: 'audio/wav' }), 'audio.wav');
    await request(body, 'muse-voice-transcribe', true);
  } else if (config.model === 'sam-3.1') {
    if (!media.length || !config.target) throw new Error('Verified media and an explicit segmentation target are required.');
    for (const [index, asset] of media.entries()) {
      await request({ model: config.model, store: false, stream: true, input: [{ type: 'message', role: 'user', content: [
        { type: 'input_text', text: config.target }, await mediaPart(asset)
      ] }] }, media.length === 1 ? 'sam' : 'sam-slide-' + (asset.position ?? index + 1));
    }
  } else {
    if (!media.length && !config.context.caption) throw new Error('Caption or verified media bytes are required.');
    const prompt = config.enrichmentPrompt + (config.incompleteCapture ? '\\nCapture is partial: only the supplied slides are available.' : '') + '\\nCaptured context: ' + JSON.stringify(config.context) + '\\nMP4 audio-track evidence (presence does not establish speech): ' + JSON.stringify(config.videoAudio);
    const parts = [];
    for (const asset of media) parts.push({ type: 'input_text', text: 'Slide position: ' + (asset.position ?? 'unknown') }, await mediaPart(asset));
    await request({ model: config.model, store: false, reasoning: { effort: REASONING_EFFORT }, max_output_tokens: 8192,
      text: { format: { type: 'json_schema', name: 'content_enrichment', strict: true, schema: config.schema } },
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt }, ...parts] }] }, 'muse-spark');
  }
  } finally {
    for (const id of uploaded) {
      try {
        const removed = await fetch('https://api.meta.ai/v1/files/' + encodeURIComponent(id), { method: 'DELETE', headers: { Authorization: 'Bearer ' + key }, redirect: 'error', signal: AbortSignal.timeout(30000) });
        if (!removed.ok) console.error('Meta Files cleanup HTTP ' + removed.status + '; file expires automatically.');
      } catch { console.error('Meta Files cleanup could not finish; file expires automatically.'); }
    }
  }
  console.log('Saved: ' + saved.join(', '));
}
main().catch(error => {
  const message = error instanceof Error ? error.message : 'Unexpected error.';
  console.error('Export script failed: ' + message.replaceAll(process.env.MODEL_API_KEY?.trim() || '\\0', '[REDACTED]').replace(/[\\r\\n]+/g, ' ').slice(0, 500));
  process.exitCode = 1;
});
`;
  const bytes = new TextEncoder().encode(script);
  if (format === 'files') return { name: names[model], mimeType: 'text/javascript', bytes, files: [{ name: names[model], bytes }, ...(bundle ? assets : [])] };
  return bundle ? { name: names[model].replace('.mjs', '.zip'), mimeType: 'application/zip', bytes: zipFiles([{ name: names[model], bytes }, ...assets]) }
    : { name: names[model], mimeType: 'text/javascript', bytes };
}
