// ZIP STORE records need no compression library and preserve the validated bytes exactly.
export function zipFiles(files: Array<{ name: string; bytes: Uint8Array<ArrayBuffer> }>): Uint8Array<ArrayBuffer> {
  const records: Uint8Array<ArrayBuffer>[] = [], directory: Uint8Array<ArrayBuffer>[] = []; let offset = 0;
  const crc = (bytes: Uint8Array) => { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let i = 0; i < 8; i++) value = value >>> 1 ^ (value & 1 ? 0xedb88320 : 0); } return (value ^ 0xffffffff) >>> 0; };
  for (const file of files) {
    if (!/^(?:media\/)?[a-z0-9.-]+$/.test(file.name) || file.name.split('/').some(part => part === '.' || part === '..')) throw new Error('Unsafe ZIP filename.');
    const name = new TextEncoder().encode(file.name), checksum = crc(file.bytes);
    const local = new Uint8Array(30 + name.length), l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint32(14, checksum, true); l.setUint32(18, file.bytes.length, true); l.setUint32(22, file.bytes.length, true); l.setUint16(26, name.length, true); local.set(name, 30);
    const central = new Uint8Array(46 + name.length), c = new DataView(central.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint32(16, checksum, true); c.setUint32(20, file.bytes.length, true); c.setUint32(24, file.bytes.length, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true); central.set(name, 46);
    records.push(local, file.bytes); directory.push(central); offset += local.length + file.bytes.length;
  }
  const directorySize = directory.reduce((sum, record) => sum + record.length, 0);
  const end = new Uint8Array(22), e = new DataView(end.buffer); e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, directorySize, true); e.setUint32(16, offset, true);
  const result = new Uint8Array(offset + directorySize + end.length); let position = 0;
  for (const record of [...records, ...directory, end]) { result.set(record, position); position += record.length; }
  return result;
}
