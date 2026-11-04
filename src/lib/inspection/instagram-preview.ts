import { parsePostUrl } from './parse-url';
import type { PostInspection } from './types';

export function instagramPreviewUrl(inspection: PostInspection): string | null {
  if (inspection.platform !== 'instagram' || inspection.preview.reason?.includes('MEMOAR_EMBEDS_ENABLED=false')) return null;
  const parsed = parsePostUrl(inspection.normalizedUrl);
  const url = new URL(parsed.normalizedUrl);
  const match = /^\/(?:([A-Za-z0-9_.]+)\/)?(p|reel)\//.exec(url.pathname)!;
  if (match[2] !== 'reel' && inspection.fields.mediaType.value !== 'video') return null;
  let username: string | undefined = match[1];
  const author = inspection.fields.authorUrl;
  if (!username && author.source === 'browser_dom' && author.value) {
    try {
      const profile = new URL(author.value);
      if (profile.origin === url.origin && !profile.search && !profile.hash) username = /^\/([A-Za-z0-9_.]+)\/?$/.exec(profile.pathname)?.[1];
    } catch { /* The original permalink remains usable without a profile. */ }
  }
  const route = inspection.fields.mediaType.value === 'video' ? 'reel' : match[2];
  url.pathname = `/${username ? `${username}/` : ''}${route}/${parsed.postId}/embed/`;
  url.search = '';
  return url.href;
}
