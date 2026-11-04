import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { capturePost } from '../extension/capture-post';
import { captureCarousel } from '../extension/capture-carousel';
import { threadsJsonPost } from '../extension/threads-json';
import { verifyMedia } from '../extension/verify-media';
import { parsePostUrl } from '../src/lib/inspection/parse-url';
import { normalizeCapture } from '../src/lib/capture/normalize';
import { modelExport } from '../src/lib/inspection/model-export';
import { buildTestScript, readExportImages } from '../src/lib/inspection/test-script';
import { mp4Fixture } from './mp4-fixture';

const url = 'https://www.threads.com/@fixture/post/THREAD_ACTIVE/';
const cdn = 'https://scontent.xx.fbcdn.net/';
const windows: JSDOM[] = [];
const image = (name: string) => ({ media_type: 1, image_versions2: { candidates: [
  { url: `${cdn}${name}-small.jpg`, width: 320, height: 400 },
  { url: `${cdn}${name}.jpg`, width: 1080, height: 1350 },
] } });
const video = { media_type: 2, video_versions: [{ url: `${cdn}video.mp4`, width: 1080, height: 1920 }],
  image_versions2: { candidates: [{ url: `${cdn}poster.jpg`, width: 1080, height: 1920 }] } };
const matched = (data: object = {}) => ({ code: 'THREAD_ACTIVE', user: { username: 'fixture' }, ...data });
const picture = (name: string) => `<picture><img src="${cdn}${name}-small.jpg" srcset="${cdn}${name}-small.jpg 320w, ${cdn}${name}.jpg 1080w"></picture>`;
function page(data: unknown = null, media = '', text = '<div data-testid="post-text">DOM caption</div>', sourceUrl = url) {
  const dom = new JSDOM(`<main><article><header><a href="/@fixture">fixture</a><img alt="Avatar" src="${cdn}avatar.jpg"></header>
    <a href="${sourceUrl}"><time datetime="2026-11-05T00:00:00Z">Now</time></a>${text}${media}</article></main>`, { url: sourceUrl, pretendToBeVisual: true });
  windows.push(dom);
  const rect = { top: 0, left: 0, bottom: 500, right: 500, width: 500, height: 500 };
  vi.spyOn(dom.window.Element.prototype, 'getBoundingClientRect').mockReturnValue(rect as DOMRect);
  vi.spyOn(dom.window.Element.prototype, 'getClientRects').mockReturnValue({ length: 1 } as DOMRectList);
  if (data !== null) {
    const script = dom.window.document.createElement('script'); script.setAttribute('data-sjs', '');
    script.textContent = JSON.stringify({ require: [{ data: { thread_items: [{ media: data }] } }] });
    dom.window.document.head.append(script);
  }
  return dom.window.document;
}
afterEach(() => windows.splice(0).forEach(dom => dom.window.close()));

