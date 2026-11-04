import { CAPTURE_TTL_MS } from '../src/lib/capture/protocol';
import { normalizeCapture, type CaptureEnvelope } from '../src/lib/capture/normalize';

export type PendingCapture = { id: string; expiresAt: number; payload: CaptureEnvelope };
export type SessionStorage = {
  get: () => Promise<PendingCapture | null>;
  set: (value: PendingCapture) => Promise<void>;
  clear: () => Promise<void>;
};

export function createCaptureSession(storage: SessionStorage, now = Date.now, uuid: () => string = () => crypto.randomUUID()) {
  let queue: Promise<unknown> = Promise.resolve();
  const serialized = <T>(action: () => Promise<T>): Promise<T> => {
    const next = queue.then(action, action);
    queue = next.catch(() => {});
    return next;
  };
  async function current() {
    const value = await storage.get();
    if (value && value.expiresAt <= now()) { await storage.clear(); return null; }
    return value;
  }
  return {
    put: (input: unknown) => serialized(async () => {
      const value = { id: uuid(), expiresAt: now() + CAPTURE_TTL_MS, payload: normalizeCapture(input) };
      await storage.set(value);
      return value;
    }),
    peek: () => serialized(current),
    take: (id: string) => serialized(async () => {
      const value = await current();
      if (!value || value.id !== id) throw new Error('Capture is missing, expired, or already imported. Capture the post again, or use copied JSON.');
      await storage.clear();
      return normalizeCapture(value.payload);
    }),
  };
}
