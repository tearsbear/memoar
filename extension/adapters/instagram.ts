import type { ParsedPostUrl } from '../../src/lib/inspection/types';
import { authoredCaption, authorLink, belongsToPost, observedText, postRoot, textObservation, visible, type DomObservation } from './dom';
import { instagramAudioControls, instagramPostContext } from './instagram-context';

function authorEntryCaption(root: Element, parsed: ParsedPostUrl, author: HTMLAnchorElement | null): string | null {
  if (!author) return null;
  const path = (link: Element) => {
    try { return new URL(link.getAttribute('href')!, parsed.normalizedUrl).pathname.replace(/\/reels\/?$/, '/').replace(/\/$/, ''); }
    catch { return null; }
  };
  const audio = instagramAudioControls(root, parsed);
  const candidates = new Set<Element>();
  for (const anchor of root.querySelectorAll('a[href]')) {
    if (!visible(anchor) || !belongsToPost(anchor, root) || path(anchor) !== path(author) || /^@/.test(anchor.textContent?.trim() ?? '')) continue;
    const item = anchor.closest('li, [role="listitem"]');
    if (item && item !== item.parentElement?.querySelector('li, [role="listitem"]')) continue;
    for (let entry = anchor.parentElement, depth = 0; entry && entry !== root && depth < 8; entry = entry.parentElement, depth++) {
      if (entry.closest('header, aside, [role="comment"]')) break;
      if (entry.querySelector('a[href*="/c/"], a[href*="/comments/"], textarea, input, [contenteditable="true"]')) break;
      if (!item && !entry.querySelector('time')) continue;
      for (const node of entry.querySelectorAll('h1, span, [dir="auto"], div, p')) {
        if (!visible(node) || !belongsToPost(node, root) || node.closest('a, time, header, button') || audio.some(control => control.contains(node))) continue;
        if (/^(?:edited|diedit|see translation|lihat terjemahan|more|selengkapnya)[\s·•.]*$/i.test(node.textContent?.trim() ?? '')) continue;
        const time = entry.querySelector('time');
        if (time && !(time.compareDocumentPosition(node) & 4)) continue;
        if (node.querySelector('time, img, video, input, textarea')) continue;
        const links = [...node.querySelectorAll('a[href]')];
        if (links.some(link => !/^[@#]|^https?:\/\//.test(link.textContent?.trim() ?? '') && path(link) === path(author))) continue;
        if (!item && links.some(link => !/^[@#]|^https?:\/\//.test(link.textContent?.trim() ?? ''))) continue;
        if (observedText(node, true, true)) candidates.add(node);
      }
      if (entry === item) break;
    }
  }
  const outer = [...candidates].filter(node => ![...candidates].some(other => other !== node && other.contains(node)));
  return outer.length === 1 ? observedText(outer[0], true, true) : null;
}

export function instagram(document: Document, parsed: ParsedPostUrl): DomObservation {
  const root = postRoot(document, parsed);
  const carousel = [...root.querySelectorAll('button, [role="button"]')].some(node => visible(node)
    && /^(next|previous|go back|slide \d+|berikutnya|sebelumnya|kembali)$/i.test(node.getAttribute('aria-label') ?? ''));
  const author = authorLink(root, parsed);
  let text = textObservation(root, 'h1');
  if (!text.text && author) {
    const headings = [...root.querySelectorAll('h1')].filter(node => visible(node) && !node.closest('[role="comment"], aside'));
    if (headings.length === 1) {
      const item = headings[0].closest('li');
      const firstItem = item?.parentElement?.querySelector(':scope > li');
      const authorPath = new URL(author.getAttribute('href')!, parsed.normalizedUrl).pathname;
      const authored = item && [...item.querySelectorAll('a[href]')].some(link => visible(link)
        && new URL(link.getAttribute('href')!, parsed.normalizedUrl).pathname === authorPath);
      if (item && item === firstItem && authored) text = { text: observedText(headings[0], true), textReason: 'Observed caption heading in the first author-associated entry. Completeness is unverified; no expansion was performed.' };
    }
  }
  if (!text.text) {
    const caption = authorEntryCaption(root, parsed, author);
    if (caption) text = { text: caption, textReason: 'Visible caption in the first author-associated entry, preserving mentions and block formatting. Completeness is unverified; no expansion was performed.' };
  }
  if (!text.text) {
    const audio = instagramAudioControls(root, parsed);
    const captions = [...root.querySelectorAll('[dir="auto"]')].filter(node => instagramPostContext(node, root, parsed)
      && !node.closest('a, header') && !audio.some(control => control.contains(node))
      && !node.querySelector('video, time, input, textarea')
      && [...node.querySelectorAll('a')].every(link => /^[@#]|^https?:\/\//.test(link.textContent?.trim() ?? ''))
      && Boolean(observedText(node, true)));
    const outer = captions.filter(node => !captions.some(other => other !== node && other.contains(node)));
    if (outer.length === 1) text = { text: observedText(outer[0], true), textReason: 'Visible caption in the scoped post. Completeness is unverified; no expansion was performed.' };
  }
  if (!text.text) {
    const fallback = authoredCaption(root, parsed, author);
    if (!instagramAudioControls(root, parsed).some(control => observedText(control, true) === fallback.text)) text = fallback;
  }
  return { root, author, ...text, carousel };
}
