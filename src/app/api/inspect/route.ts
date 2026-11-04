import 'server-only';
import { inspectPost } from '@/lib/inspection/inspect';
import { UrlValidationError } from '@/lib/inspection/parse-url';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store, max-age=0', 'X-Content-Type-Options': 'nosniff' };

export async function POST(request: Request): Promise<Response> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return Response.json({ error: { code: 'invalid_request', message: 'Send a JSON object with one URL.' } }, { status: 400, headers });
  }
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ error: { code: 'invalid_request', message: 'Use the inspector on this site.' } }, { status: 403, headers });
  }
  let body: unknown;
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: { code: 'invalid_request', message: 'A URL is required.' } }, { status: 400, headers });
  try {
    let raw = '';
    let bytes = 0;
    const decoder = new TextDecoder();
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 8192) {
        await reader.cancel();
        return Response.json({ error: { code: 'invalid_request', message: 'Request exceeds the 8 KiB limit.' } }, { status: 400, headers });
      }
      raw += decoder.decode(part.value, { stream: true });
    }
    body = JSON.parse(raw + decoder.decode());
  } catch {
    return Response.json({ error: { code: 'invalid_request', message: 'Send a valid JSON object with one URL.' } }, { status: 400, headers });
  } finally { reader.releaseLock(); }
  try {
    const url = body && typeof body === 'object' && !Array.isArray(body) && 'url' in body ? body.url : undefined;
    const result = await inspectPost(url, { displayEnabled: process.env.MEMOAR_EMBEDS_ENABLED !== 'false' });
    return Response.json(result, { headers });
  } catch (error) {
    if (error instanceof UrlValidationError) return Response.json({ error: { code: error.code, message: error.message } }, { status: 400, headers });
    return Response.json({ error: { code: 'inspection_failed', message: 'Inspection failed internally. Try inspecting this URL again.' } }, { status: 500, headers });
  }
}
