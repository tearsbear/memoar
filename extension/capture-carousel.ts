import { parsePostUrl } from '../src/lib/inspection/parse-url';
import { normalizeCapture, type CaptureEnvelope } from '../src/lib/capture/normalize';
import type { MediaItem } from '../src/lib/inspection/types';
import { postRoot, samePost } from './adapters/dom';
import { carouselControl, readMedia } from './media';
import { captureWithRetry } from './capture-post';
import { verifyMedia } from './verify-media';

export async function captureCarousel(document: Document, url: string, allSlides: boolean, dependencies: {
  sleep?: (ms: number) => Promise<void>;
  getUrl?: () => string;
  capture?: typeof captureWithRetry;
  verify?: typeof verifyMedia;
  onVerified?: (itemIndex: number, bytes: Uint8Array<ArrayBuffer>, mimeType: string) => void;
} = {}): Promise<CaptureEnvelope> {
  const parsed = parsePostUrl(url);
  const sleep = dependencies.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const getUrl = dependencies.getUrl ?? (() => document.location.href);
  const initial = await (dependencies.capture ?? captureWithRetry)(document, url);
  if (!initial.inspection.media) return initial;
  let media = initial.inspection.media;
  const byPosition = new Map<number, MediaItem>();
  let interrupted = false;
  const stop = (event: Event) => { if (event.isTrusted) interrupted = true; };
  const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
  events.forEach(event => document.addEventListener(event, stop, true));
  const deadline = Date.now() + 30000;
  const guard = () => {
    if (!samePost(getUrl(), parsed)) throw new Error('The tab navigated to another post. Capture discarded.');
    if (interrupted || document.visibilityState === 'hidden' || Date.now() >= deadline) throw new Error('Carousel navigation stopped after interaction, tab hiding, or time limit.');
  };
  const read = () => {
    guard();
    const root = postRoot(document, parsed);
    const next = readMedia(root, parsed, true);
    for (const item of next.items) if (item.position !== null) byPosition.set(item.position, item);
    return { root, media: next };
  };
  try {
    if (allSlides && parsed.platform === 'instagram' && media.discovery !== 'embedded_json' && media.kind === 'carousel' && media.completeness !== 'complete') {
      media.navigation = 'stopped';
      let current = read();
      const position = () => current.media.items.length === 1 ? current.media.items[0].position : null;
      const move = async (direction: 'next' | 'previous') => {
        guard();
        const before = position();
        if (current.media.items.length !== 1) throw new Error('Active slide media is ambiguous.');
        const signature = JSON.stringify(current.media.items.map(item => [item.type, item.url]));
        const button = carouselControl(current.root, direction);
        if (!button) throw new Error('No unique safe carousel control was found.');
        button.click();
        for (let attempt = 0; attempt < 6; attempt++) {
          await sleep(200); current = read();
          const after = position();
          const advanced = before !== null && after !== null ? after === before + (direction === 'next' ? 1 : -1)
            : JSON.stringify(current.media.items.map(item => [item.type, item.url])) !== signature;
          if (current.media.items.length === 1 && advanced && current.media.items.every(item => item.url)) return;
        }
        throw new Error('The slide did not load or advance to the expected position.');
      };
      let total = current.media.totalSlides;
      if (total !== null && total > 20) throw new Error('Carousel exceeds the 20-slide navigation limit.');
      if (current.media.items.length !== 1) throw new Error('The active media region is ambiguous.');
      if (total !== null && position() !== null) {
        while (position()! > 1) await move('previous');
        while (position()! < total) await move('next');
      } else {
        let steps = 0;
        if (!carouselControl(current.root, 'previous') && !carouselControl(current.root, 'next')) throw new Error('No safe carousel navigation controls were found.');
        while (carouselControl(current.root, 'previous')) {
          if (++steps >= 20) throw new Error('Could not find the first slide within the navigation limit.');
          await move('previous');
        }
        byPosition.clear();
        let index = 1;
        const collect = () => byPosition.set(index, { ...current.media.items[0], position: index });
        collect();
        while (carouselControl(current.root, 'next')) {
          if (index >= 20) throw new Error('Stopped at the 20-slide navigation limit; remaining slides are unknown.');
          await move('next'); index++; collect();
        }
        total = index;
      }
      media.items = [...byPosition.values()].sort((a, b) => a.position! - b.position!);
      media.totalSlides = total;
      media.completeness = media.items.length === total && media.items.every(item => item.url) ? 'complete' : 'partial';
      media.navigation = 'completed';
      media.reason = media.completeness === 'complete' ? 'Visited every slide through visible carousel controls, from the first identified slide to the last observed endpoint.' : 'Some slide positions or media resources were not observed.';
    }
  } catch (error) {
    if (!samePost(getUrl(), parsed)) throw new Error('The tab navigated to another post. Capture discarded.');
    if (byPosition.size) media.items = [...byPosition.values()].sort((a, b) => a.position! - b.position!);
    media.completeness = 'partial'; media.navigation = 'stopped';
    media.reason = error instanceof Error ? error.message : 'Safe carousel navigation stopped.';
  } finally { events.forEach(event => document.removeEventListener(event, stop, true)); }
  if (!samePost(getUrl(), parsed)) throw new Error('The tab navigated to another post. Capture discarded.');
  media = await (dependencies.verify ?? verifyMedia)(media, { onVerified: dependencies.onVerified });
  if (!samePost(getUrl(), parsed)) throw new Error('The tab navigated during media verification. Capture discarded.');
  const warnings = initial.inspection.warnings.filter(warning => !warning.startsWith('Carousel capture is partial.'));
  if (media.completeness !== 'complete') warnings.push('Carousel/media capture is incomplete. See media.reason and the observed slide positions.');
  return normalizeCapture({ ...initial, inspection: { ...initial.inspection, media, warnings } });
}
