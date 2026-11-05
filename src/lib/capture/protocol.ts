declare const MEMOAR_EXTENSION_ORIGIN: string | undefined;
export const MEMOAR_ORIGIN = typeof MEMOAR_EXTENSION_ORIGIN === 'string' ? MEMOAR_EXTENSION_ORIGIN : 'https://memoar.vercel.app';
export const LOCAL_MEMOAR_ORIGIN = 'http://localhost:3000';
export function isMemoarOrigin(origin: string): boolean {
  return origin === 'https://memoar.vercel.app' || origin === LOCAL_MEMOAR_ORIGIN;
}
export const CAPTURE_TTL_MS = 5 * 60 * 1000;
export const MAX_CAPTURE_BYTES = 256 * 1024;
export const MAX_TEXT_CHARS = 32000;
export const MAX_URL_CHARS = 4096;
export const CAPTURE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const EXTENSION_ID = /^[a-p]{32}$/;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function captureBytes(value: unknown): number {
  return new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).byteLength;
}

export function isMemoarSender(sender: { id?: string; url?: string; origin?: string; frameId?: number }): boolean {
  if (sender.id || !sender.url || sender.frameId !== 0) return false;
  try {
    const origin = new URL(sender.url).origin;
    return isMemoarOrigin(origin) && (!sender.origin || sender.origin === origin);
  } catch { return false; }
}

export function isTakeRequest(value: unknown): value is { type: 'TAKE_CAPTURE'; captureId: string } {
  return isRecord(value) && Object.keys(value).length === 2 && value.type === 'TAKE_CAPTURE'
    && typeof value.captureId === 'string' && CAPTURE_ID.test(value.captureId);
}

export type MediaTransferRequest = { type: 'TAKE_MEDIA_CHUNK'; captureId: string; itemIndex: number; offset: number }
  | { type: 'RELEASE_MEDIA'; captureId: string };

export function isMediaTransferRequest(value: unknown): value is MediaTransferRequest {
  if (!isRecord(value) || typeof value.captureId !== 'string' || !CAPTURE_ID.test(value.captureId)) return false;
  if (value.type === 'RELEASE_MEDIA') return Object.keys(value).length === 2;
  return value.type === 'TAKE_MEDIA_CHUNK' && Object.keys(value).length === 4
    && Number.isInteger(value.itemIndex) && Number(value.itemIndex) >= 0 && Number(value.itemIndex) < 20
    && Number.isInteger(value.offset) && Number(value.offset) >= 0 && Number(value.offset) < 50 * 1024 * 1024;
}
