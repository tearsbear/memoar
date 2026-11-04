import type { InspectionFields, MediaCapture, MediaItem } from '../inspection/types';
import { isRecord } from './protocol';
import { MAX_VIDEO_BYTES } from './mp4';

export function normalizeMedia(raw: unknown, validate: (value: unknown) => string): MediaCapture | undefined {
  if (raw === undefined) return;
  if (!isRecord(raw) || !['single', 'carousel'].includes(String(raw.kind)) || !Array.isArray(raw.items) || raw.items.length > 20
    || !['not_requested', 'completed', 'stopped'].includes(String(raw.navigation))) throw new Error('Invalid media capture.');
  const bounded = (value: unknown) => {
    if (typeof value !== 'string' || !value || value.length > 1000) throw new Error('Invalid media reason.');
    return value;
  };
  const number = (value: unknown, maximum: number): number | null => {
    if (value === null) return null;
    if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > maximum) throw new Error('Invalid media dimensions or position.');
    return Number(value);
  };
  const items = raw.items.map((item): MediaItem => {
    if (!isRecord(item) || !['image', 'video'].includes(String(item.type)) || !['reference_only', 'verified_accessible', 'unavailable'].includes(String(item.assetAccess))) throw new Error('Invalid media item.');
    const url = item.url === null ? null : validate(item.url);
    const result: MediaItem = { position: number(item.position, 1000), type: item.type as MediaItem['type'], url,
      referenceUrl: item.referenceUrl === null ? null : validate(item.referenceUrl), posterUrl: item.posterUrl === null ? null : validate(item.posterUrl),
      width: number(item.width, 50000), height: number(item.height, 50000), processingEligibility: 'unverified',
      assetAccess: url ? item.assetAccess === 'unavailable' ? 'unavailable' : 'reference_only' : 'unavailable', reason: bounded(item.reason) };
    const proof = item.verification;
    const videoProof = item.type === 'video' && isRecord(proof) && proof.mimeType === 'video/mp4'
      && typeof proof.durationSeconds === 'number' && Number.isFinite(proof.durationSeconds) && proof.durationSeconds > 0 && proof.durationSeconds <= 86400
      && ['present', 'absent'].includes(String(proof.audio)) && typeof proof.sha256 === 'string' && /^[a-f0-9]{64}$/.test(proof.sha256);
    if (url && !url.startsWith('blob:') && isRecord(proof) && proof.method === 'cors_get'
      && (videoProof || item.type === 'image' && ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'].includes(String(proof.mimeType)))
      && Number.isInteger(proof.byteLength) && Number(proof.byteLength) > 0 && Number(proof.byteLength) <= (item.type === 'video' ? MAX_VIDEO_BYTES : 10 * 1024 * 1024)
      && typeof proof.checkedAt === 'string' && Number.isFinite(Date.parse(proof.checkedAt)) && result.width && result.height) {
      result.verification = { method: 'cors_get', mimeType: String(proof.mimeType), byteLength: Number(proof.byteLength), checkedAt: new Date(proof.checkedAt).toISOString() };
      if (videoProof) Object.assign(result.verification, { durationSeconds: proof.durationSeconds, audio: proof.audio, sha256: proof.sha256 });
      if (item.assetAccess === 'verified_accessible') result.assetAccess = 'verified_accessible';
    }
    return result;
  });
  const totalSlides = number(raw.totalSlides, 1000);
  const positions = items.map(item => item.position);
  const complete = raw.completeness === 'complete' && totalSlides !== null && items.length === totalSlides
    && new Set(positions).size === totalSlides && positions.every(position => position !== null && position <= totalSlides) && items.every(item => item.url);
  const types = new Set(items.map(item => item.type));
  return { kind: raw.kind as MediaCapture['kind'], totalSlides, items,
    ...(raw.discovery === 'embedded_json' ? { discovery: 'embedded_json' as const } : {}),
    navigation: raw.navigation as MediaCapture['navigation'], completeness: complete ? 'complete' : 'partial', reason: bounded(raw.reason),
    composition: types.size > 1 ? 'mixed' : complete && types.has('image') ? 'image_only' : complete && types.has('video') ? 'video_only' : 'unknown' };
}

export function applyMediaFields(fields: InspectionFields, media: MediaCapture): void {
  const set = (key: 'imageUrls' | 'videoUrl' | 'thumbnailUrl', value: string | string[] | null, reason: string) => {
    Object.assign(fields[key], { value, status: value === null ? 'unavailable' : 'available', source: value === null ? 'none' : 'browser_media_reference',
      reason, processingEligibility: 'unverified', assetAccess: value === null ? 'unavailable' : 'reference_only' });
  };
  const images = [...new Set(media.items.filter(item => item.type === 'image' && item.url).map(item => item.url!))];
  const videos = [...new Set(media.items.filter(item => item.type === 'video' && item.url).map(item => item.url!))];
  const posters = [...new Set(media.items.map(item => item.posterUrl).filter((value): value is string => Boolean(value)))];
  set('imageUrls', images.length ? images : null, 'Image references from matched post media; see media.items for order and accessibility.');
  set('videoUrl', videos.length === 1 ? videos[0] : null, videos.length > 1 ? 'Multiple video slides; use media.items for ordered references.' : 'Matched video reference; see media.items for MP4, duration and audio verification. Blob URLs are not reusable files.');
  set('thumbnailUrl', media.items[0]?.type === 'image' ? media.items[0].url : media.items[0]?.posterUrl ?? null,
    posters.length ? 'Observed video poster reference; not a snapshot or a verified image file.' : images.length ? 'First observed image slide.' : 'The visible video player exposed no supported poster URL.');
  if (media.kind === 'carousel' || media.items.length === 1) Object.assign(fields.mediaType, { value: media.kind === 'carousel' ? 'carousel' : media.items[0].type, status: 'available', source: 'browser_dom', reason: media.reason });
  for (const key of ['imageUrls', 'videoUrl', 'thumbnailUrl'] as const) {
    const urls = Array.isArray(fields[key].value) ? fields[key].value : fields[key].value ? [fields[key].value] : [];
    const matching = media.items.filter(item => item.url && urls.includes(item.url));
    if (urls.length && matching.length && urls.every(url => matching.some(item => item.url === url && item.assetAccess === 'verified_accessible'))) fields[key].assetAccess = 'verified_accessible';
    else if (urls.length && matching.length && matching.every(item => item.assetAccess === 'unavailable')) fields[key].assetAccess = 'unavailable';
  }
}
