import { list } from '@vercel/blob';
import { deleteStaged, STAGED_PREFIX } from '@/lib/library/staged-media';

export const runtime = 'nodejs';
export const maxDuration = 60;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) return new Response('Unauthorized', { status: 401 });
  if (!process.env.BLOB_READ_WRITE_TOKEN) return Response.json({ error: 'Blob storage is not configured.' }, { status: 503 });
  let cursor: string | undefined, removed = 0;
  // Bound each sweep; untouched pages remain eligible for the next daily run.
  for (let page = 0; page < 20; page++) {
    const result = await list({ prefix: STAGED_PREFIX, cursor, limit: 100, abortSignal: AbortSignal.timeout(10000) });
    const stale = result.blobs.filter(blob => blob.uploadedAt.getTime() < Date.now() - 86400000).map(blob => blob.pathname);
    await deleteStaged(stale); removed += stale.length;
    if (!result.hasMore) break;
    cursor = result.cursor;
  }
  return Response.json({ removed }, { headers: { 'Cache-Control': 'no-store' } });
}
