import type { MediaCapture, MediaItem, ParsedPostUrl } from '../src/lib/inspection/types';
import { validateMediaReference } from '../src/lib/capture/normalize';
import { isPostMedia, visible } from './adapters/dom';

function reference(value: string, parsed: ParsedPostUrl): string | null {
  try { return value ? validateMediaReference(value, parsed.platform) : null; } catch { return null; }
}

export function mediaElements(root: Element, parsed: ParsedPostUrl): (HTMLImageElement | HTMLVideoElement)[] {
  const candidates = [...root.querySelectorAll<HTMLImageElement | HTMLVideoElement>('img, video')]
    .filter(node => {
      if (!visible(node) || !isPostMedia(node, root, parsed)) return false;
      const box = node.getBoundingClientRect();
      let left = Math.max(0, box.left), top = Math.max(0, box.top);
      let right = Math.min(root.ownerDocument.defaultView!.innerWidth, box.right), bottom = Math.min(root.ownerDocument.defaultView!.innerHeight, box.bottom);
      for (let parent = node.parentElement; parent && root.contains(parent); parent = parent.parentElement) {
        const style = root.ownerDocument.defaultView!.getComputedStyle(parent);
        if (/(hidden|clip|scroll|auto)/.test(`${style.overflow} ${style.overflowX} ${style.overflowY}`)) {
          const bounds = parent.getBoundingClientRect();
          left = Math.max(left, bounds.left); right = Math.min(right, bounds.right); top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom);
        }
        if (parent === root) break;
      }
      return Math.max(0, right - left) * Math.max(0, bottom - top) >= box.width * box.height * 0.5;
    });
  // A video poster/cover in the same player is not another carousel image.
  let media = candidates.filter(node => node.tagName === 'VIDEO' || !candidates.some(video => video.tagName === 'VIDEO'
    && video.parentElement !== root && video.parentElement?.contains(node)));
  const slideGroups = new Map<Element, (HTMLImageElement | HTMLVideoElement)[]>();
  for (const node of media) {
    const slot = node.closest('li, [role="listitem"]');
    if (slot) slideGroups.set(slot, [...slideGroups.get(slot) ?? [], node]);
  }
  for (const group of slideGroups.values()) {
    if (group.length < 2) continue;
    const videos = group.filter(node => node.tagName === 'VIDEO');
    if (videos.length > 1) return [];
    const best = videos[0] ?? [...group].sort((a, b) => (b as HTMLImageElement).naturalWidth - (a as HTMLImageElement).naturalWidth)[0];
    media = media.filter(node => !group.includes(node) || node === best);
  }
  if (media.length <= 1) return media;
  const slots = media.map(node => node.closest('li, [role="listitem"]'));
  if (slots.every(slot => slot && slot.parentElement === slots[0]?.parentElement)) return media;
  if (media.filter(node => node.tagName === 'VIDEO').length > 1) return [];
  const area = (node: Element) => { const box = node.getBoundingClientRect(); return box.width * box.height; };
  const largest = Math.max(...media.map(area));
  const dominant = media.filter(node => area(node) === largest);
  // Without slide boundaries, multiple equally plausible media regions are ambiguous.
  return dominant.length === 1 ? dominant : [];
}

export function carouselControl(root: Element, direction: 'next' | 'previous'): HTMLElement | null {
  const pattern = direction === 'next' ? /^(next|berikutnya)$/i : /^(previous|go back|sebelumnya|kembali)$/i;
  const matches = [...root.querySelectorAll<HTMLElement>('button, [role="button"]')].filter(node => visible(node)
    && !node.closest('header, aside, [role="comment"]') && pattern.test(node.getAttribute('aria-label') ?? '')
    && !node.hasAttribute('disabled') && node.getAttribute('aria-disabled') !== 'true');
  return matches.length === 1 ? matches[0] : null;
}

