import { parsePostUrl } from '../../src/lib/inspection/parse-url';
import type { MediaCapture, MediaItem, ParsedPostUrl } from '../../src/lib/inspection/types';
import { validateMediaReference } from '../../src/lib/capture/normalize';
import { authorLink, belongsToPost, observedText, postRoot, samePost, visible, type DomObservation } from './dom';
import { threadsJsonPost, type ThreadsMetadata } from '../threads-json';

const boundaries = 'article, [role="article"], [data-pressable-container="true"]';
const excluded = 'blockquote, [data-testid="quoted-post"], [data-testid="quote-post"], aside, nav, [role="comment"], [role="complementary"], form, [contenteditable="true"]';

function otherPost(link: Element, parsed: ParsedPostUrl): boolean {
  try {
    const target = parsePostUrl(new URL(link.getAttribute('href')!, parsed.normalizedUrl).href);
    return target.platform === 'threads' && target.postId !== parsed.postId;
  } catch { return false; }
}

function inPostContext(node: Element, root: Element, parsed: ParsedPostUrl): boolean {
  if (!belongsToPost(node, root) || node.closest(excluded)) return false;
  for (let parent = node.parentElement; parent && parent !== root; parent = parent.parentElement) {
    const links = [...parent.querySelectorAll('a[href]')];
    if (links.some(link => otherPost(link, parsed)) && !links.some(link => samePost(link.getAttribute('href')!, parsed))) return false;
  }
  return true;
}

export function threadsPostContext(node: Element, root: Element, parsed: ParsedPostUrl): boolean {
  return visible(node) && inPostContext(node, root, parsed);
}

function renderedMedia(node: Element): boolean {
  if (visible(node)) return true;
  if (!node.matches('img[aria-hidden="true"]') || node.closest('[hidden], script, style, template')
    || node.parentElement?.closest('[aria-hidden="true"]')) return false;
  const view = node.ownerDocument.defaultView;
  if (!view) return false;
  for (let element: Element | null = node; element; element = element.parentElement) {
    const style = view.getComputedStyle(element);
    if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || style.opacity === '0') return false;
  }
  const box = node.getBoundingClientRect();
  return node.getClientRects().length > 0 && box.bottom > 0 && box.right > 0 && box.top < view.innerHeight && box.left < view.innerWidth;
}

function threadsRoot(document: Document, parsed: ParsedPostUrl): Element {
  const dialogs = [...document.querySelectorAll('[role="dialog"], dialog[open]')].filter(visible);
  if (dialogs.length > 1) throw new Error('Multiple visible dialogs prevent safe post capture.');
  const scope = dialogs[0] ?? document.documentElement;
  const roots = [...scope.querySelectorAll(boundaries)].filter(root => visible(root) && !root.closest(excluded)
    && [...root.querySelectorAll('a[href]')].some(link => visible(link) && belongsToPost(link, root)
      && !link.closest(excluded) && samePost(link.getAttribute('href')!, parsed))
    && ![...root.querySelectorAll('a[href]')].some(link => visible(link) && belongsToPost(link, root) && !link.closest(excluded) && otherPost(link, parsed)));
  const unique = roots.filter(root => !roots.some(other => other !== root && root.contains(other)));
  if (unique.length > 1) throw new Error('More than one visible post matches this permalink. Open the post on its own.');
  const root = unique[0] ?? postRoot(document, parsed);
  if (root.closest(excluded)) throw new Error('The matching Threads post is inside an excluded context.');
  // A matching quote inside another post is not the active post container.
  for (let parent = root.parentElement; parent && parent !== scope; parent = parent.parentElement) {
    if (parent.matches(boundaries) && [...parent.querySelectorAll('a[href]')].some(link => belongsToPost(link, parent) && otherPost(link, parsed))) {
      throw new Error('The matching Threads permalink belongs to a nested post context.');
    }
  }
  return root;
}

