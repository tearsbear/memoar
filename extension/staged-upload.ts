import { put } from '@vercel/blob/client';
import { MEMOAR_ORIGIN } from '../src/lib/capture/protocol';
import type { SavedPost } from '../src/lib/library/types';
import type { LibraryAsset } from '../src/lib/library/types';

type UploadGrant = { index: number; path: string; ticket: string; token: string };
export class StageUploadError extends Error {
  constructor(message: string, public code?: 'payload_too_large' | 'storage_not_configured') { super(message); }
}
export async function stageUpload(post: SavedPost, assets: LibraryAsset[], token: string) {
  const capture = JSON.stringify(post.capture);
  const media = [];
  for (const asset of assets) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await asset.blob.arrayBuffer()));
    media.push({ index: asset.itemIndex, sha256: Array.from(digest, value => value.toString(16).padStart(2, '0')).join('') });
  }
  const response = await fetch(`${MEMOAR_ORIGIN}/api/enrich/uploads`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ capture, media }), redirect: 'error', signal: AbortSignal.timeout(30000) });
  const data = await response.json();
  if (!response.ok) throw new StageUploadError(typeof data.error === 'string' ? data.error : 'Temporary media upload is unavailable.', ['payload_too_large', 'storage_not_configured'].includes(data.code) ? data.code : undefined);
  if (!Array.isArray(data.uploads) || data.uploads.length !== assets.length) throw new Error('The AI server returned an invalid upload manifest.');
  const grants = data.uploads as UploadGrant[];
  const tickets = grants.map(grant => grant.ticket);
  const cleanup = async () => {
    await fetch(`${MEMOAR_ORIGIN}/api/enrich/uploads`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ tickets }), redirect: 'error', signal: AbortSignal.timeout(15000) });
  };
  try {
    const seen = new Set<number>();
    const deadline = AbortSignal.timeout(120000);
    for (const grant of grants) {
      const asset = assets.find(item => item.itemIndex === grant.index);
      if (!asset || seen.has(grant.index) || !/^memoar-ai\/\d{13}\/[a-f0-9-]{36}$/.test(grant.path) || typeof grant.ticket !== 'string' || typeof grant.token !== 'string' || !grant.token.startsWith('vercel_blob_client_')) throw new Error('The AI server returned an invalid media upload.');
      seen.add(grant.index);
      await put(grant.path, asset.blob, { access: 'private', token: grant.token, contentType: asset.mimeType, abortSignal: deadline });
    }
    return { body: JSON.stringify({ capture, tickets }), cleanup };
  } catch (error) { await cleanup().catch(() => {}); throw error; }
}