export function readMedia(root: Element, parsed: ParsedPostUrl, carousel: boolean): MediaCapture {
  const nodes = mediaElements(root, parsed);
  const list = nodes.map(node => node.closest('li, [role="listitem"]'));
  const carouselList = list[0]?.parentElement;
  const orderedList = carouselList && list.every(item => item?.parentElement === carouselList);
  const indicators = [...root.querySelectorAll('[aria-label]')].filter(visible).map(node => node.getAttribute('aria-label') ?? '');
  const counters = indicators.map(label => /^(?:slide\s+)?(\d+)\s*(?:of|\/|dari)\s*(\d+)$/i.exec(label)).filter(Boolean);
  const totals = [...new Set(counters.map(match => Number(match![2])))];
  const setSizes = [...new Set(list.map(item => Number(item?.getAttribute('aria-setsize'))).filter(value => value > 0))];
  const isCarousel = carousel || Boolean(orderedList && carouselList.children.length > 1);
  const totalSlides = isCarousel ? totals.length === 1 ? totals[0] : setSizes.length === 1 ? setSizes[0] : null : nodes.length === 1 ? 1 : null;
  const current = counters.length === 1 ? Number(counters[0]![1]) : null;
  const items = nodes.map((node): MediaItem => {
    const video = node.tagName === 'VIDEO';
    const slot = node.closest('li, [role="listitem"]');
    const explicit = Number(slot?.getAttribute('aria-posinset'));
    const position = !isCarousel ? 1 : explicit > 0 ? explicit : current && nodes.length === 1 ? current
      : orderedList && totalSlides === carouselList.children.length ? [...carouselList.children].indexOf(slot!) + 1 : null;
    let url: string | null;
    let referenceUrl: string | null = null;
    if (video) {
      const player = node as HTMLVideoElement;
      const sources = [player.currentSrc, player.getAttribute('src') ?? '', ...[...player.querySelectorAll('source')].map(source => source.getAttribute('src') ?? '')]
        .map(value => reference(value, parsed)).filter((value): value is string => Boolean(value));
      referenceUrl = sources.find(value => value.startsWith('blob:')) ?? null;
      url = sources.find(value => !value.startsWith('blob:')) ?? referenceUrl;
    } else {
      const image = node as HTMLImageElement;
      const sources = (image.getAttribute('srcset') ?? '').split(',').map(part => {
        const match = /^\s*(\S+)\s+(\d+(?:\.\d+)?)(w|x)\s*$/.exec(part);
        return match ? { url: reference(match[1], parsed), size: Number(match[2]), unit: match[3] } : null;
      }).filter((value): value is NonNullable<typeof value> => Boolean(value?.url));
      const unit = sources[0]?.unit;
      const best = sources.every(source => source.unit === unit) ? sources.sort((a, b) => b.size - a.size)[0]?.url : null;
      url = best ?? reference(image.currentSrc || image.getAttribute('src') || '', parsed);
    }
    return { position, type: video ? 'video' : 'image', url, referenceUrl,
      posterUrl: video ? reference(node.getAttribute('poster') ?? '', parsed) : null,
      width: !video && url === ((node as HTMLImageElement).currentSrc || node.getAttribute('src')) && (node as HTMLImageElement).naturalWidth || video && (node as HTMLVideoElement).videoWidth || null,
      height: !video && url === ((node as HTMLImageElement).currentSrc || node.getAttribute('src')) && (node as HTMLImageElement).naturalHeight || video && (node as HTMLVideoElement).videoHeight || null,
      assetAccess: url ? 'reference_only' : 'unavailable', processingEligibility: 'unverified',
      reason: url?.startsWith('blob:') ? 'Page-scoped blob player reference; not a reusable file or AI-consumable input.'
        : url ? 'Visible media element in the matched post. Independent resource access and MIME type have not been verified.' : 'The visible slide exposes no supported media URL.' };
  });
  const unique = items.filter((item, index) => !items.slice(0, index).some(other => other.url === item.url && other.type === item.type && other.position === item.position));
  const positions = unique.map(item => item.position);
  const complete = isCarousel ? totalSlides !== null && unique.length === totalSlides
    && new Set(positions).size === totalSlides && positions.every(position => position !== null && position >= 1 && position <= totalSlides)
    && unique.every(item => item.url) : unique.length === 1 && Boolean(unique[0].url);
  return { kind: isCarousel ? 'carousel' : 'single', totalSlides: isCarousel ? totalSlides : unique.length === 1 ? 1 : null,
    composition: !unique.length ? 'unknown' : unique.some(item => item.type === 'video') && unique.some(item => item.type === 'image') ? 'mixed'
      : !complete && isCarousel ? 'unknown' : unique[0].type === 'image' ? 'image_only' : 'video_only',
    completeness: complete ? 'complete' : 'partial', navigation: 'not_requested',
    reason: complete ? 'All identified slide positions were observed; resource accessibility is evaluated separately.'
      : 'Only visible, identified media was captured; total or remaining media are unknown until safely navigated.',
    items: unique.sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity)) };
}
