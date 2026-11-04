import { parsePostUrl } from '../../src/lib/inspection/parse-url';
import type { ParsedPostUrl } from '../../src/lib/inspection/types';

export function visible(element: Element): boolean {
  if (element.closest('[hidden], [aria-hidden="true"], script, style, template')) return false;
  const view = element.ownerDocument.defaultView;
  if (!view) return false;
  const style = view.getComputedStyle(element);
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const inherited = view.getComputedStyle(parent);
    if (inherited.display === 'none' || inherited.opacity === '0' || inherited.visibility === 'hidden') return false;
  }
  const box = element.getBoundingClientRect();
  return style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse' && style.opacity !== '0'
    && element.getClientRects().length > 0 && box.bottom > 0 && box.right > 0 && box.top < view.innerHeight && box.left < view.innerWidth;
}

export function samePost(url: string, expected: ParsedPostUrl): boolean {
  try {
    const resolved = new URL(url, expected.normalizedUrl);
    if (expected.platform === 'instagram' && /^\/[A-Za-z0-9_.]+\/(p|reels?)\/[A-Za-z0-9_-]+\/?$/.test(resolved.pathname)) {
      resolved.pathname = resolved.pathname.replace(/^\/[^/]+/, '');
    }
    const parsed = parsePostUrl(resolved.href);
    return parsed.platform === expected.platform && parsed.postId === expected.postId;
  } catch { return false; }
}

const excludedContext = 'aside, nav, [role="navigation"], [role="complementary"], [role="comment"], [contenteditable="true"], form';
const postBoundary = 'article, [role="article"], [data-pressable-container="true"]';

function profileUrl(link: Element, expected: ParsedPostUrl): URL | null {
  try {
    const url = new URL(link.getAttribute('href')!, expected.normalizedUrl);
    if (url.origin !== new URL(expected.normalizedUrl).origin || url.username || url.password || url.hash) return null;
    if (expected.platform === 'instagram' && /^\/[A-Za-z0-9_.]+\/reels\/?$/.test(url.pathname)) url.pathname = url.pathname.replace(/reels\/?$/, '');
    const pattern = expected.platform === 'threads' ? /^\/@[A-Za-z0-9_.]+\/?$/ : /^\/[A-Za-z0-9_.]+\/?$/;
    if (!pattern.test(url.pathname) || /^\/(explore|accounts|direct|reels|reel|stories|search|activity|insights)\/?$/.test(url.pathname)) return null;
    return url;
  } catch { return null; }
}

