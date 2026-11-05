import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client';
import { normalizeCapture } from '@/lib/capture/normalize';
import { hash, MAX_STAGED_BYTES, readSmallJson, signStage, uploadAuth, verifyStage, deleteStaged } from '@/lib/library/staged-media';

export const runtime = 'nodejs';
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
let started = 0, grants = 0;
export async function POST(request: Request) {
  const auth = uploadAuth(request);
  if (!auth) return json({ error: 'Open Memoar to reconnect background organizing.' }, 401);
  if (!process.env.BLOB_READ_WRITE_TOKEN) return json({ code: 'storage_not_configured', error: 'Large-media processing needs a private Vercel Blob store. The project owner must configure BLOB_READ_WRITE_TOKEN and redeploy. Retrying unchanged will not help; your post remains saved.' }, 503);
  try {
    if (Date.now() - started > 3600000) { started = Date.now(); grants = 0; }
    if (grants >= 20) return json({ error: 'The upload limit for this server instance has been reached. Try later.' }, 429);
    const body = await readSmallJson(request);
    if (typeof body.capture !== 'string' || !Array.isArray(body.media) || !body.media.length || body.media.length > 20) return json({ error: 'Invalid media manifest.' }, 400);
    const capture = normalizeCapture(JSON.parse(body.capture));
    let total = Buffer.byteLength(body.capture);
    const seen = new Set<number>();
    const tickets: ReturnType<typeof signStage>[] = body.media.map((entry: { index: number; sha256: string }) => {
      const item = capture.inspection.media?.items[entry.index];
      const proof = item?.verification;
      if (!Number.isInteger(entry.index) || seen.has(entry.index) || !proof || item?.assetAccess !== 'verified_accessible' || !['image/jpeg', 'image/png', 'image/webp', 'video/mp4'].includes(proof.mimeType) || !/^[a-f0-9]{64}$/.test(entry.sha256) || (item.type === 'video' && proof.sha256 !== entry.sha256)) throw new Error('Media manifest does not match the verified capture.');
      seen.add(entry.index); total += proof.byteLength;
      return signStage({ index: entry.index, bytes: proof.byteLength, mime: proof.mimeType, sha256: entry.sha256, captureHash: hash(body.capture) }, auth);
    });
    if (total > MAX_STAGED_BYTES) return json({ code: 'payload_too_large', error: 'This post exceeds the 53 MiB processing limit. Retrying unchanged will not help; your post remains saved.' }, 413);
    grants++;
    const uploads = await Promise.all(tickets.map(async ({ ticket, signed }) => ({ index: ticket.index, path: ticket.path, ticket: signed,
      token: await generateClientTokenFromReadWriteToken({ pathname: ticket.path, maximumSizeInBytes: ticket.bytes, allowedContentTypes: [ticket.mime], validUntil: ticket.expires, addRandomSuffix: false, allowOverwrite: false, cacheControlMaxAge: 60 }),
    })));
    return json({ uploads });
  } catch { return json({ error: 'Could not prepare the media upload. Check the capture and private Blob store configuration.' }, 400); }
}
export async function DELETE(request: Request) {
  const auth = uploadAuth(request);
  if (!auth) return json({ error: 'Memoar connection required.' }, 401);
  try {
    const body = await readSmallJson(request);
    if (!Array.isArray(body.tickets) || body.tickets.length > 20) return json({ error: 'Invalid cleanup request.' }, 400);
    await deleteStaged(body.tickets.map((signed: unknown) => verifyStage(signed, auth).path));
    return json({ ok: true });
  } catch { return json({ error: 'Temporary media cleanup did not finish. Scheduled cleanup will retry.' }, 400); }
}
