import { afterEach, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { capturePost } from '../extension/capture-post';
import { captureCarousel } from '../extension/capture-carousel';
import { instagramJsonMedia } from '../extension/instagram-json';
import { parsePostUrl } from '../src/lib/inspection/parse-url';

const cdn = 'https://scontent.cdninstagram.com/';
const url = 'https://www.instagram.com/p/JSON_ACTIVE/';
const windows: JSDOM[] = [];
const image = (name: string) => ({ media_type: 1, image_versions2: { candidates: [{ url: `${cdn}${name}.jpg`, width: 1080, height: 1350 }] } });
const video = { media_type: 2, video_versions: [{ url: `${cdn}video.mp4`, width: 1080, height: 1920 }], image_versions2: { candidates: [{ url: `${cdn}poster.jpg`, width: 1080, height: 1920 }] } };
function page(value: unknown, activeUrl = url, markup = '<video src="blob:https://www.instagram.com/player"></video>') {
  const dom = new JSDOM(`<main><article><header><a href="/fixture/">fixture</a></header><a href="${activeUrl}"><time>Now</time></a><h1>Visible caption only</h1>${markup}</article></main>`, { url: activeUrl, pretendToBeVisual: true });
  windows.push(dom);
  const rect = { top: 0, left: 0, bottom: 500, right: 500, width: 500, height: 500 };
  vi.spyOn(dom.window.Element.prototype, 'getBoundingClientRect').mockReturnValue(rect as DOMRect);
  vi.spyOn(dom.window.Element.prototype, 'getClientRects').mockReturnValue({ length: 1 } as DOMRectList);
  const script = dom.window.document.createElement('script'); script.setAttribute('data-sjs', '');
  script.textContent = JSON.stringify({ require: [{ xdt_api__v1__media__shortcode__web_info: { items: [value] } }] });
  dom.window.document.head.append(script);
  return dom.window.document;
}
afterEach(() => windows.splice(0).forEach(dom => dom.window.close()));

it('resolves a matched image at its highest explicit resolution and preserves visible caption provenance', () => {
  const media = image('original'); media.image_versions2.candidates.unshift({ url: `${cdn}small.jpg`, width: 320, height: 400 });
  const document = page({ code: 'JSON_ACTIVE', caption: { text: 'Hidden caption must not be imported' }, ...media }, url, `<img src="${cdn}visible.jpg">`);
  const capture = capturePost(document, url).inspection;
  expect(capture.fields.captionText.value).toBe('Visible caption only');
  expect(capture.fields.imageUrls.value).toEqual([`${cdn}original.jpg`]);
  expect(capture.media).toMatchObject({ discovery: 'embedded_json', kind: 'single', completeness: 'complete', composition: 'image_only' });
});

it('matches the active Reel dynamically, ignores recommendation identities and extracts an MP4 plus thumbnail', () => {
  const activeUrl = 'https://www.instagram.com/reel/ANOTHER_SHORTCODE/';
  const document = page([{ code: 'JSON_ACTIVE', ...image('other') }, { code: 'ANOTHER_SHORTCODE', ...video }], activeUrl);
  const capture = capturePost(document, activeUrl).inspection;
  expect(capture.fields.postId.value).toBe('ANOTHER_SHORTCODE');
  expect(capture.fields.videoUrl.value).toBe(`${cdn}video.mp4`);
  expect(capture.fields.thumbnailUrl.value).toBe(`${cdn}poster.jpg`);
  expect(capture.media!.items[0]).toMatchObject({ type: 'video', assetAccess: 'reference_only', referenceUrl: 'blob:https://www.instagram.com/player' });
});

it('captures mixed and image carousels in metadata order without advancing any slides or changing the flow', async () => {
  for (const slides of [[image('first'), video, image('last')], [image('first'), image('last')]]) {
    const document = page({ code: 'JSON_ACTIVE', media_type: 8, carousel_media_count: slides.length, carousel_media: slides });
    const button = document.createElement('button'); button.setAttribute('aria-label', 'Next'); document.querySelector('article')!.append(button);
    const clicked = vi.fn(); button.addEventListener('click', clicked);
    const verify = vi.fn(async media => media);
    const capture = await captureCarousel(document, url, false, { verify });
    expect(capture.inspection.media).toMatchObject({ kind: 'carousel', totalSlides: slides.length, completeness: 'complete', navigation: 'not_requested' });
    expect(capture.inspection.media!.items.map(item => [item.position, item.type])).toEqual(slides.map((slide, index) => [index + 1, slide.media_type === 2 ? 'video' : 'image']));
    expect(clicked).not.toHaveBeenCalled(); expect(verify).toHaveBeenCalledOnce();
  }
});

it('ignores malformed JSON, executable script text, mismatched posts, conflicting matches and incomplete carousel arrays', () => {
  const document = page({ code: 'UNRELATED', ...video });
  const script = document.createElement('script'); script.setAttribute('data-sjs', '');
  script.textContent = 'globalThis.JSON_ACTIVE = true;'; document.head.append(script);
  expect(instagramJsonMedia(document, parsePostUrl(url))).toBeNull();
  expect(capturePost(document, url).inspection.media!.items[0].url).toBe('blob:https://www.instagram.com/player');
  for (const value of [[{ code: 'JSON_ACTIVE', ...video }, { code: 'JSON_ACTIVE', ...image('conflict') }],
    { code: 'JSON_ACTIVE', carousel_media_count: 3, carousel_media: [image('partial')] }]) {
    expect(instagramJsonMedia(page(value), parsePostUrl(url))).toBeNull();
  }
});

it('keeps a DASH-only player reference and does not mistake separate representations for complete files', () => {
  const document = page({ code: 'JSON_ACTIVE', media_type: 2, video_dash_manifest: '<MPD><Period><AdaptationSet mimeType="video/mp4"/><AdaptationSet mimeType="audio/mp4"/></Period></MPD>' });
  const item = capturePost(document, url).inspection.media!.items[0];
  expect(item).toMatchObject({ type: 'video', assetAccess: 'reference_only', url: 'blob:https://www.instagram.com/player' });
  expect(item.reason).toContain('DASH'); expect(item.verification).toBeUndefined();
});

it('omits protected streams and non-allowlisted media URLs without inferring privacy or media permissions', () => {
  const protectedItem = capturePost(page({ code: 'JSON_ACTIVE', ...video, video_dash_manifest: '<MPD><ContentProtection/></MPD>' }), url).inspection.media!.items[0];
  expect(protectedItem.url).toBeNull(); expect(protectedItem.reason).toContain('content protection');
  const document = page({ code: 'JSON_ACTIVE', ...video, video_versions: [{ url: 'https://other.example/video.mp4' }] });
  expect(capturePost(document, url).inspection.media!.items[0].url).toBe('blob:https://www.instagram.com/player');
});
