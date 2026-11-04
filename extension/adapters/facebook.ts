import type { ParsedPostUrl } from '../../src/lib/inspection/types';
import { authorLink, postRoot, textObservation, type DomObservation } from './dom';

export function facebook(document: Document, parsed: ParsedPostUrl): DomObservation {
  const root = postRoot(document, parsed);
  return { root, author: authorLink(root, parsed), ...textObservation(root, '[data-ad-preview="message"]'), carousel: false };
}
