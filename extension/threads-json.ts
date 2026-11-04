import { isRecord, MAX_TEXT_CHARS } from '../src/lib/capture/protocol';
import { validateMediaReference } from '../src/lib/capture/normalize';
import type { MediaCapture, MediaItem, ParsedPostUrl } from '../src/lib/inspection/types';
import { samePost } from './adapters/dom';

export type ThreadsMetadata = { username: string | null; text: string | null; media: MediaCapture | null; warnings: string[] };

function dimension(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) > 0 && Number(value) <= 50000 ? Number(value) : null;
}

function versions(value: unknown): { url: string; width: number | null; height: number | null }[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).flatMap(candidate => {
    if (!isRecord(candidate)) return [];
    try {
      const url = validateMediaReference(candidate.url, 'threads');
      return url.startsWith('https:') ? [{ url, width: dimension(candidate.width), height: dimension(candidate.height) }] : [];
    } catch { return []; }
  }).sort((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0));
}

function mediaType(node: Record<string, unknown>): MediaItem['type'] | null {
  if (node.media_type === 2 || Array.isArray(node.video_versions) && node.video_versions.length > 0
    || typeof node.video_dash_manifest === 'string' && node.video_dash_manifest.length > 0) return 'video';
  if (node.media_type === 1 || isRecord(node.image_versions2) && Array.isArray(node.image_versions2.candidates) && node.image_versions2.candidates.length > 0) return 'image';
  return null;
}

function resolvedMedia(node: Record<string, unknown>): MediaCapture | null {
  const carousel = Array.isArray(node.carousel_media) || node.media_type === 8;
  if (!carousel && !mediaType(node)) return null;
  const slides = carousel ? Array.isArray(node.carousel_media) ? node.carousel_media : [] : [node];
  const declared = node.carousel_media_count;
  const count = Number.isInteger(declared) && Number(declared) > 0 && Number(declared) <= 1000 ? Number(declared) : null;
  const totalSlides = !carousel ? 1 : declared === undefined ? slides.length > 0 && slides.length <= 1000 ? slides.length : null
    : count !== null && count >= slides.length ? count : null;
  const items: MediaItem[] = [];
  for (const [index, slide] of slides.slice(0, 20).entries()) {
    if (!isRecord(slide)) continue;
    const type = mediaType(slide);
    if (!type) continue;
    const image = versions(isRecord(slide.image_versions2) ? slide.image_versions2.candidates : null)[0];
    const video = versions(slide.video_versions)[0];
    const protectedStream = typeof slide.video_dash_manifest === 'string' && /(?:\w+:)?ContentProtection\b/i.test(slide.video_dash_manifest);
    const resource = type === 'image' ? image : protectedStream ? undefined : video;
    items.push({ position: index + 1, type, url: resource?.url ?? null, referenceUrl: null,
      posterUrl: type === 'video' ? image?.url ?? null : null, width: resource?.width ?? null, height: resource?.height ?? null,
      assetAccess: resource ? 'reference_only' : 'unavailable', processingEligibility: 'unverified',
      reason: protectedStream ? 'Threads metadata declares content protection. No protected stream was retrieved.'
        : resource ? 'Temporary CDN reference from already-loaded Threads JSON matched to the exact post. Bytes and processing permission are unverified.'
        : 'Matched Threads media exposes no supported image or complete MP4 URL. No missing resource was invented.' });
  }
  const complete = totalSlides !== null && items.length === totalSlides && items.every(item => item.url);
  return { discovery: 'embedded_json', kind: carousel ? 'carousel' : 'single', totalSlides, items,
    navigation: 'not_requested', completeness: complete ? 'complete' : 'partial',
    composition: !complete ? 'unknown' : items.some(item => item.type === 'image') && items.some(item => item.type === 'video') ? 'mixed'
      : items[0].type === 'video' ? 'video_only' : 'image_only',
    reason: complete ? 'Threads media order comes from the exact matched post metadata. File accessibility is evaluated separately.'
      : 'Matched Threads metadata is incomplete, inconsistent, unsupported, or exceeds the 20-item capture limit. Only identified items retain their original positions.' };
}

function postText(node: Record<string, unknown>): string | null {
  const caption = isRecord(node.caption) ? node.caption.text : null;
  if (typeof caption === 'string' && caption.trim() && caption.length <= MAX_TEXT_CHARS) return caption;
  const info = node.text_post_app_info;
  const fragments = isRecord(info) && isRecord(info.text_fragments) ? info.text_fragments.fragments : null;
  if (!Array.isArray(fragments) || !fragments.length || fragments.length > MAX_TEXT_CHARS
    || !fragments.every(fragment => isRecord(fragment) && typeof fragment.plaintext === 'string')) return null;
  const text = fragments.map(fragment => fragment.plaintext).join('');
  return text.trim() && text.length <= MAX_TEXT_CHARS ? text : null;
}

export function threadsJsonPost(document: Document, parsed: ParsedPostUrl): ThreadsMetadata {
  const empty = (reason?: string): ThreadsMetadata => ({ username: null, text: null, media: null, warnings: reason ? [reason] : [] });
  if (parsed.platform !== 'threads') return empty();
  let remaining = 12 * 1024 * 1024;
  let visited = 0;
  let found: ThreadsMetadata | null = null;
  for (const script of document.querySelectorAll('script[data-sjs]')) {
    const text = script.textContent ?? '';
    remaining -= text.length;
    if (remaining < 0) return empty('Threads embedded JSON exceeded the capture read limit. Only scoped DOM fallback is used.');
    let json: unknown;
    try { json = JSON.parse(text); } catch { continue; }
    const stack = [json];
    while (stack.length) {
      if (++visited > 100000) return empty('Threads embedded JSON exceeded the traversal limit. Only scoped DOM fallback is used.');
      const value = stack.pop();
      if (Array.isArray(value)) { for (const child of value) if (child && typeof child === 'object') stack.push(child); }
      else if (isRecord(value)) {
        const permalink = typeof value.permalink === 'string' ? value.permalink : null;
        const postData = isRecord(value.user) || isRecord(value.caption) || isRecord(value.text_post_app_info)
          || value.media_type !== undefined || isRecord(value.image_versions2) || Array.isArray(value.video_versions) || Array.isArray(value.carousel_media);
        if (postData && (value.code === parsed.postId || permalink && samePost(permalink, parsed))) {
          if (value.code !== undefined && value.code !== parsed.postId || permalink && !samePost(permalink, parsed)) {
            return empty('Threads metadata contains conflicting post identities. Only scoped DOM fallback is used.');
          }
          const username = isRecord(value.user) && typeof value.user.username === 'string' && /^[A-Za-z0-9_.]{1,64}$/.test(value.user.username) ? value.user.username : null;
          const hint = /^\/@([^/]+)\/post\//.exec(new URL(parsed.normalizedUrl).pathname)?.[1];
          if (username && hint && username.toLowerCase() !== hint.toLowerCase()) return empty('Threads metadata author conflicts with the active permalink. Only scoped DOM fallback is used.');
          const candidate: ThreadsMetadata = { username, text: postText(value), media: resolvedMedia(value), warnings: [] };
          if (found && JSON.stringify(found) !== JSON.stringify(candidate)) return empty('Conflicting Threads metadata matches the active post. Only scoped DOM fallback is used.');
          found = candidate;
          // Nested quotes and carousel children do not own the matched parent post.
          continue;
        }
        for (const child of Object.values(value)) if (child && typeof child === 'object') stack.push(child);
      }
    }
  }
  return found ?? empty('No unambiguous Threads metadata matched the active post. Only scoped DOM fallback is used.');
}