function authorHint(root: Element, expected: ParsedPostUrl): string | null {
  if (expected.platform === 'threads') return /^\/@([^/]+)\/post\//.exec(new URL(expected.normalizedUrl).pathname)?.[1] ?? null;
  const hints = [...root.querySelectorAll('a[href]')].filter(link => samePost(link.getAttribute('href')!, expected))
    .map(link => /^\/([^/]+)\/(?:p|reels?)\//.exec(new URL(link.getAttribute('href')!, expected.normalizedUrl).pathname)?.[1])
    .filter((value): value is string => Boolean(value));
  const unique = [...new Set(hints)];
  return unique.length === 1 ? unique[0] : null;
}

export function belongsToPost(element: Element, root: Element): boolean {
  if (!root.contains(element) || element.closest(excludedContext)) return false;
  const boundary = element.closest(postBoundary);
  return !boundary || boundary === root || !root.contains(boundary);
}

export function isPostMedia(element: Element, root: Element, expected: ParsedPostUrl): boolean {
  if (!belongsToPost(element, root) || element.closest('header, h1, [dir="auto"]') || /profile|avatar|foto profil|ikon|icon/i.test(element.getAttribute('alt') ?? '')) return false;
  const box = element.getBoundingClientRect();
  if (box.width < 96 || box.height < 96 || element.closest('[role="navigation"], [role="complementary"]')) return false;
  const link = element.closest('a[href]');
  if (link && !samePost(link.getAttribute('href')!, expected)) return false;
  const item = element.closest('li, [role="listitem"]');
  if (item?.querySelector('time, a[href*="/c/"], a[href*="/comments/"]')) return false;
  for (let parent = element.parentElement; parent && parent !== root; parent = parent.parentElement) {
    const profiles = [...parent.querySelectorAll('a[href]')].some(link => profileUrl(link, expected));
    if (profiles && !item && parent.querySelectorAll('img, video').length === 1 && !parent.querySelector('h1, [dir="auto"], time') && !postLinks(parent, expected).length) return false;
    if (parent.querySelector('a[href*="/c/"], a[href*="/comments/"]') && !postLinks(parent, expected, true).length) return false;
    if (parent.querySelector('textarea, input, [contenteditable="true"], [role="textbox"]')
      && !parent.querySelector('time') && !postLinks(parent, expected).length) return false;
  }
  return true;
}

function postLinks(root: Element, expected: ParsedPostUrl, contextOnly = false): HTMLAnchorElement[] {
  return [...root.querySelectorAll<HTMLAnchorElement>('a[href]')].filter(link => (visible(link) || contextOnly && link.getClientRects().length > 0 && !link.closest('[hidden], [aria-hidden="true"]')) && !link.closest(excludedContext)
    && samePost(link.getAttribute('href')!, expected));
}

function hasDifferentPost(root: Element, expected: ParsedPostUrl): boolean {
  return [...root.querySelectorAll('a[href]')].some(link => {
    if (!visible(link) || link.closest(excludedContext)) return false;
    try {
      const parsed = parsePostUrl(new URL(link.getAttribute('href')!, expected.normalizedUrl).href);
      return parsed.platform === expected.platform && parsed.postId !== expected.postId;
    } catch { return false; }
  });
}

export function postTextBlocks(root: Element): Element[] {
  const nodes = [...root.querySelectorAll('h1, span, [dir="auto"], [data-ad-preview="message"], [data-testid="post-text"], [data-testid="post-content"]')]
    .filter(node => visible(node) && belongsToPost(node, root) && (node.matches('h1') || !node.closest('a, button, [role="button"], time, header'))
      && !node.querySelector('button, [role="button"], time, input, textarea, [contenteditable="true"]')
      && [...node.querySelectorAll('a')].every(link => /^[@#]|^https?:\/\//.test(link.textContent?.trim() ?? '')) && Boolean(observedText(node)));
  return nodes.filter(node => !nodes.some(parent => parent !== node && parent.contains(node)));
}

export function postRoot(document: Document, expected: ParsedPostUrl): Element {
  const dialogs = [...document.querySelectorAll('[role="dialog"], dialog[open]')].filter(visible);
  if (dialogs.length > 1) throw new Error('Multiple visible dialogs prevent safe post capture.');
  const scope = dialogs[0] ?? document.documentElement;
  const candidates = [scope, ...scope.querySelectorAll(postBoundary)].filter(root => root.matches(postBoundary) && visible(root) && !root.closest(excludedContext));
  const matching = candidates.filter(root => postLinks(root, expected, true).length > 0 && !hasDifferentPost(root, expected));
  const unique = matching.filter(root => !matching.some(other => other !== root && root.contains(other)));
  if (unique.length === 1) return unique[0];
  if (unique.length > 1) throw new Error('More than one visible post matches this permalink. Open the post on its own.');

  const links = postLinks(scope, expected).filter(link => Boolean(link.querySelector('time'))
    || !/^(column title|thread)$/i.test(link.getAttribute('aria-label') ?? link.textContent?.trim() ?? ''));
  const resolved = new Set<Element>();
  for (const link of links) {
    let textOnly: Element | null = null;
    for (let root = link.parentElement, depth = 0; root && depth < 18; root = root.parentElement, depth++) {
      if (root === document.body || root.matches('main, [role="main"], nav, aside') || root.closest(excludedContext) || hasDifferentPost(root, expected)) break;
      if (!scope.contains(root)) break;
      const hasCaption = postTextBlocks(root).length > 0 || expected.platform === 'instagram'
        && [...root.querySelectorAll('h1, [dir="auto"]')].some(node => visible(node) && belongsToPost(node, root)
          && !node.closest('a, header') && Boolean(observedText(node, true)));
      if (!authorLink(root, expected) || !hasCaption) continue;
      textOnly ??= root;
      const media = [...root.querySelectorAll('img, video')].some(node => visible(node) && isPostMedia(node, root, expected));
      if (media) { resolved.add(root); textOnly = null; break; }
    }
    if (textOnly) resolved.add(textOnly);
  }
  const roots = [...resolved].filter(root => ![...resolved].some(other => other !== root && root.contains(other)));
  if (roots.length === 1) return roots[0];
  if (roots.length > 1) throw new Error('Multiple post containers match this permalink. Capture was stopped to avoid mixing their contents.');
  if (expected.platform === 'instagram' && /^\/(?:[^/]+\/)?reel\//.test(new URL(expected.normalizedUrl).pathname)) {
    const players = [...scope.querySelectorAll('video')].filter(node => {
      const box = node.getBoundingClientRect();
      const view = document.defaultView!;
      const intersection = Math.max(0, Math.min(view.innerWidth, box.right) - Math.max(0, box.left)) * Math.max(0, Math.min(view.innerHeight, box.bottom) - Math.max(0, box.top));
      return visible(node) && box.width >= 160 && box.height >= 160 && intersection >= box.width * box.height * 0.5;
    });
    if (players.length === 1) {
      let candidate: Element | null = null;
      for (let root = players[0].parentElement, depth = 0; root && depth < 18; root = root.parentElement, depth++) {
        if (!scope.contains(root) || root === document.body || root.matches('main, [role="main"]') || root.closest(excludedContext)
          || [...root.querySelectorAll('video')].filter(visible).length !== 1 || hasDifferentPost(root, expected)) break;
        if (authorLink(root, expected)) {
          candidate = root;
          if ([...root.querySelectorAll('h1, [dir="auto"]')].some(node => visible(node) && belongsToPost(node, root)
            && !node.closest('a, header, [role="comment"]'))) return root;
        }
      }
      if (candidate) return candidate;
    }
  }
  throw new Error(`The post URL is recognized, but no unambiguous post container could be isolated safely (${candidates.length} semantic containers, ${links.length} matching links). This is an adapter limitation; opening the same permalink again may not resolve it.`);
}

export function observedText(element: Element, allowInteractiveAncestor = false, preserveBlocks = false): string | null {
  const view = element.ownerDocument.defaultView!;
  const style = view.getComputedStyle(element);
  const html = element as HTMLElement;
  if ((style.getPropertyValue('-webkit-line-clamp') && !['none', 'unset', '0'].includes(style.getPropertyValue('-webkit-line-clamp')))
    || style.textOverflow === 'ellipsis' || html.scrollHeight > html.clientHeight && style.overflowY === 'hidden') return null;
  if (preserveBlocks) {
    const read = (parent: Element): string => {
      let result = '';
      for (const child of parent.childNodes) {
        if (child.nodeType === 3) {
          const control = parent.closest('button, [role="button"], time, [role="comment"], [data-memoar-exclude]');
          if (visible(parent) && (!control || allowInteractiveAncestor && (control === element || !element.contains(control)))) result += child.textContent ?? '';
        } else if (child.nodeType === 1 && visible(child as Element)) {
          const node = child as Element;
          if (node.tagName === 'BR') { result += '\n'; continue; }
          const content = read(node);
          const block = /^(DIV|P|LI|UL|OL)$/.test(node.tagName);
          if (block && content && result && !result.endsWith('\n')) result += '\n';
          result += content;
          if (block && content && !result.endsWith('\n')) result += '\n';
        }
      }
      return result;
    };
    return read(element).trim() || null;
  }
  const walker = element.ownerDocument.createTreeWalker(element, 5);
  let text = '';
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.nodeType === 1) {
      if ((node as Element).tagName === 'BR' && visible(node as Element)) text += '\n';
      continue;
    }
    const parent = node.parentElement;
    const control = parent?.closest('button, [role="button"], time, [role="comment"], [data-memoar-exclude]');
    if (parent && visible(parent) && (!control || allowInteractiveAncestor && (control === element || !element.contains(control)))) text += node.textContent ?? '';
  }
  return text.trim() || null;
}

export type DomObservation = { root: Element; author: HTMLAnchorElement | null; text: string | null; textReason: string; carousel: boolean };

export function collaborationLinks(root: Element, expected: ParsedPostUrl): HTMLAnchorElement[] {
  if (expected.platform !== 'instagram') return [];
  const groups = new Map<string, HTMLAnchorElement[]>();
  for (const link of root.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    if (!visible(link) || !profileUrl(link, expected)) continue;
    for (let parent = link.parentElement, depth = 0; parent && root.contains(parent) && depth < 8; parent = parent.parentElement, depth++) {
      const links = [...parent.querySelectorAll<HTMLAnchorElement>('a[href]')].filter(node => visible(node) && profileUrl(node, expected));
      const handles = links.map(node => profileUrl(node, expected)!.pathname.replace(/^\//, '').replace(/\/$/, ''));
      if (handles.length < 2 || handles.length > 10 || new Set(handles).size !== handles.length) continue;
      const label = parent.textContent?.replace(/\s+/g, '') ?? '';
      if (['and', 'dan', ','].some(separator => label === handles.join(separator))) groups.set(handles.join(','), links);
    }
  }
  return groups.size === 1 ? [...groups.values()][0] : [];
}

export function authorLink(root: Element, expected: ParsedPostUrl): HTMLAnchorElement | null {
  const header = root.querySelector('header');
  const hint = authorHint(root, expected);
  const links = [...(header ?? root).querySelectorAll<HTMLAnchorElement>('a[href]')].filter(link => visible(link) && belongsToPost(link, root) && profileUrl(link, expected)
    && (expected.platform !== 'instagram' || !/^[@#]/.test(link.textContent?.trim() ?? '')));
  if (expected.platform === 'instagram' && /^\/(?:[^/]+\/)?reel\//.test(new URL(expected.normalizedUrl).pathname)) {
    const reelProfiles = links.filter(link => /^\/[A-Za-z0-9_.]+\/reels\/?$/.test(new URL(link.getAttribute('href')!, expected.normalizedUrl).pathname));
    if (new Set(reelProfiles.map(link => profileUrl(link, expected)!.pathname)).size === 1) return reelProfiles[0];
  }
  const hinted = hint ? links.filter(link => profileUrl(link, expected)!.pathname.replace(/^\/@?/, '').replace(/\/$/, '').toLowerCase() === hint.toLowerCase()) : [];
  if (hinted.length) return hinted[0];
  const collaborators = collaborationLinks(root, expected);
  if (collaborators.length) return collaborators[0];
  const handles = [...new Set(links.map(link => profileUrl(link, expected)!.pathname.replace(/\/$/, '')))];
  return handles.length === 1 ? links[0] : null;
}

export function authoredCaption(root: Element, expected: ParsedPostUrl, author: HTMLAnchorElement | null): Pick<DomObservation, 'text' | 'textReason'> {
  if (author) {
    const profile = profileUrl(author, expected)!;
    const anchors = [...root.querySelectorAll('a[href]')].filter(link => visible(link) && belongsToPost(link, root)
      && profileUrl(link, expected)?.pathname.replace(/\/$/, '') === profile.pathname.replace(/\/$/, ''));
    const blocks = new Set<Element>();
    for (const anchor of anchors) {
      for (let parent = anchor.parentElement, depth = 0; parent && root.contains(parent) && depth < 9; parent = parent.parentElement, depth++) {
        const text = postTextBlocks(parent);
        const profiles = [...parent.querySelectorAll('a[href]')].filter(link => visible(link) && profileUrl(link, expected) && !text.some(block => block.contains(link)));
        if (profiles.some(link => profileUrl(link, expected)!.pathname.replace(/\/$/, '') !== profile.pathname.replace(/\/$/, ''))) break;
        if ([...parent.querySelectorAll('a[href]')].some(link => /\/(?:c|comments)\//.test(link.getAttribute('href') ?? ''))) break;
        if (text.length === 1 && !text[0].closest('header')) { blocks.add(text[0]); break; }
        if (parent === root) break;
      }
    }
    if (blocks.size === 1) return { text: observedText([...blocks][0]), textReason: 'Visible text in the author-associated post block. Completeness is unverified; no caption expansion was performed.' };
  }
  const text = postTextBlocks(root);
  return text.length === 1 ? { text: observedText(text[0]), textReason: 'Unique visible text block within the matched post. Completeness is unverified.' }
    : { text: null, textReason: 'Post context found, but caption could not be separated safely from other text.' };
}

export function textObservation(root: Element, selector: string): Pick<DomObservation, 'text' | 'textReason'> {
  const nodes = [...root.querySelectorAll(selector)].filter(element => visible(element)
    && !element.closest('[role="comment"], aside, [role="complementary"]')
    && !element.parentElement?.closest('li, [role="listitem"]'));
  if (nodes.length !== 1) return { text: null, textReason: 'A unique visible post-text block could not be separated from comments and surrounding content.' };
  const text = observedText(nodes[0], nodes[0].matches('h1'));
  return { text, textReason: text
    ? 'Exact observed DOM text. Completeness is unverified; collapsed text is not expanded.'
    : 'The text is clipped, hidden, or empty; visible text could not be isolated safely.' };
}
