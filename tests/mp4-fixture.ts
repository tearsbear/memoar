const text = (value: string) => new TextEncoder().encode(value);
const words = (...values: number[]) => {
  const bytes = new Uint8Array(values.length * 4), view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setUint32(index * 4, value));
  return bytes;
};
function concat(...parts: Uint8Array<ArrayBuffer>[]): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
}
export const mp4Box = (type: string, ...parts: Uint8Array<ArrayBuffer>[]) => {
  const body = concat(...parts);
  return concat(words(body.length + 8), text(type), body);
};

// Minimal sample-table fixture; codec decoding is injected independently in capture tests.
export function mp4Fixture(audio = true): Uint8Array<ArrayBuffer> {
  const ftyp = mp4Box('ftyp', text('isom'), words(0), text('isom'));
  const track = (kind: 'vide' | 'soun', offset: number) => {
    const entry = new Uint8Array(kind === 'vide' ? 78 : 28), view = new DataView(entry.buffer);
    view.setUint16(6, 1);
    if (kind === 'vide') { view.setUint16(24, 1080); view.setUint16(26, 1920); }
    const stbl = mp4Box('stbl',
      mp4Box('stsd', words(0, 1), mp4Box(kind === 'vide' ? 'avc1' : 'mp4a', entry)),
      mp4Box('stts', words(0, 1, 1, 2000)), mp4Box('stsz', words(0, 4, 1)),
      mp4Box('stsc', words(0, 1, 1, 1, 1)), mp4Box('stco', words(0, 1, offset)));
    return mp4Box('trak', mp4Box('mdia', mp4Box('mdhd', words(0, 0, 0, 1000, 2000, 0)),
      mp4Box('hdlr', words(0, 0), text(kind)), mp4Box('minf', stbl)));
  };
  return concat(ftyp, mp4Box('mdat', new Uint8Array(audio ? 8 : 4).fill(1)),
    mp4Box('moov', track('vide', ftyp.length + 8), ...(audio ? [track('soun', ftyp.length + 12)] : [])));
}
