import type { ParsedPostUrl } from '../../src/lib/inspection/types';
import { belongsToPost, observedText, samePost, visible } from './dom';

export function instagramPostContext(node: Element, root: Element, parsed: ParsedPostUrl): boolean {
  if (!visible(node) || !belongsToPost(node, root) || node.closest('li, [role="listitem"]')) return false;
  for (let parent = node.parentElement; parent && parent !== root; parent = parent.parentElement) {
    const links = [...parent.querySelectorAll('a[href]')];
    if (links.some(link => /\/(?:c|comments)\//.test(link.getAttribute('href') ?? ''))
      && !links.some(link => samePost(link.getAttribute('href')!, parsed))) return false;
  }
  return true;
}

export function instagramAudioControls(root: Element, parsed: ParsedPostUrl): Element[] {
  const controls = new Set<Element>();
  for (const marker of root.querySelectorAll('svg[aria-label], svg title, [role="button"][aria-label], button[aria-label]')) {
    if (!/^(audio(?: track)?|music|musik|audio asli|original audio)$/i.test(marker.getAttribute('aria-label') ?? marker.textContent?.trim() ?? '')) continue;
    const control = marker.closest('a, button, [role="button"], [role="link"]') ?? marker.closest('svg')?.parentElement;
    if (control && instagramPostContext(control, root, parsed) && !control.querySelector('video, h1, time, textarea')) controls.add(control);
  }
  return [...controls].filter(control => Boolean(observedText(control, true)));
}
