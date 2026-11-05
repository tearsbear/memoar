import 'server-only';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { del, get } from '@vercel/blob';
import { validEnrichmentAccess } from './enrichment-auth';
import { isMemoarOrigin } from '../capture/protocol';

export const STAGED_PREFIX = 'memoar-ai/';
export const MAX_STAGED_BYTES = 53 * 1024 * 1024;
export type StageTicket = { path: string; index: number; bytes: number; mime: string; sha256: string; captureHash: string; owner: string; expires: number };
export const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
export function uploadAuth(request: Request): string | null {
  const secret = process.env.MEMOAR_ENRICHMENT_TOKEN?.trim();
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
  const url = new URL(request.url);
  return secret && secret.length >= 24 && validEnrichmentAccess(token, secret) && isMemoarOrigin(url.origin) && request.headers.get('host') === url.host ? token : null;
}
export function signStage(input: Omit<StageTicket, 'path' | 'expires' | 'owner'>, auth: string) {
  const ticket: StageTicket = { ...input, path: `${STAGED_PREFIX}${Date.now()}/${randomUUID()}`, expires: Date.now() + 15 * 60 * 1000, owner: hash(auth) };
  const payload = Buffer.from(JSON.stringify(ticket)).toString('base64url');
  const signature = createHmac('sha256', process.env.MEMOAR_ENRICHMENT_TOKEN!).update(payload).digest('hex');
  return { ticket, signed: `${payload}.${signature}` };
}
export function verifyStage(signed: unknown, auth: string): StageTicket {
  if (typeof signed !== 'string' || signed.length > 2000) throw new Error('Invalid media upload ticket.');
  const parts = signed.split('.');
  if (parts.length !== 2 || !/^[a-f0-9]{64}$/.test(parts[1])) throw new Error('Invalid media upload ticket.');
  const signature = createHmac('sha256', process.env.MEMOAR_ENRICHMENT_TOKEN!).update(parts[0]).digest('hex');
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(parts[1]))) throw new Error('Invalid media upload ticket.');
  const ticket = JSON.parse(Buffer.from(parts[0], 'base64url').toString()) as StageTicket;
  if (ticket.owner !== hash(auth) || ticket.expires <= Date.now() || !/^memoar-ai\/\d{13}\/[a-f0-9-]{36}$/.test(ticket.path)) throw new Error('Media upload expired. Retry to upload a fresh copy.');
  return ticket;
}
export async function readSmallJson(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('No upload manifest supplied.');
  const chunks: Uint8Array<ArrayBuffer>[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 512 * 1024) { await reader.cancel(); throw new Error('Upload manifest exceeds its size limit.'); }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}
export async function readStaged(ticket: StageTicket, signal: AbortSignal): Promise<File> {
  const result = await get(ticket.path, { access: 'private', useCache: false, abortSignal: signal });
  if (!result || result.statusCode !== 200) throw new Error('Temporary media is no longer available. Retry to upload again.');
  const reader = result.stream.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = []; let size = 0;
  try {
    if (result.blob.size !== ticket.bytes || result.blob.contentType !== ticket.mime) throw new Error('Temporary media does not match its capture.');
    while (true) {
      if (signal.aborted) throw new Error('Media transfer was interrupted.');
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > ticket.bytes) throw new Error('Temporary media exceeds its verified size.');
      chunks.push(new Uint8Array(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = Buffer.concat(chunks);
  if (size !== ticket.bytes || hash(bytes) !== ticket.sha256) throw new Error('Temporary media integrity check failed.');
  return new File([bytes], 'captured-media', { type: ticket.mime });
}
export async function deleteStaged(paths: string[]) {
  if (paths.length) await del(paths, { abortSignal: AbortSignal.timeout(10000) });
}
