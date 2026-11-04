import type { ParsedPostUrl, Platform } from './types';

export class UrlValidationError extends Error {
  constructor(public readonly code: 'invalid_url' | 'unsupported_host' | 'unsupported_path', message: string) {
    super(message);
    this.name = 'UrlValidationError';
  }
}

const hosts: Record<string, Platform> = {
  'instagram.com': 'instagram',
  'www.instagram.com': 'instagram',
  'threads.com': 'threads',
  'www.threads.com': 'threads',
  'threads.net': 'threads',
  'www.threads.net': 'threads',
  'facebook.com': 'facebook',
  'www.facebook.com': 'facebook',
  'm.facebook.com': 'facebook',
};

const tracking = /^(utm_.+|igsh|igshid|fbclid|mibextid|ref|refsrc|__tn__|__cft__|hl|locale)$/i;
const secret = /token|password|authorization|signature|secret|api[_-]?key|cookie/i;

export function parsePostUrl(input: unknown): ParsedPostUrl {
  if (typeof input !== 'string' || input.trim().length === 0 || input.length > 2048) {
    throw new UrlValidationError('invalid_url', 'Paste one post URL, up to 2,048 characters.');
  }
  const inputUrl = input.trim();
  let url: URL;
  try { url = new URL(inputUrl); }
  catch { throw new UrlValidationError('invalid_url', 'Enter a complete HTTPS post URL.'); }

  if (url.protocol !== 'https:' || url.username || url.password || url.port || /[\\\s\u0000-\u001f]/u.test(inputUrl)) {
    throw new UrlValidationError('invalid_url', 'Use HTTPS without credentials, backslashes, spaces, or a custom port.');
  }
  const platform = Object.hasOwn(hosts, url.hostname) ? hosts[url.hostname] : undefined;
  if (!platform) {
    throw new UrlValidationError('unsupported_host', 'Use an Instagram, Threads, or Facebook post URL.');
  }
  for (const key of url.searchParams.keys()) {
    if (secret.test(key)) throw new UrlValidationError('invalid_url', 'Remove credentials or secret parameters from the URL.');
  }

  let path = url.pathname;
  let postId: string | undefined;
  let route: ParsedPostUrl['route'] = 'post';
  let previewSupported = true;
  if (platform === 'instagram') {
    const match = /^\/(?:([A-Za-z0-9_.]+)\/)?(p|reels?)\/([A-Za-z0-9_-]+)\/?$/.exec(path);
    postId = match?.[3];
    if (match) path = `/${match[1] ? `${match[1]}/` : ''}${match[2] === 'reels' ? 'reel' : match[2]}/${match[3]}/`;
  } else if (platform === 'threads') {
    const match = /^\/(?:@[A-Za-z0-9_.]+\/post|t)\/([A-Za-z0-9_-]+)\/?$/.exec(path);
    postId = match?.[1];
  } else {
    const post = /^\/[A-Za-z0-9_.-]+\/posts\/([A-Za-z0-9_-]+)\/?$/.exec(path);
    const reel = /^\/reel\/(\d+)\/?$/.exec(path);
    const video = /^\/[A-Za-z0-9_.-]+\/videos\/(\d+)\/?$/.exec(path);
    if (post) postId = post[1];
    else if (reel || video) {
      postId = (reel || video)![1];
      route = 'video';
      previewSupported = Boolean(reel);
    } else if (/^\/watch\/?$/.test(path)) {
      const values = url.searchParams.getAll('v');
      if (values.length === 1 && /^\d+$/.test(values[0])) postId = values[0];
      route = 'video';
      previewSupported = false;
    }
  }
  if (!postId) {
    throw new UrlValidationError('unsupported_path', 'This link pattern is not supported. Use a direct post, Reel, or supported video link.');
  }

  for (const key of [...url.searchParams.keys()]) {
    if (tracking.test(key)) url.searchParams.delete(key);
  }
  url.hash = '';
  url.hostname = platform === 'threads' ? 'www.threads.com' : `www.${platform}.com`;
  url.pathname = path.endsWith('/') ? path : `${path}/`;
  url.searchParams.sort();
  return { platform, inputUrl, normalizedUrl: url.toString(), postId, route, previewSupported };
}