describe('Threads post identity, text and ordered media', () => {
  it('captures text-only metadata without borrowing quoted or recommended text/media', () => {
    const text = 'First paragraph 🧵\n\nHello @friend #Memoar';
    const document = page([matched({ caption: { text }, quoted_post: { code: 'QUOTE', caption: { text: 'Wrong quote' }, ...image('quote') } }),
      { code: 'RECOMMENDED', user: { username: 'other' }, ...video }]);
    const report = capturePost(document, url).inspection;
    expect(report.fields.postId.value).toBe('THREAD_ACTIVE');
    expect(report.fields.authorHandle.value).toBe('fixture');
    expect(report.fields.authorUrl.value).toBe('https://www.threads.com/@fixture');
    expect(report.fields.textContent.value).toBe(text);
    expect(report.fields.captionText.value).toBeNull();
    expect(report.fields.hashtags.value).toEqual(['#Memoar']);
    expect(report.fields.mediaType.value).toBe('text');
    expect(report.media!.items).toEqual([]);
    expect(report.fields.imageUrls.value).toBeNull();
    expect(report.fields.videoUrl.value).toBeNull();
  });

  it('uses plaintext fragments in order without inserting or removing whitespace', () => {
    const document = page(matched({ caption: { text: '' }, text_post_app_info: { text_fragments: { fragments: [
      { plaintext: 'Hello ' }, { plaintext: '@friend' }, { plaintext: '\n\nSecond paragraph 🌱 #tag' },
    ] } } }));
    expect(capturePost(document, url).inspection.fields.textContent.value).toBe('Hello @friend\n\nSecond paragraph 🌱 #tag');
  });

  it('matches a permalink on the legacy host and resolves metadata author on a short link', () => {
    const sourceUrl = 'https://www.threads.com/t/THREAD_ACTIVE/';
    const document = page({ permalink: 'https://www.threads.net/@fixture/post/THREAD_ACTIVE/', user: { username: 'fixture' }, caption: { text: 'Permalink caption' }, ...image('one') }, '', '', sourceUrl);
    const report = capturePost(document, sourceUrl).inspection;
    expect(report.fields.authorHandle.value).toBe('fixture');
    expect(report.fields.textContent.value).toBe('Permalink caption');
    expect(report.fields.imageUrls.value).toEqual([`${cdn}one.jpg`]);
  });

  it('selects one highest-resolution candidate per image and preserves carousel array order', () => {
    for (const slides of [[image('one')], [image('third'), image('first'), image('second')]]) {
      const document = page(matched(slides.length === 1 ? slides[0] : { media_type: 8, carousel_media_count: 3, carousel_media: slides }));
      const report = capturePost(document, url).inspection;
      expect(report.media).toMatchObject({ discovery: 'embedded_json', kind: slides.length === 1 ? 'single' : 'carousel', totalSlides: slides.length, completeness: 'complete' });
      expect(report.media!.items.map(item => item.position)).toEqual(slides.map((_, index) => index + 1));
      expect(report.fields.imageUrls.value).toEqual(slides.map(slide => slide.image_versions2.candidates[1].url));
      expect(report.media!.items.every(item => item.assetAccess === 'reference_only')).toBe(true);
    }
  });

  it('falls back to scoped pictures in DOM order and keeps unknown remaining slides explicit', () => {
    const document = page(null, `<div dir="auto">${picture('second')}${picture('first')}</div>`.replaceAll('<img ', '<img aria-hidden="true" '));
    const report = capturePost(document, url).inspection;
    expect(report.fields.imageUrls.value).toEqual([`${cdn}second.jpg`, `${cdn}first.jpg`]);
    expect(report.media).toMatchObject({ kind: 'carousel', totalSlides: null, completeness: 'partial' });
    expect(report.media!.items.map(item => item.position)).toEqual([null, null]);
    const single = page(null, '<picture><img></picture>');
    Object.defineProperty(single.querySelector('picture img'), 'currentSrc', { value: `${cdn}current.jpg` });
    expect(capturePost(single, url).inspection.fields.imageUrls.value).toEqual([`${cdn}current.jpg`]);
  });

  it('preserves DOM paragraphs, mentions and emoji while excluding quotes, replies, avatars and recommendations', () => {
    const text = '<div data-testid="post-text"><p>First 🌱 <a href="/@friend">@friend</a></p><p>Second #tag</p></div>';
    const document = page(null, picture('post'), text);
    const root = document.querySelector('article')!;
    root.insertAdjacentHTML('beforeend', `<article><a href="/@quote/post/QUOTED/">Quote</a><div data-testid="post-text">Quoted text</div>${picture('quote')}</article>
      <blockquote><span dir="auto">Quoted without permalink</span>${picture('quote-two')}</blockquote><div role="comment">Reply ${picture('reply')}</div>
      <aside>${picture('suggested')}<div data-testid="post-text">Recommended text</div></aside>`);
    document.querySelector('main')!.insertAdjacentHTML('beforeend', `<article><a href="/@reply/post/REPLY/">Reply</a>${picture('neighbor')}</article>`);
    const report = capturePost(document, url).inspection;
    expect(report.fields.textContent.value).toBe('First 🌱 @friend\nSecond #tag');
    expect(report.fields.imageUrls.value).toEqual([`${cdn}post.jpg`]);
    expect(report.fields.publishedAt.value).toBe('2026-11-05T00:00:00Z');
  });

  it('rejects duplicate matching cards and a matching post embedded inside another post', () => {
    const document = page(matched({ caption: { text: 'Metadata' } }));
    const root = document.querySelector('article')!;
    root.after(root.cloneNode(true));
    expect(() => capturePost(document, url)).toThrow('More than one');
    root.nextElementSibling!.remove();
    const outer = document.createElement('article');
    outer.innerHTML = '<a href="/@other/post/OTHER/">Outer post</a>';
    root.replaceWith(outer); outer.append(root);
    expect(() => capturePost(document, url)).toThrow('nested post context');
  });

  it('uses safe DOM fallback for malformed, conflicting, wrong-author and mismatching metadata', () => {
    const candidates = [
      { code: 'OTHER', ...image('other') },
      [matched(image('one')), matched(image('conflict'))],
      matched({ user: { username: 'wrong' }, ...image('wrong') }),
      matched({ permalink: 'https://www.threads.com/@fixture/post/OTHER/', ...video }),
    ];
    for (const candidate of candidates) {
      const report = capturePost(page(candidate, picture('fallback')), url).inspection;
      expect(report.fields.imageUrls.value).toEqual([`${cdn}fallback.jpg`]);
      expect(report.warnings.join(' ')).toContain('scoped DOM fallback');
    }
    const document = page(matched(video), picture('fallback'));
    document.querySelector('script')!.textContent = 'globalThis.THREAD_ACTIVE = true;';
    expect(capturePost(document, url).inspection.fields.imageUrls.value).toEqual([`${cdn}fallback.jpg`]);
  });

  it('does not borrow a thumbnail as a video, fill unknown slides, or hide incomplete metadata', () => {
    const document = page(matched({ media_type: 8, carousel_media_count: 4, carousel_media: [image('one'), {}, { media_type: 2, image_versions2: video.image_versions2 }] }));
    const report = capturePost(document, url).inspection;
    expect(report.media).toMatchObject({ kind: 'carousel', totalSlides: 4, completeness: 'partial', composition: 'unknown' });
    expect(report.media!.items.map(item => [item.position, item.type, item.url])).toEqual([[1, 'image', `${cdn}one.jpg`], [3, 'video', null]]);
    expect(report.fields.videoUrl.value).toBeNull();
    expect(report.media!.items[1].assetAccess).toBe('unavailable');
  });

  it('keeps protected streams and non-allowlisted resources unavailable', () => {
    const document = page(matched({ ...video, video_dash_manifest: '<MPD><ContentProtection/></MPD>' }), '<video src="blob:https://www.threads.com/player"></video>');
    expect(capturePost(document, url).inspection.media!.items[0]).toMatchObject({ url: null, assetAccess: 'unavailable' });
    const blocked = threadsJsonPost(page(matched({ media_type: 1, image_versions2: { candidates: [{ url: 'https://other.example/image.jpg' }] } })), parsePostUrl(url));
    expect(blocked.media!.items[0].url).toBeNull();
  });

  it('uses a rendered aria-hidden cover as the matched video thumbnail without adding an image slide', () => {
    const document = page(null, `<div><video src="blob:https://www.threads.com/player"></video>
      <img height="100%" width="100%" alt="" aria-hidden="true" referrerpolicy="origin-when-cross-origin" src="${cdn}first-frame.jpg?stp=dst-jpg_e15_tt6&amp;ccb=7-5"></div>`);
    const report = capturePost(document, url).inspection;
    expect(report.fields.thumbnailUrl.value).toBe(`${cdn}first-frame.jpg?stp=dst-jpg_e15_tt6&ccb=7-5`);
    expect(report.fields.imageUrls.value).toBeNull();
    expect(report.media!.items).toHaveLength(1);
    expect(report.media!.items[0]).toMatchObject({ type: 'video', url: 'blob:https://www.threads.com/player' });
  });

  it.each(['style="display:none"', 'hidden', 'aria-hidden="true"'])('excludes video covers inside a non-visible wrapper: %s', attributes => {
    const document = page(null, `<div><video src="blob:https://www.threads.com/player"></video>
      <div ${attributes}><img alt="" aria-hidden="true" src="${cdn}hidden-cover.jpg"></div></div>`);
    expect(capturePost(document, url).inspection.fields.thumbnailUrl.value).toBeNull();
  });
});