function caption(root: Element, parsed: ParsedPostUrl): string | null {
  const safe = (node: Element) => threadsPostContext(node, root, parsed) && !node.closest('a, button, [role="button"], time, header')
    && !node.querySelector('time, img, video, input, textarea, button, [role="button"]')
    && [...node.querySelectorAll('*')].every(child => !visible(child) || threadsPostContext(child, root, parsed))
    && [...node.querySelectorAll('a')].every(link => /^[@#]|^https?:\/\//.test(link.textContent?.trim() ?? ''));
  for (const selector of ['[data-ad-preview="message"], [data-testid="post-text"], [data-testid="post-content"]', '[dir="auto"], p, span']) {
    const candidates = [...root.querySelectorAll(selector)].filter(node => safe(node) && Boolean(observedText(node, false, true)));
    const outer = candidates.filter(node => !candidates.some(other => other !== node && other.contains(node)));
    if (outer.length === 1) return observedText(outer[0], false, true);
  }
  return null;
}

function reference(value: string): string | null {
  try { return value ? validateMediaReference(value, 'threads') : null; } catch { return null; }
}

function imageReference(image: HTMLImageElement): string | null {
  const variants = (image.getAttribute('srcset') ?? '').split(',').flatMap(part => {
    const match = /^\s*(\S+)\s+(\d+(?:\.\d+)?)(w|x)\s*$/.exec(part);
    const url = match && reference(match[1]);
    return match && url && !url.startsWith('blob:') ? [{ url, size: Number(match[2]), unit: match[3] }] : [];
  });
  const best = variants.every(variant => variant.unit === variants[0]?.unit) ? variants.sort((a, b) => b.size - a.size)[0]?.url : null;
  return best ?? reference(image.currentSrc) ?? reference(image.getAttribute('src') ?? '');
}

function visibleMedia(root: Element, parsed: ParsedPostUrl): { media: MediaCapture; elements: (HTMLImageElement | HTMLVideoElement)[] } {
  const candidates = [...root.querySelectorAll<HTMLImageElement | HTMLVideoElement>('img, video')].filter(node => {
    if (!renderedMedia(node) || !inPostContext(node, root, parsed) || node.closest('header, h1')
      || /profile|avatar|foto profil|ikon|icon/i.test(node.getAttribute('alt') ?? '')) return false;
    const link = node.closest('a[href]');
    if (link && !samePost(link.getAttribute('href')!, parsed)) return false;
    const box = node.getBoundingClientRect();
    if (box.width < 96 || box.height < 96) return false;
    let left = Math.max(0, box.left), top = Math.max(0, box.top);
    let right = Math.min(root.ownerDocument.defaultView!.innerWidth, box.right), bottom = Math.min(root.ownerDocument.defaultView!.innerHeight, box.bottom);
    for (let parent = node.parentElement; parent && root.contains(parent); parent = parent.parentElement) {
      if (parent !== root && parent.querySelectorAll('img, video').length === 1
        && !parent.querySelector('[dir="auto"], [data-testid="post-text"], p, time')
        && [...parent.querySelectorAll('a[href]')].some(anchor => {
          try { return /^\/@[A-Za-z0-9_.]+\/?$/.test(new URL(anchor.getAttribute('href')!, parsed.normalizedUrl).pathname); }
          catch { return false; }
        })) return false;
      const style = root.ownerDocument.defaultView!.getComputedStyle(parent);
      if (/(hidden|clip|scroll|auto)/.test(`${style.overflow} ${style.overflowX} ${style.overflowY}`)) {
        const bounds = parent.getBoundingClientRect();
        left = Math.max(left, bounds.left); right = Math.min(right, bounds.right); top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom);
      }
      if (parent === root) break;
    }
    return Math.max(0, right - left) * Math.max(0, bottom - top) >= box.width * box.height * 0.5;
  });
  const posters = new Map<HTMLVideoElement, HTMLImageElement>();
  for (const player of candidates.filter((node): node is HTMLVideoElement => node.tagName === 'VIDEO')) {
    const playerBox = player.getBoundingClientRect();
    for (let wrapper = player.parentElement; wrapper && wrapper !== root; wrapper = wrapper.parentElement) {
      if (wrapper.querySelectorAll('video').length !== 1) break;
      const covers = candidates.filter((node): node is HTMLImageElement => {
        if (node.tagName !== 'IMG' || !wrapper.contains(node) || !imageReference(node as HTMLImageElement)) return false;
        const box = node.getBoundingClientRect();
        const overlap = Math.max(0, Math.min(box.right, playerBox.right) - Math.max(box.left, playerBox.left))
          * Math.max(0, Math.min(box.bottom, playerBox.bottom) - Math.max(box.top, playerBox.top));
        return overlap >= box.width * box.height * 0.8 && overlap >= playerBox.width * playerBox.height * 0.8;
      });
      if (covers.length) {
        if (covers.length === 1) posters.set(player, covers[0]);
        break;
      }
    }
  }
  const covers = new Set(posters.values());
  const elements = candidates.filter(node => node.tagName === 'VIDEO' || !covers.has(node as HTMLImageElement)
    && (node.getAttribute('aria-hidden') !== 'true' || Boolean(node.closest('picture'))));
  const counters = [...root.querySelectorAll('[aria-label]')].filter(node => threadsPostContext(node, root, parsed))
    .map(node => /^(?:slide\s+)?(\d+)\s*(?:of|\/|dari)\s*(\d+)$/i.exec(node.getAttribute('aria-label') ?? ''))
    .filter((match): match is RegExpExecArray => match !== null && Number(match[1]) > 0 && Number(match[1]) <= Number(match[2]) && Number(match[2]) <= 1000);
  const sizes = [...new Set([...counters.map(match => Number(match[2])), ...elements.map(node => Number(node.closest('[aria-setsize]')?.getAttribute('aria-setsize')))].filter(size => size > 0 && size <= 1000))];
  const controls = [...root.querySelectorAll('button, [role="button"]')].some(node => threadsPostContext(node, root, parsed)
    && /^(next|previous|berikutnya|sebelumnya|slide \d+)$/i.test(node.getAttribute('aria-label') ?? ''));
  const carousel = elements.length > 1 || controls || sizes.some(size => size > 1);
  const totalSlides = carousel ? sizes.length === 1 ? sizes[0] : null : elements.length === 1 ? 1 : null;
  const items = elements.slice(0, 20).map((node): MediaItem => {
    const video = node.tagName === 'VIDEO';
    const explicit = Number(node.closest('[aria-posinset]')?.getAttribute('aria-posinset'));
    const position = explicit > 0 && explicit <= 1000 ? explicit : counters.length === 1 && elements.length === 1 ? Number(counters[0][1]) : carousel ? null : 1;
    const player = node as HTMLVideoElement;
    const sources = video ? [player.currentSrc, player.getAttribute('src') ?? '', ...[...player.querySelectorAll('source')].map(source => source.getAttribute('src') ?? '')].map(reference).filter((url): url is string => Boolean(url)) : [];
    const referenceUrl = sources.find(url => url.startsWith('blob:')) ?? null;
    const url = video ? sources.find(url => !url.startsWith('blob:')) ?? referenceUrl : imageReference(node as HTMLImageElement);
    const cover = posters.get(player);
    return { position, type: video ? 'video' : 'image', url, referenceUrl,
      posterUrl: video ? reference(player.getAttribute('poster') ?? '') ?? (cover ? imageReference(cover) : null) : null,
      width: null, height: null, assetAccess: url ? 'reference_only' : 'unavailable', processingEligibility: 'unverified',
      reason: 'Scoped visible Threads media reference. Variants belong to one image; bytes, absolute slide positions and remaining media are unverified unless explicitly identified.' };
  });
  const positions = items.map(item => item.position);
  const complete = totalSlides !== null && items.length === totalSlides && new Set(positions).size === totalSlides
    && positions.every(position => position !== null && position >= 1 && position <= totalSlides) && items.every(item => item.url);
  return { elements, media: { kind: carousel ? 'carousel' : 'single', totalSlides, items, navigation: 'not_requested', completeness: complete ? 'complete' : 'partial',
    composition: complete ? items.some(item => item.type === 'video') ? items.some(item => item.type === 'image') ? 'mixed' : 'video_only' : 'image_only' : 'unknown',
    reason: 'Threads DOM fallback preserves rendered media order. Unobserved slides and unknown absolute positions remain explicit; no slides were advanced.' } };
}

export function threads(document: Document, parsed: ParsedPostUrl): DomObservation & { metadata: ThreadsMetadata; media: MediaCapture; elements: (HTMLImageElement | HTMLVideoElement)[] } {
  const root = threadsRoot(document, parsed);
  const metadata = threadsJsonPost(document, parsed);
  const link = authorLink(root, parsed);
  const author = link && !link.closest('blockquote, [data-testid="quoted-post"], [data-testid="quote-post"]') && belongsToPost(link, root) ? link : null;
  const text = metadata.text ?? caption(root, parsed);
  const fallback = visibleMedia(root, parsed);
  const media = metadata.media ?? fallback.media;
  if (metadata.media) for (const item of media.items) {
    if (item.reason.includes('content protection')) continue;
    const match = fallback.media.items.find(candidate => candidate.type === item.type && candidate.position === item.position
      && (media.kind === 'single' && fallback.media.kind === 'single' || media.kind === 'carousel' && fallback.media.kind === 'carousel' && media.totalSlides === fallback.media.totalSlides));
    if (match) {
      item.referenceUrl = match.referenceUrl;
      item.posterUrl ??= match.posterUrl;
      if (!item.url && match.url) { item.url = match.url; item.assetAccess = 'reference_only'; item.reason += ' A scoped DOM reference at the same identified position is retained for verification.'; }
    }
  }
  return { root, author, text, textReason: metadata.text !== null
    ? 'Text from already-loaded Threads JSON matched to the exact post identity; paragraph breaks and fragment order are preserved.'
    : text ? 'Scoped visible Threads post text, preserving mentions and block formatting. Completeness is unverified; no expansion was performed.'
      : 'Matched Threads post found, but caption is unavailable or cannot be separated safely from surrounding content.',
    carousel: media.kind === 'carousel', metadata, media, elements: fallback.elements };
}
