import { isRecord } from './protocol';

export type CaptureSnapshot =
  | { status: 'available'; dataUrl: string; width: number; height: number; source: 'browser_snapshot'; processingEligibility: 'unverified' }
  | { status: 'unavailable'; reason: string };
export type SnapshotRegion = { x: number; y: number; width: number; height: number; viewportWidth: number; viewportHeight: number; scrollX: number; scrollY: number };
export const MAX_SNAPSHOT_CHARS = 128 * 1024;

export function validateRegion(input: unknown): SnapshotRegion {
  if (!isRecord(input)) throw new Error('No visible media region was identified.');
  const result = {} as SnapshotRegion;
  for (const key of ['x', 'y', 'width', 'height', 'viewportWidth', 'viewportHeight', 'scrollX', 'scrollY'] as const) {
    const value = input[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1000000) throw new Error('Invalid snapshot region.');
    result[key] = value;
  }
  if (result.x < 0 || result.y < 0 || result.width < 16 || result.height < 16 || result.viewportWidth <= 0 || result.viewportHeight <= 0
    || result.x + result.width > result.viewportWidth + 1 || result.y + result.height > result.viewportHeight + 1) throw new Error('Snapshot region is outside the visible viewport.');
  return result;
}

export function normalizeSnapshot(input: unknown): CaptureSnapshot | undefined {
  if (input === undefined) return undefined;
  if (!isRecord(input)) throw new Error('Invalid snapshot.');
  if (input.status === 'unavailable') {
    if (typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 1000) throw new Error('Invalid snapshot reason.');
    return { status: 'unavailable', reason: input.reason };
  }
  if (input.status !== 'available' || typeof input.dataUrl !== 'string' || input.dataUrl.length > MAX_SNAPSHOT_CHARS
    || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(input.dataUrl)) throw new Error('Invalid or oversized JPEG snapshot.');
  const bytes = Uint8Array.from(atob(input.dataUrl.slice('data:image/jpeg;base64,'.length)), char => char.charCodeAt(0));
  if (bytes[0] !== 255 || bytes[1] !== 216 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) throw new Error('Invalid JPEG snapshot.');
  let dimensions: [number, number] | undefined;
  for (let offset = 2; offset + 8 < bytes.length;) {
    if (bytes[offset++] !== 255) break;
    const marker = bytes[offset++];
    if (marker === 218 || marker === 217) break;
    const length = bytes[offset] * 256 + bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) break;
    if ([192, 193, 194].includes(marker)) { dimensions = [bytes[offset + 5] * 256 + bytes[offset + 6], bytes[offset + 3] * 256 + bytes[offset + 4]]; break; }
    offset += length;
  }
  if (!dimensions || dimensions.some(value => value < 1 || value > 720) || dimensions[0] !== input.width || dimensions[1] !== input.height) throw new Error('Invalid snapshot dimensions.');
  return { status: 'available', dataUrl: input.dataUrl, width: dimensions[0], height: dimensions[1], source: 'browser_snapshot', processingEligibility: 'unverified' };
}
