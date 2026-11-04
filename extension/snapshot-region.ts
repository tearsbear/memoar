import { parsePostUrl } from '../src/lib/inspection/parse-url';
import { postRoot, isPostMedia, visible } from './adapters/dom';
import { validateRegion, type SnapshotRegion } from '../src/lib/capture/snapshot';
import { mediaElements } from './media';

export type SnapshotCandidate = { region: SnapshotRegion; mediaIndex: number; mediaSource: string };
export function snapshotCandidate(document: Document, url: string): SnapshotCandidate | null {
  const parsed = parsePostUrl(url);
  const root = postRoot(document, parsed);
  const elements = [...document.querySelectorAll<HTMLImageElement | HTMLVideoElement>('img, video')];
  const allMedia = mediaElements(root, parsed);
  const videos = allMedia.filter(node => node.tagName === 'VIDEO');
  const media = videos.length ? videos : allMedia;
  if (media.length !== 1) return null;
  const node = media[0];
  const view = document.defaultView!;
  const box = node.getBoundingClientRect();
  const x = Math.max(0, box.left), y = Math.max(0, box.top);
  const region = validateRegion({ x, y, width: Math.min(view.innerWidth, box.right) - x, height: Math.min(view.innerHeight, box.bottom) - y,
    viewportWidth: view.innerWidth, viewportHeight: view.innerHeight, scrollX: view.scrollX, scrollY: view.scrollY });
  const mediaSource = node.currentSrc || node.getAttribute('src') || '';
  if (!mediaSource || mediaSource.length > 4096) return null;
  // Reject overlays before capturing pixels; controls inside the media wrapper are allowed.
  if (typeof document.elementsFromPoint === 'function') {
    let parent = node.parentElement;
    for (let next = parent?.parentElement, depth = 0; next && depth < 8; next = next.parentElement, depth++) {
      const bounds = next.getBoundingClientRect();
      if ([bounds.left - box.left, bounds.top - box.top, bounds.width - box.width, bounds.height - box.height].some(delta => Math.abs(delta) > 2)) break;
      parent = next;
    }
    for (const [px, py] of [[0.2, 0.2], [0.8, 0.2], [0.5, 0.5], [0.2, 0.8], [0.8, 0.8]]) {
      const top = document.elementsFromPoint(x + region.width * px, y + region.height * py)[0];
      if (!top || !parent?.contains(top)) return null;
    }
  }
  return { region, mediaIndex: elements.indexOf(node), mediaSource };
}
