import sanitizeHtml from 'sanitize-html';
import type { ParsedPostUrl, Platform, PostInspection } from './types';

const endpoints = {
  instagram: 'https://graph.facebook.com/v25.0/instagram_oembed',
  threads: 'https://graph.threads.com/oembed',
  facebookPost: 'https://graph.facebook.com/v25.0/oembed_post',
  facebookVideo: 'https://graph.facebook.com/v25.0/oembed_video',
} as const;

const displayHosts: Record<Platform, Set<string>> = {
  instagram: new Set(['instagram.com', 'www.instagram.com']),
  threads: new Set(['threads.com', 'www.threads.com', 'threads.net', 'www.threads.net']),
  facebook: new Set(['facebook.com', 'www.facebook.com']),
};

function displayUrl(value: string, platform: Platform): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && displayHosts[platform].has(url.hostname);
  } catch { return false; }
}

export function sanitizeEmbed(html: string, platform: Platform): string {
  return sanitizeHtml(html, {
    allowedTags: ['blockquote', 'div', 'p', 'span', 'a', 'br', 'iframe'],
    allowedAttributes: {
      blockquote: ['class', 'data-instgrm-permalink', 'data-instgrm-version', 'data-text-post-permalink', 'data-text-post-version', 'data-text-post-theme'],
      div: ['class', 'data-href', 'data-width', 'data-show-text', 'data-allowfullscreen'],
      a: ['href', 'target', 'rel'],
      iframe: ['src', 'title', 'width', 'height', 'allowfullscreen', 'loading', 'referrerpolicy'],
    },
    allowedClasses: {
      blockquote: platform === 'instagram' ? ['instagram-media'] : platform === 'threads' ? ['text-post-media'] : [],
      div: platform === 'facebook' ? ['fb-post', 'fb-video'] : [],
    },
    allowedSchemes: ['https'],
    allowProtocolRelative: false,
    nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript'],
    transformTags: {
      '*': (tagName, attribs) => {
        for (const key of ['href', 'src', 'data-href', 'data-instgrm-permalink', 'data-text-post-permalink']) {
          if (attribs[key] && !displayUrl(attribs[key], platform)) delete attribs[key];
        }
        if (tagName === 'a') {
          attribs.target = '_blank';
          attribs.rel = 'noopener noreferrer';
        }
        if (tagName === 'iframe') {
          attribs.loading = 'lazy';
          attribs.referrerpolicy = 'no-referrer';
          attribs.title = 'Official post preview';
        }
        return { tagName, attribs };
      },
    },
    exclusiveFilter: frame => {
      if (frame.tag === 'blockquote' && frame.attribs.class === 'instagram-media') return !frame.attribs['data-instgrm-permalink'];
      if (frame.tag === 'blockquote' && frame.attribs.class === 'text-post-media') return !frame.attribs['data-text-post-permalink'];
      if (frame.tag === 'div' && /^fb-(post|video)$/.test(frame.attribs.class ?? '')) return !frame.attribs['data-href'];
      if (frame.tag !== 'iframe') return false;
      if (!frame.attribs.src || !/^https:\/\/www\.facebook\.com\/plugins\/(post|video)\.php(?:\?|$)/.test(frame.attribs.src)) return true;
      const href = new URL(frame.attribs.src).searchParams.get('href');
      return !href || !displayUrl(href, 'facebook');
    },
  }).trim();
}

export class RetrievalError extends Error {
  constructor(public readonly status: PostInspection['preview']['status'], message: string) { super(message); }
}

export type FetchTransport = (input: URL, init: RequestInit) => Promise<Response>;
const MAX_BYTES = 1024 * 1024;

export async function fetchEmbed(parsed: ParsedPostUrl, transport: FetchTransport = fetch): Promise<string> {
  const endpoint = parsed.platform === 'facebook'
    ? parsed.route === 'video' ? endpoints.facebookVideo : endpoints.facebookPost
    : endpoints[parsed.platform];
  const url = new URL(endpoint);
  url.searchParams.set('url', parsed.normalizedUrl);
  url.searchParams.set('omitscript', 'true');
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new RetrievalError('error', 'The official preview service timed out after 8 seconds.'));
    }, 8000);
  });

  const retrieve = async () => {
    const response = await transport(url, {
      method: 'GET', redirect: 'error', cache: 'no-store',
      signal: controller.signal, headers: { Accept: 'application/json' },
    });
    if (response.redirected || response.status >= 300 && response.status < 400) throw new RetrievalError('error', 'Provider redirects are not followed.');
    if (!response.ok) {
      const status = response.status === 401 || response.status === 403 ? 'permission_required' : response.status === 404 ? 'unavailable' : 'error';
      const reason = response.status === 429 ? 'The official preview service rate limited this request. No automatic retry was made.'
        : `The official preview service returned HTTP ${response.status}. The post visibility or deletion status is not known.`;
      await response.body?.cancel();
      throw new RetrievalError(status, reason);
    }
    if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) throw new RetrievalError('error', 'The preview service did not return JSON.');
    if (Number(response.headers.get('content-length')) > MAX_BYTES) {
      await response.body?.cancel();
      throw new RetrievalError('error', 'The preview response exceeded the 1 MiB limit.');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new RetrievalError('unavailable', 'The official preview response was empty.');
    const decoder = new TextDecoder();
    let size = 0;
    let body = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) {
          await reader.cancel();
          throw new RetrievalError('error', 'The preview response exceeded the 1 MiB limit.');
        }
        body += decoder.decode(value, { stream: true });
      }
      body += decoder.decode();
    } finally { reader.releaseLock(); }
    let data: unknown;
    try { data = JSON.parse(body); }
    catch { throw new RetrievalError('error', 'The official preview service returned invalid JSON.'); }
    if (!data || typeof data !== 'object' || !('html' in data) || typeof data.html !== 'string' || !data.html.trim()) {
      throw new RetrievalError('unavailable', 'No embed HTML was returned. The reason is not verified.');
    }
    const html = sanitizeEmbed(data.html, parsed.platform);
    const hasEmbed = parsed.platform === 'instagram' ? html.includes('class="instagram-media"')
      : parsed.platform === 'threads' ? html.includes('class="text-post-media"')
      : /class="fb-(post|video)"|<iframe/.test(html);
    if (!hasEmbed) throw new RetrievalError('unavailable', 'The response did not contain a supported, safe official embed.');
    return html;
  };
  try { return await Promise.race([retrieve(), timeout]); }
  catch (error) {
    if (error instanceof RetrievalError) throw error;
    throw new RetrievalError('error', 'The official preview request failed. Access and post visibility could not be verified.');
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
