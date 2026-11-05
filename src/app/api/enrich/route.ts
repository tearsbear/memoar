import 'server-only';
import { createHash } from 'node:crypto';
import { validEnrichmentAccess } from '@/lib/library/enrichment-auth';
import { normalizeCapture } from '@/lib/capture/normalize';
import { isMemoarOrigin, LOCAL_MEMOAR_ORIGIN } from '@/lib/capture/protocol';
import { enrichmentPrompt, enrichmentSchema, cleanVisibleText } from '@/lib/inspection/enrichment';
import { parseEnrichment } from '@/lib/library/enrichment';
import { modelExport } from '@/lib/inspection/model-export';
import { deleteStaged, hash, MAX_STAGED_BYTES, readStaged, verifyStage } from '@/lib/library/staged-media';

export const runtime = 'nodejs';
export const maxDuration = 240;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
let windowStart = 0, calls = 0, active = false;
export async function POST(request: Request) {
  const expected = process.env.MEMOAR_ENRICHMENT_TOKEN?.trim();
  const actual = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
  if (!expected || expected.length < 24 || !validEnrichmentAccess(actual, expected)) return json({ error: 'Open Memoar to reconnect background organizing.' }, 401);
  const url = new URL(request.url);
  if (!isMemoarOrigin(url.origin) || request.headers.get('host') !== url.host) return json({ error: 'Use the Memoar website for AI processing.' }, 403);
  const limit = url.origin === LOCAL_MEMOAR_ORIGIN ? 53 * 1024 * 1024 : 4 * 1024 * 1024;
  const key = process.env.MODEL_API_KEY?.trim();
  if (!key) return json({ error: 'AI processing is not configured yet.' }, 503);
  if (Number(request.headers.get('content-length') ?? Infinity) > limit) return json({ code: 'payload_too_large', error: 'Post media exceeds this server’s processing limit. Your post remains saved.' }, 413);
  if (active) return json({ error: 'Another post is being organized. Retry shortly.' }, 429);
  if (Date.now() - windowStart > 3600000) { windowStart = Date.now(); calls = 0; }
  if (calls >= 20) return json({ error: 'The hourly AI limit for this server instance has been reached. Try later.' }, 429);
  calls++; active = true;
  const abort = new AbortController();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (value: unknown) => { if (!abort.signal.aborted) controller.enqueue(encoder.encode(JSON.stringify(value) + '\n')); };
      send({ type: 'heartbeat' });
      const heartbeat = setInterval(() => send({ type: 'heartbeat' }), 15000);
      void processCapture(request, key, abort.signal, limit, actual).then(async response => {
        send({ type: 'result', ok: response.ok, ...await response.json() });
      }).catch(() => send({ type: 'result', ok: false, error: 'AI processing was interrupted. Your post remains saved.' })).finally(() => {
        clearInterval(heartbeat); active = false;
        if (!abort.signal.aborted) controller.close();
      });
    },
    cancel() { abort.abort(); },
  });
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } });
}

