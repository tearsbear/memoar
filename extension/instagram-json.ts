import { isRecord } from '../src/lib/capture/protocol';
import { validateMediaReference } from '../src/lib/capture/normalize';
import type { MediaCapture, MediaItem, ParsedPostUrl } from '../src/lib/inspection/types';

function dimension(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) > 0 && Number(value) <= 50000 ? Number(value) : null;
}

function versions(value: unknown): { url: string; width: number | null; height: number | null }[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).flatMap(candidate => {
    if (!isRecord(candidate)) return [];
    try {
      const url = validateMediaReference(candidate.url, 'instagram');
      if (!url.startsWith('https:')) return [];
      return [{ url, width: dimension(candidate.width), height: dimension(candidate.height) }];
    } catch { return []; }
  }).sort((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0));
}

function resolvedMedia(node: Record<string, unknown>): MediaCapture | null {
  const carousel = Array.isArray(node.carousel_media);
  const slides = carousel ? node.carousel_media as unknown[] : [node];
  if (!slides.length || slides.length > 20 || carousel && node.carousel_media_count !== undefined && node.carousel_media_count !== slides.length) return null;
  const items: MediaItem[] = [];
  for (const [index, slide] of slides.entries()) {
    if (!isRecord(slide)) return null;
    const type = slide.media_type === 1 ? 'image' : slide.media_type === 2 ? 'video'
      : Array.isArray(slide.video_versions) && slide.video_versions.length > 0 || typeof slide.video_dash_manifest === 'string' && slide.video_dash_manifest.length > 0 ? 'video'
      : isRecord(slide.image_versions2) ? 'image' : null;
    if (!type) return null;
    const image = versions(isRecord(slide.image_versions2) ? slide.image_versions2.candidates : null)[0];
    const video = versions(slide.video_versions)[0];
    const protectedStream = typeof slide.video_dash_manifest === 'string' && /(?:\w+:)?ContentProtection\b/i.test(slide.video_dash_manifest);
    const resource = type === 'image' ? image : protectedStream ? undefined : video;
    items.push({ position: index + 1, type, url: resource?.url ?? null, referenceUrl: null,
      posterUrl: type === 'video' ? image?.url ?? null : null, width: resource?.width ?? null, height: resource?.height ?? null,
      assetAccess: resource ? 'reference_only' : 'unavailable', processingEligibility: 'unverified',
      reason: protectedStream ? 'Embedded metadata declares content protection. No protected stream was retrieved.'
        : resource ? 'Temporary CDN reference from embedded JSON matched to this post shortcode. File bytes and processing permission are unverified.'
        : type === 'video' && slide.video_dash_manifest ? 'Only DASH metadata is available. Separate video/audio representations are not combined or treated as a complete MP4.'
        : 'Matched embedded slide exposes no supported media URL.' });
  }
  return { discovery: 'embedded_json', kind: carousel ? 'carousel' : 'single', totalSlides: slides.length, items, navigation: 'not_requested',
    completeness: items.every(item => item.url) ? 'complete' : 'partial',
    composition: items.some(item => item.type === 'video') && items.some(item => item.type === 'image') ? 'mixed' : items[0].type === 'video' ? 'video_only' : 'image_only',
    reason: 'Slide order and types come from embedded JSON for the exact active shortcode. File access is evaluated separately.' };
}

export function instagramJsonMedia(document: Document, parsed: ParsedPostUrl): MediaCapture | null {
  if (parsed.platform !== 'instagram') return null;
  let remaining = 12 * 1024 * 1024;
  let visited = 0;
  let found: MediaCapture | null = null;
  for (const script of document.querySelectorAll('script[data-sjs]')) {
    const text = script.textContent ?? '';
    remaining -= text.length;
    if (remaining < 0) return null;
    if (!text.includes(parsed.postId)) continue;
    let json: unknown;
    try { json = JSON.parse(text); } catch { continue; }
    const stack = [json];
    while (stack.length) {
      if (++visited > 100000) return null;
      const value = stack.pop();
      if (Array.isArray(value)) { for (const child of value) if (child && typeof child === 'object') stack.push(child); }
      else if (isRecord(value)) {
        if (value.code === parsed.postId) {
          const candidate = resolvedMedia(value);
          if (candidate) {
            if (found && JSON.stringify(found) !== JSON.stringify(candidate)) return null;
            found = candidate;
          }
          // Child slides have their own identities; only the matched parent owns their order.
          continue;
        }
        for (const child of Object.values(value)) if (child && typeof child === 'object') stack.push(child);
      }
    }
  }
  return found;
}
