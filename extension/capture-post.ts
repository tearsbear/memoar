import { emptyContentFields } from '../src/lib/inspection/fields';
import { parsePostUrl } from '../src/lib/inspection/parse-url';
import type { InspectedField } from '../src/lib/inspection/types';
import { normalizeCapture, validateMediaReference, type CaptureEnvelope } from '../src/lib/capture/normalize';
import { instagram } from './adapters/instagram';
import { instagramAudioControls, instagramPostContext } from './adapters/instagram-context';
import { threads, threadsPostContext } from './adapters/threads';
import { facebook } from './adapters/facebook';
import { belongsToPost, collaborationLinks, isPostMedia, observedText, samePost, visible } from './adapters/dom';
import { mediaElements, readMedia } from './media';
import { instagramJsonMedia } from './instagram-json';

function observed<T>(value: T, reason: string | null = null, media = false): InspectedField<T> {
  return { value, status: 'available', source: media ? 'browser_media_reference' : 'browser_dom', reason, processingEligibility: 'unverified', ...(media ? { assetAccess: 'reference_only' as const } : {}) };
}

export function capturePost(document: Document, url: string, now = new Date()): CaptureEnvelope {
  const parsed = parsePostUrl(url);
  const thread = parsed.platform === 'threads' ? threads(document, parsed) : null;
  const observation = thread ?? { instagram, threads, facebook }[parsed.platform](document, parsed);
  const fields = emptyContentFields();
  for (const field of Object.values(fields)) field.reason = 'No unambiguous value was observed in the active post DOM.';
  fields.postId = { value: parsed.postId, status: 'available', source: 'url', reason: null, processingEligibility: 'unverified' };
  if (observation.author) {
    const author = new URL(observation.author.getAttribute('href')!, parsed.normalizedUrl);
    if (parsed.platform === 'instagram') author.pathname = author.pathname.replace(/\/reels\/?$/, '/');
    author.search = ''; author.hash = '';
    fields.authorUrl = observed(author.href);
    fields.authorHandle = observed(author.pathname.replace(/^\/@?/, '').replace(/\/$/, ''));
  }
  if (thread?.metadata.username) {
    fields.authorHandle = observed(thread.metadata.username, 'Author username from already-loaded Threads metadata matched to the exact post.');
    fields.authorUrl = observed(new URL(`/@${thread.metadata.username}`, parsed.normalizedUrl).href, 'Profile URL for the username in the matched Threads metadata.');
  }
  const collaborators = collaborationLinks(observation.root, parsed);
  if (collaborators.length) {
    fields.collaboratorHandles = observed(collaborators.map(link => new URL(link.getAttribute('href')!, parsed.normalizedUrl).pathname.replace(/^\//, '').replace(/\/$/, '')), 'Accounts explicitly listed together in the visible collaboration header. Ordering does not establish ownership.');
    fields.authorHandle.reason = fields.authorUrl.reason = 'First account in the observed collaboration header; not a claim of sole authorship or ownership.';
  }
  const textKey = parsed.platform === 'instagram' ? 'captionText' : 'textContent';
  fields[textKey].reason = observation.textReason;
  if (observation.text) fields[textKey] = observed(observation.text, observation.textReason);

  if (parsed.platform === 'instagram') {
    const inHeader = (node: Element): boolean => {
      const authorPath = observation.author?.getAttribute('href');
      if (!authorPath) return false;
      for (let parent = node.parentElement, depth = 0; parent && observation.root.contains(parent) && depth < 18; parent = parent.parentElement, depth++) {
        if (parent.querySelector('time, textarea, [contenteditable="true"], a[href*="/c/"]')) return false;
        if ([...parent.querySelectorAll('a[href]')].some(link => link.getAttribute('href') === authorPath)) return true;
      }
      return false;
    };
    const postLinks = [...observation.root.querySelectorAll('a[href]')].filter(link => instagramPostContext(link, observation.root, parsed));
    for (const [key, pattern] of [['location', /^\/explore\/locations\/\d+(?:\/[^/]+)?\/?$/], ['audioLabel', /^\/(?:reels\/audio|music)\/\d+\/?$/]] as const) {
      const contextLinks = key === 'audioLabel' ? postLinks : postLinks.filter(inHeader);
      const labels = [...new Set(contextLinks.filter(link => {
        const target = new URL(link.getAttribute('href')!, parsed.normalizedUrl);
        return target.origin === new URL(parsed.normalizedUrl).origin && pattern.test(target.pathname);
      }).map(node => observedText(node, true)).filter((text): text is string => Boolean(text)))];
      if (labels.length === 1) {
        const attribution = key === 'audioLabel' ? contextLinks.find(link => observedText(link, true) === labels[0] && pattern.test(new URL(link.getAttribute('href')!, parsed.normalizedUrl).pathname)) : null;
        fields[key] = observed(labels[0], key === 'audioLabel'
          ? `Visible audio attribution label only; no audio file was retrieved.${attribution ? ` Link: ${new URL(attribution.getAttribute('href')!, parsed.normalizedUrl).origin}${new URL(attribution.getAttribute('href')!, parsed.normalizedUrl).pathname}` : ''}`
          : 'Visible location link label within the matched post; not coordinates or inferred location.');
      }
    }
    if (!fields.audioLabel.value) {
      const labels = [...new Set(instagramAudioControls(observation.root, parsed).map(node => observedText(node, true)).filter((label): label is string => Boolean(label)))];
      if (labels.length === 1) fields.audioLabel = observed(labels[0], 'Visible text beside an explicit audio/music control in the matched post; no audio file was retrieved.');
    }
    if (!fields.audioLabel.value) {
      const labels = [...new Set([...observation.root.querySelectorAll('span')].filter(node => visible(node) && belongsToPost(node, observation.root)
        && !node.querySelector('span') && /^(Original audio|Audio asli)$/i.test(node.textContent?.trim() ?? '') && inHeader(node)).map(node => observedText(node, true)).filter(Boolean))];
      if (labels.length === 1) fields.audioLabel = observed(labels[0]!, 'Visible original-audio label in the author header; no creator identity or audio file is inferred.');
    }
  }

  const warnings: string[] = thread
    ? ['Capture reads the matched Threads post after a user click, including already-loaded script[data-sjs] JSON matched to its exact identity. Scripts are never executed.', ...thread.metadata.warnings]
    : ['Capture reads the matched post DOM after a user click. Instagram media may also use already-loaded script[data-sjs] JSON matched to the exact shortcode; scripts are never executed.'];
  const excluded = (element: Element) => !isPostMedia(element, observation.root, parsed) || Boolean(thread && !threadsPostContext(element, observation.root, parsed));
  const elements = thread?.elements ?? mediaElements(observation.root, parsed);
  const images = elements.filter((node): node is HTMLImageElement => node.tagName === 'IMG');
  const videos = elements.filter((node): node is HTMLVideoElement => node.tagName === 'VIDEO');
  const embedded = instagramJsonMedia(document, parsed);
  const visibleMedia = thread?.media ?? readMedia(observation.root, parsed, observation.carousel);
  if (embedded) for (const item of embedded.items) {
    const fallback = visibleMedia.kind === embedded.kind ? visibleMedia.items.find(visible => visible.position === item.position && visible.type === item.type) : undefined;
    if (fallback && !item.reason.includes('content protection')) {
      item.referenceUrl = fallback.referenceUrl;
      if (!item.url && fallback.url) {
        item.url = fallback.url; item.assetAccess = 'reference_only';
        item.reason += ' The matching visible player reference is retained without assuming reusable bytes.';
      }
      item.posterUrl ??= fallback.posterUrl;
    }
  }
  const media = embedded ?? visibleMedia;
  if (embedded) warnings.push('Embedded media URLs are temporary CDN references. Verification uses anonymous CORS GET only; access and AI processing permission remain separate.');
  else if (thread?.media.discovery === 'embedded_json') warnings.push('Threads embedded media URLs are temporary CDN references. Verification uses anonymous CORS GET only; access and AI processing permission remain separate.');
  else if (parsed.platform === 'instagram') warnings.push('No unambiguous supported embedded media matched the active shortcode. Visible media references are retained; blob players and DASH streams are not reusable files.');
  const references = (values: string[]): string[] => [...new Set(values.filter(Boolean).filter(value => {
    try { validateMediaReference(value, parsed.platform); return true; }
    catch { warnings.push('An unsupported or credential-like media reference was omitted. No media was fetched.'); return false; }
  }))];
  const audio = [...observation.root.querySelectorAll<HTMLAudioElement>('audio')].filter(node => visible(node) && !excluded(node));
  const audioUrls = references(audio.map(node => node.currentSrc || node.getAttribute('src') || ''));
  if (audioUrls.length === 1) fields.audioUrl = observed(audioUrls[0], 'Reference only; independent audio access and format are unverified.', true);
  if (thread) {
    if (media.kind === 'carousel' || media.items.length === 1) fields.mediaType = observed(media.kind === 'carousel' ? 'carousel' : media.items[0].type, media.reason);
    else if (observation.text) fields.mediaType = observed('text', 'Matched Threads post text was captured. No supported media was identified; additional or unavailable media are unknown.');
  } else if (embedded) {
    fields.mediaType = observed(embedded.kind === 'carousel' ? 'carousel' : embedded.items[0].type, embedded.reason);
  } else if (observation.carousel) {
    fields.mediaType = observed('carousel', 'Carousel controls were observed. Only visible elements were captured; total slides are unknown.');
    warnings.push('Carousel capture is partial. No slides were advanced, and remaining media are unknown.');
  } else if (videos.length) fields.mediaType = observed('video', 'A visible video element was observed. File accessibility is not established.');
  else if (images.length) fields.mediaType = observed('image', 'Visible image elements were observed. This does not establish whether the post has additional slides.');
  else if (observation.text && parsed.platform !== 'instagram') fields.mediaType = observed('text', 'Visible post text was captured; additional media outside the visible context are unknown.');

  const times = [...observation.root.querySelectorAll('a[href]')].filter(link => samePost(link.getAttribute('href')!, parsed) && (!thread || threadsPostContext(link, observation.root, parsed)))
    .flatMap(link => [...link.querySelectorAll<HTMLTimeElement>('time[datetime]')]).filter(visible);
  const dates = [...new Set(times.map(node => node.dateTime))];
  if (dates.length === 1 && Number.isFinite(Date.parse(dates[0]))) fields.publishedAt = observed(dates[0], 'Timestamp observed on the matching post permalink.');
  return normalizeCapture({ version: 1, inspection: {
    media,
    inspectionMethod: 'extension', platform: parsed.platform, normalizedUrl: parsed.normalizedUrl,
    inspectedAt: now.toISOString(), fields, warnings: [...new Set(warnings)],
  } });
}

export async function captureWithRetry(document: Document, expectedUrl: string, dependencies: {
  getUrl?: () => string; sleep?: (ms: number) => Promise<void>; read?: typeof capturePost;
} = {}): Promise<CaptureEnvelope> {
  const getUrl = dependencies.getUrl ?? (() => document.location.href);
  const sleep = dependencies.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const read = dependencies.read ?? capturePost;
  let last: CaptureEnvelope | undefined;
  let failure: unknown;
  const deadline = Date.now() + 3000;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (Date.now() > deadline) break;
    if (getUrl() !== expectedUrl) throw new Error('The tab navigated during capture. Open the desired post and capture again.');
    try {
      last = read(document, expectedUrl);
      if (getUrl() !== expectedUrl) throw new Error('The tab navigated during capture.');
      if (last.inspection.fields.captionText.value || last.inspection.fields.textContent.value) return last;
    } catch (error) { failure = error; }
    if (attempt < 2) await sleep(750);
  }
  if (getUrl() !== expectedUrl) throw new Error('The tab navigated during capture. Capture discarded.');
  if (last) return last;
  throw failure instanceof Error ? failure : new Error('No supported visible post was found.');
}