async function processCapture(request: Request, key: string, cancelled: AbortSignal, limit: number, auth: string): Promise<Response> {
  const uploaded: string[] = [], stagedPaths: string[] = [];
  const deadline = AbortSignal.any([request.signal, cancelled, AbortSignal.timeout(210000)]);
  try {
    const reader = request.body?.getReader();
    if (!reader) return json({ error: 'No captured post was supplied.' }, 400);
    const chunks: Uint8Array<ArrayBuffer>[] = []; let size = 0;
    while (true) { const result = await reader.read(); if (result.done) break; size += result.value.byteLength; if (size > limit) { await reader.cancel(); return json({ code: 'payload_too_large', error: 'Post media exceeds this server’s processing limit. Your post remains saved.' }, 413); } chunks.push(result.value); }
    const body = new Blob(chunks);
    let form: FormData;
    if (request.headers.get('content-type')?.includes('application/json')) {
      const manifest = JSON.parse(await body.text());
      if (typeof manifest.capture !== 'string' || !Array.isArray(manifest.tickets) || manifest.tickets.length > 20) return json({ error: 'Invalid staged media manifest.' }, 400);
      const tickets = manifest.tickets.map((signed: unknown) => verifyStage(signed, auth));
      stagedPaths.push(...tickets.map((ticket: { path: string }) => ticket.path));
      const captureHash = hash(manifest.capture);
      const seen = new Set<number>();
      let total = Buffer.byteLength(manifest.capture);
      const captured = normalizeCapture(JSON.parse(manifest.capture));
      for (const ticket of tickets) {
        const item = captured.inspection.media?.items[ticket.index];
        if (ticket.captureHash !== captureHash || seen.has(ticket.index) || item?.assetAccess !== 'verified_accessible' || !item.verification || item.verification.mimeType !== ticket.mime || item.verification.byteLength !== ticket.bytes) return json({ error: 'Staged media does not match the captured post.' }, 400);
        seen.add(ticket.index); total += ticket.bytes;
      }
      if (total > MAX_STAGED_BYTES) return json({ code: 'payload_too_large', error: 'This post exceeds the 53 MiB processing limit.' }, 413);
      form = new FormData(); form.set('capture', manifest.capture);
      for (const ticket of tickets) form.set(`media-${ticket.index}`, await readStaged(ticket, deadline));
    } else form = await new Response(body, { headers: { 'Content-Type': request.headers.get('content-type') ?? '' } }).formData();
    const raw = form.get('capture');
    if (typeof raw !== 'string') return json({ error: 'No captured post was supplied.' }, 400);
    const capture = normalizeCapture(JSON.parse(raw));
    const inspection = capture.inspection;
    const context = modelExport(inspection, 'museSpark').inputs.text;
    const content: unknown[] = [], videoAudio: unknown[] = [];
    for (const [index, item] of (inspection.media?.items ?? []).entries()) {
      const file = form.get(`media-${index}`);
      if (!(file instanceof File) || !item.verification || item.assetAccess !== 'verified_accessible') continue;
      if (!['image/jpeg', 'image/png', 'image/webp', 'video/mp4'].includes(file.type) || file.type !== item.verification.mimeType || file.size !== item.verification.byteLength) return json({ error: 'Captured media no longer matches its verification.' }, 400);
      const bytes = Buffer.from(await file.arrayBuffer());
      content.push({ type: 'input_text', text: `Slide position: ${item.position ?? 'unknown'}` });
      if (file.type === 'video/mp4') {
        if (!item.verification.sha256 || createHash('sha256').update(bytes).digest('hex') !== item.verification.sha256) return json({ error: 'Video bytes could not be verified. Save this post again.' }, 400);
        const upload = new FormData(); upload.set('purpose', 'user_data'); upload.set('file', new Blob([bytes], { type: 'video/mp4' }), 'video.mp4');
        upload.set('expires_after[anchor]', 'created_at'); upload.set('expires_after[seconds]', '3600');
        const response = await fetch('https://api.meta.ai/v1/files', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: upload, redirect: 'error', signal: AbortSignal.any([deadline, AbortSignal.timeout(90000)]) });
        if (!response.ok) throw new Error('Video upload is temporarily unavailable.');
        const data = await response.json();
        if (typeof data.id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(data.id)) throw new Error('Video upload returned no file reference.');
        uploaded.push(data.id); content.push({ type: 'input_video', file_id: data.id });
        videoAudio.push({ position: item.position, audio: item.verification.audio, durationSeconds: item.verification.durationSeconds });
      } else content.push({ type: 'input_image', image_url: `data:${file.type};base64,${bytes.toString('base64')}` });
    }
    if (!content.length && !context.caption) return json({ error: 'No usable text or media is stored. Open and save this post again.' }, 422);
    const analyzedMedia = content.length / 2;
    const missingMedia = (inspection.media?.items.length ?? 0) - analyzedMedia;
    const inputNote = analyzedMedia ? `Organized from ${analyzedMedia} supplied media ${analyzedMedia === 1 ? 'item' : 'items'}${context.caption ? ' and captured text' : ''}.${missingMedia > 0 ? ` ${missingMedia} captured media ${missingMedia === 1 ? 'item was' : 'items were'} not analyzed.` : ''}` : 'Organized from captured text only. Images and video were not analyzed.';
    content.unshift({ type: 'input_text', text: `${enrichmentPrompt}\nCapture is ${inspection.media?.completeness === 'partial' || missingMedia > 0 ? 'partial; only supplied slides are available' : 'limited to supplied content'}.\nCaptured context: ${JSON.stringify(context)}\nMP4 audio-track evidence (presence does not establish speech): ${JSON.stringify(videoAudio)}` });
    const response = await fetch('https://api.meta.ai/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'muse-spark-1.3', store: false, reasoning: { effort: 'low' }, max_output_tokens: 8192, text: { format: { type: 'json_schema', name: 'content_enrichment', strict: true, schema: enrichmentSchema } }, input: [{ type: 'message', role: 'user', content }] }), redirect: 'error', signal: AbortSignal.any([deadline, AbortSignal.timeout(120000)]) });
    if (!response.ok) return json({ error: response.status === 429 ? 'AI is busy. Your post stays saved; retry later.' : 'AI could not organize this post. Your saved copy is safe.' }, 502);
    const data = await response.json();
    const text = data.output_text || (Array.isArray(data.output) ? data.output.flatMap((item: { content?: { type: string; text?: string }[] }) => item.content ?? []).filter((item: { type: string }) => item.type === 'output_text').map((item: { text?: string }) => item.text ?? '').join('') : '');
    const enrichment = parseEnrichment(JSON.parse(text)); enrichment.visibleText = cleanVisibleText(enrichment.visibleText);
    return json({ enrichment, inputNote });
  } catch { return json({ error: 'AI processing did not finish. Your post remains saved; try again later.' }, 502); }
  finally {
    await Promise.allSettled([deleteStaged(stagedPaths), ...uploaded.map(id => fetch(`https://api.meta.ai/v1/files/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${key}` }, redirect: 'error', signal: AbortSignal.timeout(10000) }))]);
  }
}