describe('Threads uses existing verification, readiness and exports', () => {
  it('verifies actual MP4 bytes and retains proof, handoff bytes, readiness and ZIP file contents', async () => {
    const document = page(matched({ ...video, caption: { text: 'Video caption #tag' } }), '<video src="blob:https://www.threads.com/player"></video>');
    const bytes = mp4Fixture();
    const transport = vi.fn(async () => new Response(bytes, { headers: { 'content-type': 'video/mp4' } }));
    const onVerified = vi.fn();
    const report = (await captureCarousel(document, url, false, {
      onVerified,
      verify: (media, dependencies) => verifyMedia(media, { ...dependencies, transport, decodeVideo: async () => ({ width: 1080, height: 1920, duration: 2 }) }),
    })).inspection;
    expect(transport).toHaveBeenCalledWith(`${cdn}video.mp4`, expect.objectContaining({ method: 'GET', credentials: 'omit', redirect: 'error', mode: 'cors' }));
    expect(onVerified).toHaveBeenCalledWith(0, bytes, 'video/mp4');
    expect(report.media!.items[0]).toMatchObject({ referenceUrl: 'blob:https://www.threads.com/player', assetAccess: 'verified_accessible', verification: { mimeType: 'video/mp4', byteLength: bytes.length, durationSeconds: 2, audio: 'present' } });
    expect(normalizeCapture({ version: 1, inspection: report }).inspection).toEqual(report);
    expect(report.aiReadiness.museSpark.find(input => input.modality === 'video')).toMatchObject({ technicallyAccessible: true, processingEligibility: 'unverified', status: 'unknown' });
    expect(modelExport(report, 'museSpark').inputs.media[0].type).toBe('video');
    const assets = await readExportImages(report, 'museSpark', '', { transport });
    const artifact = await buildTestScript(report, 'museSpark', assets, '', 'files');
    expect(artifact.files!.map(file => file.name)).toEqual(['test-muse-spark.mjs', 'media/slide-1.mp4']);
    expect(artifact.files![1].bytes).toEqual(bytes);
  });

  it('never upgrades HTML, partial or truncated MP4 responses to verified video bytes', async () => {
    const media = capturePost(page(matched(video)), url).inspection.media!;
    const bytes = mp4Fixture();
    for (const response of [new Response('<html>Unavailable</html>', { headers: { 'content-type': 'text/html' } }),
      new Response(bytes, { status: 206, headers: { 'content-type': 'video/mp4' } }),
      new Response(bytes.slice(0, -1), { headers: { 'content-type': 'video/mp4' } })]) {
      const onVerified = vi.fn();
      const verified = await verifyMedia(media, { transport: async () => response, onVerified, decodeVideo: async () => ({ width: 1080, height: 1920, duration: 2 }) });
      expect(verified.items[0].assetAccess).toBe('reference_only');
      expect(verified.items[0].verification).toBeUndefined();
      expect(onVerified).not.toHaveBeenCalled();
    }
  });
});

