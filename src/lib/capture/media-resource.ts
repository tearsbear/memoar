export async function readResourceBytes(response: Response, maximum: number): Promise<Uint8Array<ArrayBuffer>> {
  const length = response.headers.get('content-length');
  const declared = length === null ? null : Number(length);
  if (declared !== null && (!Number.isSafeInteger(declared) || declared <= 0 || declared > maximum)) {
    await response.body?.cancel(); throw new Error('Invalid or excessive media Content-Length.');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Media response has no readable bytes.');
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maximum) { await reader.cancel(); throw new Error('Media exceeds its byte limit.'); }
      parts.push(new Uint8Array(value));
    }
  } finally { reader.releaseLock(); }
  if (!size || declared !== null && declared !== size) throw new Error('Empty or truncated media response.');
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
}
