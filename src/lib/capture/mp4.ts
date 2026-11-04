export const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
export type Mp4Metadata = { width: number; height: number; durationSeconds: number; audio: 'present' | 'absent' };

// Validate progressive sample tables against the actual downloaded mdat ranges.
// DASH fragments, encrypted tracks and unfamiliar sample tables remain reference-only.
export function inspectMp4(bytes: Uint8Array<ArrayBuffer>): Mp4Metadata {
  if (!bytes.length || bytes.length > MAX_VIDEO_BYTES) throw new Error('MP4 is empty or exceeds 25 MiB.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  type Box = { type: string; start: number; data: number; end: number };
  const uint64 = (offset: number) => {
    const value = Number(view.getBigUint64(offset));
    if (!Number.isSafeInteger(value)) throw new Error('MP4 integer exceeds supported bounds.');
    return value;
  };
  let boxCount = 0;
  const boxes = (start: number, end: number): Box[] => {
    const result: Box[] = [];
    while (start < end) {
      if (++boxCount > 10000 || start + 8 > end) throw new Error('Invalid or excessive MP4 boxes.');
      let size = view.getUint32(start), header = 8;
      if (size === 1) { if (start + 16 > end) throw new Error('Truncated MP4 box.'); size = uint64(start + 8); header = 16; }
      else if (size === 0) size = end - start;
      if (size < header || start + size > end) throw new Error('Truncated MP4 box.');
      result.push({ type: new TextDecoder().decode(bytes.subarray(start + 4, start + 8)), start, data: start + header, end: start + size });
      start += size;
    }
    return result;
  };
  const only = (list: Box[], type: string): Box => {
    const found = list.filter(box => box.type === type);
    if (found.length !== 1) throw new Error(`Missing or ambiguous MP4 ${type}.`);
    return found[0];
  };
  const requireBytes = (box: Box, length: number) => { if (box.end - box.data < length) throw new Error(`Truncated MP4 ${box.type}.`); };
  const table = (box: Box, stride: number) => {
    requireBytes(box, 8);
    const count = view.getUint32(box.data + 4);
    if (!count || count > 1000000 || box.data + 8 + count * stride !== box.end) throw new Error(`Invalid MP4 ${box.type} table.`);
    return count;
  };
  const top = boxes(0, bytes.length);
  const ftyp = only(top, 'ftyp'); requireBytes(ftyp, 8);
  const moov = only(top, 'moov');
  const data = top.filter(box => box.type === 'mdat' && box.end > box.data);
  const movie = boxes(moov.data, moov.end);
  if (!data.length || top.some(box => box.type === 'moof') || movie.some(box => box.type === 'mvex')) throw new Error('Fragmented/DASH MP4 is not a complete progressive file.');
  const ranges: { start: number; end: number }[] = [];
  let video: Mp4Metadata | undefined;
  let audio = false;
  for (const trak of movie.filter(box => box.type === 'trak')) {
    const mdia = only(boxes(trak.data, trak.end), 'mdia');
    const track = boxes(mdia.data, mdia.end);
    const hdlr = only(track, 'hdlr'); requireBytes(hdlr, 12);
    const kind = new TextDecoder().decode(bytes.subarray(hdlr.data + 8, hdlr.data + 12));
    if (!['vide', 'soun'].includes(kind)) throw new Error('Unsupported MP4 track type.');
    const mdhd = only(track, 'mdhd'); requireBytes(mdhd, 20);
    const version = bytes[mdhd.data];
    if (version > 1) throw new Error('Unsupported MP4 timing version.');
    if (version === 1) requireBytes(mdhd, 32);
    const scale = view.getUint32(mdhd.data + (version === 1 ? 20 : 12));
    const duration = version === 1 ? uint64(mdhd.data + 24) : view.getUint32(mdhd.data + 16);
    const durationSeconds = duration / scale;
    if (!scale || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 86400) throw new Error('Invalid MP4 duration.');
    const minf = only(track, 'minf');
    const stbl = only(boxes(minf.data, minf.end), 'stbl');
    const samples = boxes(stbl.data, stbl.end);
    const stsd = only(samples, 'stsd'); requireBytes(stsd, 8);
    const entries = boxes(stsd.data + 8, stsd.end);
    if (view.getUint32(stsd.data + 4) !== 1 || entries.length !== 1) throw new Error('Unsupported MP4 sample descriptions.');
    const entry = entries[0];
    if (!((kind === 'vide' ? ['avc1', 'avc3', 'hvc1', 'hev1', 'av01', 'vp09'] : ['mp4a', 'Opus']).includes(entry.type))) throw new Error('Encrypted or unsupported MP4 codec.');
    if (kind === 'vide') {
      requireBytes(entry, 78);
      const width = view.getUint16(entry.data + 24), height = view.getUint16(entry.data + 26);
      if (!width || !height || width > 50000 || height > 50000 || video) throw new Error('Invalid or multiple MP4 video tracks.');
      if (boxes(entry.data + 78, entry.end).some(box => box.type === 'sinf')) throw new Error('Protected MP4 video.');
      video = { width, height, durationSeconds, audio: 'absent' };
    } else {
      requireBytes(entry, 28);
      if (view.getUint16(entry.data + 8) !== 0) throw new Error('Unsupported MP4 audio sample version.');
      if (boxes(entry.data + 28, entry.end).some(box => box.type === 'sinf')) throw new Error('Protected MP4 audio.');
      audio = true;
    }
    const stsz = only(samples, 'stsz'); requireBytes(stsz, 12);
    const fixed = view.getUint32(stsz.data + 4), count = view.getUint32(stsz.data + 8);
    if (!count || count > 1000000 || stsz.data + 12 + (fixed ? 0 : count * 4) !== stsz.end) throw new Error('Invalid MP4 sample sizes.');
    const stts = only(samples, 'stts'), timingCount = table(stts, 8);
    let timedSamples = 0, ticks = 0;
    for (let i = 0; i < timingCount; i++) {
      const n = view.getUint32(stts.data + 8 + i * 8), delta = view.getUint32(stts.data + 12 + i * 8);
      if (!n || !delta) throw new Error('Invalid MP4 sample timing.');
      timedSamples += n; ticks += n * delta;
    }
    if (timedSamples !== count || ticks !== duration) throw new Error('Inconsistent MP4 duration or sample count.');
    const offsets = samples.filter(box => ['stco', 'co64'].includes(box.type));
    if (offsets.length !== 1) throw new Error('Unsupported MP4 chunk offsets.');
    const offsetBox = offsets[0], stride = offsetBox.type === 'co64' ? 8 : 4, chunks = table(offsetBox, stride);
    const stsc = only(samples, 'stsc'), mappings = table(stsc, 12);
    const mapping: { first: number; count: number }[] = [];
    for (let i = 0; i < mappings; i++) {
      const offset = stsc.data + 8 + i * 12, first = view.getUint32(offset), n = view.getUint32(offset + 4);
      if (!n || first > chunks || (i === 0 ? first !== 1 : first <= mapping[i - 1].first) || view.getUint32(offset + 8) !== 1) throw new Error('Invalid MP4 chunk mapping.');
      mapping.push({ first, count: n });
    }
    let sample = 0, mappingIndex = 0;
    for (let chunk = 1; chunk <= chunks; chunk++) {
      if (mapping[mappingIndex + 1]?.first === chunk) mappingIndex++;
      const n = mapping[mappingIndex].count;
      if (sample + n > count) throw new Error('MP4 sample count exceeds its table.');
      const offset = offsetBox.data + 8 + (chunk - 1) * stride;
      const start = stride === 8 ? uint64(offset) : view.getUint32(offset);
      let size = 0;
      for (let i = 0; i < n; i++, sample++) {
        const length = fixed || view.getUint32(stsz.data + 12 + sample * 4);
        if (!length) throw new Error('Empty MP4 sample.');
        size += length;
      }
      if (!data.some(box => start >= box.data && start + size <= box.end)) throw new Error('MP4 sample bytes are missing or truncated.');
      ranges.push({ start, end: start + size });
    }
    if (sample !== count) throw new Error('MP4 samples are incomplete.');
  }
  ranges.sort((a, b) => a.start - b.start);
  if (ranges.some((range, i) => i > 0 && range.start < ranges[i - 1].end)) throw new Error('Overlapping MP4 samples.');
  if (!video) throw new Error('MP4 has no video samples.');
  return { ...video, audio: audio ? 'present' : 'absent' };
}

export async function mediaDigest(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function decodeMp4(blob: Blob, signal: AbortSignal): Promise<{ width: number; height: number; duration: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(blob);
    const cleanup = () => {
      signal.removeEventListener('abort', aborted);
      video.onloadeddata = video.onerror = null;
      video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url);
    };
    const aborted = () => { cleanup(); reject(new Error('MP4 decoding timed out.')); };
    video.onloadeddata = () => {
      const metadata = { width: video.videoWidth, height: video.videoHeight, duration: video.duration };
      cleanup();
      if (!metadata.width || !metadata.height || !Number.isFinite(metadata.duration) || metadata.duration <= 0) reject(new Error('MP4 could not be decoded.'));
      else resolve(metadata);
    };
    video.onerror = () => { cleanup(); reject(new Error('MP4 codec or sample decoding failed.')); };
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) { aborted(); return; }
    video.preload = 'auto'; video.muted = true; video.src = url; video.load();
  });
}
