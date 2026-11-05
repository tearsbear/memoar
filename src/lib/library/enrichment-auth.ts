import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

export function createEnrichmentAccess(secret: string): string {
  const expires = String(Date.now() + 86400000);
  return `${expires}.${createHmac('sha256', secret).update(expires).digest('hex')}`;
}
export function validEnrichmentAccess(token: string, secret: string): boolean {
  const equal = (a: string, b: string) => Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
  if (equal(token, secret)) return true;
  const [expires, signature] = token.split('.');
  if (!/^\d{13}$/.test(expires ?? '') || !/^[a-f0-9]{64}$/.test(signature ?? '') || Number(expires) <= Date.now() || Number(expires) > Date.now() + 86400000) return false;
  return equal(signature, createHmac('sha256', secret).update(expires).digest('hex'));
}