describe('Instagram regression expectations remain independent of Threads metadata', () => {
  it.each(['image', 'carousel', 'reel'] as const)('preserves %s media, visible caption and author', kind => {
    const sourceUrl = `https://www.instagram.com/${kind === 'reel' ? 'reel' : 'p'}/IG_ACTIVE/`;
    const slides = [image('ig-first'), image('ig-second')];
    const data = { code: 'IG_ACTIVE', caption: { text: 'Hidden IG caption' }, ...(kind === 'image' ? slides[0] : kind === 'reel' ? video : { media_type: 8, carousel_media_count: 2, carousel_media: slides }) };
    const document = page([matched({ ...video, caption: { text: 'Threads caption' } }), data], kind === 'reel' ? '<video src="blob:https://www.instagram.com/player"></video>' : picture('ig-visible'), '<h1>Visible Instagram caption #ig</h1>', sourceUrl);
    document.querySelector('header a')!.setAttribute('href', '/ig_author/');
    const report = capturePost(document, sourceUrl).inspection;
    expect(report.fields.captionText.value).toBe('Visible Instagram caption #ig');
    expect(report.fields.textContent.value).toBeNull();
    expect(report.fields.authorHandle.value).toBe('ig_author');
    expect(report.fields.mediaType.value).toBe(kind === 'reel' ? 'video' : kind);
    expect(report.media!.items.map(item => item.position)).toEqual(kind === 'carousel' ? [1, 2] : [1]);
    expect(report.fields.imageUrls.value).toEqual(kind === 'reel' ? null : kind === 'carousel' ? [`${cdn}ig-first.jpg`, `${cdn}ig-second.jpg`] : [`${cdn}ig-first.jpg`]);
    expect(report.fields.videoUrl.value).toBe(kind === 'reel' ? `${cdn}video.mp4` : null);
    expect(report.media!.items.every(item => item.assetAccess === 'reference_only')).toBe(true);
    expect(report.fields.captionText.source).toBe('browser_dom');
  });
});
