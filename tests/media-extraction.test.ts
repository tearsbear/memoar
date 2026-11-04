import { afterEach, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { capturePost } from '../extension/capture-post';
import { captureCarousel } from '../extension/capture-carousel';
import { readMedia } from '../extension/media';
import { verifyMedia } from '../extension/verify-media';
import { normalizeCapture } from '../src/lib/capture/normalize';
import { parsePostUrl } from '../src/lib/inspection/parse-url';

const url = 'https://www.instagram.com/p/MEDIA_FIXTURE/';
const windows: JSDOM[] = [];
function page(media: string) {
  const dom = new JSDOM(`<main><article><header><a href="/fixture/">fixture</a><img src="https://scontent.cdninstagram.com/avatar.jpg"></header><a href="${url}"><time>Now</time></a><h1>Caption #fixture</h1>${media}</article></main>`, { url, pretendToBeVisual: true });
  windows.push(dom);
  const rect = { top: 0, left: 0, bottom: 500, right: 500, width: 500, height: 500 };
  vi.spyOn(dom.window.Element.prototype, 'getBoundingClientRect').mockReturnValue(rect as DOMRect);
  vi.spyOn(dom.window.Element.prototype, 'getClientRects').mockReturnValue({ length: 1 } as DOMRectList);
  return dom.window.document;
}
afterEach(() => windows.splice(0).forEach(dom => dom.window.close()));
const image = (name: string) => `<img src="https://scontent.cdninstagram.com/${name}.jpg">`;

it('excludes author-row avatars, comment images and UI images while preserving the highest explicit srcset resolution', () => {
  const document = page(`<div>${image('unlinked-avatar')}<a href="/fixture/">fixture</a></div><div>${image('post').replace('>', ' srcset="https://scontent.cdninstagram.com/post.jpg 500w, https://scontent.cdninstagram.com/original.jpg 1440w">')}</div><div role="comment">${image('comment')}</div><nav>${image('ui')}</nav>`);
  const report = capturePost(document, url).inspection;
  expect(report.fields.imageUrls.value).toEqual(['https://scontent.cdninstagram.com/original.jpg']);
  expect(report.fields.thumbnailUrl.value).toBe('https://scontent.cdninstagram.com/original.jpg');
  expect(report.fields.captionText.value).toBe('Caption #fixture');
  expect(report.fields.authorHandle.value).toBe('fixture');
  expect(report.media?.items[0].assetAccess).toBe('reference_only');
});

it('orders mixed carousel slides and does not treat player covers as image slides', () => {
  const document = page(`<ul><li aria-posinset="1" aria-setsize="3"><div>${image('one')}<a href="/tagged/">Tagged person</a><a href="/tagged_two/">Tagged person</a></div></li><li aria-posinset="2" aria-setsize="3"><div><video src="blob:https://www.instagram.com/second"><source src="https://scontent.cdninstagram.com/video.mp4" type="video/mp4"></video>${image('video-cover')}</div></li><li aria-posinset="3" aria-setsize="3">${image('three')}</li></ul><button aria-label="Next">Next</button>`);
  const report = capturePost(document, url).inspection;
  expect(report.media).toMatchObject({ kind: 'carousel', totalSlides: 3, completeness: 'complete', composition: 'mixed' });
  expect(report.media!.items.map(item => [item.position, item.type])).toEqual([[1, 'image'], [2, 'video'], [3, 'image']]);
  expect(report.fields.imageUrls.value).toEqual(['https://scontent.cdninstagram.com/one.jpg', 'https://scontent.cdninstagram.com/three.jpg']);
  expect(report.fields.videoUrl.value).toBe('https://scontent.cdninstagram.com/video.mp4');
  expect(report.media!.items[1].referenceUrl).toBe('blob:https://www.instagram.com/second');
  expect(report.aiReadiness.sam31.every(input => input.status !== 'ready' && !input.technicallyAccessible)).toBe(true);
});

it('reports missing positions, duplicate references, and unknown remaining slide types honestly', () => {
  const document = page(`<ul><li aria-posinset="2" aria-setsize="5">${image('same')}${image('same')}</li></ul><button aria-label="Next">Next</button>`);
  const report = capturePost(document, url).inspection;
  expect(report.fields.imageUrls.value).toEqual(['https://scontent.cdninstagram.com/same.jpg']);
  expect(report.media).toMatchObject({ completeness: 'partial', totalSlides: 5, composition: 'unknown' });
  expect(report.media!.items).toHaveLength(1);
  expect(report.media!.items[0].position).toBe(2);
});

it('does not read a rendered neighboring slide clipped by the carousel viewport', () => {
  const document = page(`<div style="overflow:hidden"><ul><li aria-posinset="1" aria-setsize="2">${image('one')}</li><li aria-posinset="2" aria-setsize="2">${image('offscreen')}</li></ul></div><button aria-label="Next">Next</button>`);
  const offscreen = document.querySelector('img[src*="offscreen"]')!;
  Object.defineProperty(offscreen, 'getBoundingClientRect', { value: () => ({ left: 500, right: 1000, top: 0, bottom: 500, width: 500, height: 500 }) });
  expect(capturePost(document, url).inspection.fields.imageUrls.value).toEqual(['https://scontent.cdninstagram.com/one.jpg']);
});

it('never upgrades a blob player to accessible or complete media bytes', async () => {
  const report = capturePost(page('<video src="blob:https://www.instagram.com/local"></video>'), url).inspection;
  const transport = vi.fn();
  const verified = await verifyMedia(report.media!, { transport });
  expect(transport).not.toHaveBeenCalled();
  expect(verified.items[0]).toMatchObject({ assetAccess: 'reference_only', url: 'blob:https://www.instagram.com/local' });
  expect(report.aiReadiness.museSpark.find(input => input.modality === 'video')).toMatchObject({ technicallyAccessible: false, status: 'unknown' });
});

it('verifies anonymous image bytes and MIME, preserves proof through handoff, and keeps AI permission separate', async () => {
  const capture = capturePost(page(image('one')), url);
  const transport = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } }));
  const close = vi.fn();
  const decode = vi.fn(async () => ({ width: 1440, height: 1080, close }));
  const media = await verifyMedia(capture.inspection.media!, { transport, decode });
  expect(transport).toHaveBeenCalledWith('https://scontent.cdninstagram.com/one.jpg', expect.objectContaining({ credentials: 'omit', mode: 'cors', redirect: 'error' }));
  expect(decode).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce();
  const normalized = normalizeCapture({ ...capture, inspection: { ...capture.inspection, media } });
  expect(normalizeCapture(JSON.parse(JSON.stringify(normalized)))).toEqual(normalized);
  expect(normalized.inspection.fields.imageUrls.assetAccess).toBe('verified_accessible');
  expect(normalized.inspection.aiReadiness.sam31[0]).toMatchObject({ technicallyAccessible: true, processingEligibility: 'unverified', status: 'unknown' });
});

it('does not upgrade CORS failures, HTML, oversized images, or unproven imported verification flags', async () => {
  const capture = capturePost(page(image('one')), url);
  for (const transport of [vi.fn(async () => { throw new Error('CORS'); }), vi.fn(async () => new Response('login', { headers: { 'content-type': 'text/html' } })), vi.fn(async () => new Response('large', { headers: { 'content-type': 'image/jpeg', 'content-length': '20000000' } }))]) {
    const decode = vi.fn();
    const media = await verifyMedia(capture.inspection.media!, { transport, decode });
    expect(media.items[0].assetAccess).not.toBe('verified_accessible'); expect(decode).not.toHaveBeenCalled();
  }
  capture.inspection.media!.items[0].assetAccess = 'verified_accessible';
  expect(normalizeCapture(capture).inspection.media!.items[0].assetAccess).toBe('reference_only');
});

function carousel() {
  const document = page('<div id="stage"></div>');
  const stage = document.querySelector('#stage')!;
  let position = 2;
  const render = () => {
    stage.innerHTML = `<span aria-label="Slide ${position} of 3"></span>${position === 2 ? '<video src="blob:https://www.instagram.com/local"></video>' : image(String(position))}<button aria-label="Previous" ${position === 1 ? 'disabled' : ''}>Previous</button><button aria-label="Next" ${position === 3 ? 'disabled' : ''}>Next</button>`;
    stage.querySelector('[aria-label="Previous"]')!.addEventListener('click', () => { position--; render(); });
    stage.querySelector('[aria-label="Next"]')!.addEventListener('click', () => { position++; render(); });
  };
  render();
  return { document, stage, position: () => position };
}

it('only navigates after explicit opt-in and collects every numbered lazy slide in order from a middle slide', async () => {
  const { document, position } = carousel();
  const verify = vi.fn(async media => media);
  const current = await captureCarousel(document, url, false, { verify });
  expect(position()).toBe(2); expect(current.inspection.media!.items).toHaveLength(1);
  const result = await captureCarousel(document, url, true, { verify, sleep: async () => {} });
  expect(result.inspection.media).toMatchObject({ composition: 'mixed', totalSlides: 3, completeness: 'complete', navigation: 'completed' });
  expect(result.inspection.media!.items.map(item => [item.position, item.type])).toEqual([[1, 'image'], [2, 'video'], [3, 'image']]);
  expect(position()).toBe(3);
});

it('stops safely when a slide does not load or post identity changes', async () => {
  const { document, stage } = carousel();
  const verify = vi.fn(async media => media);
  const result = await captureCarousel(document, url, true, { verify, sleep: async () => { const img = stage.querySelector('img'); img?.removeAttribute('src'); } });
  expect(result.inspection.media).toMatchObject({ completeness: 'partial', navigation: 'stopped' });
  await expect(captureCarousel(document, url, true, { verify, getUrl: () => 'https://www.instagram.com/p/OTHER/' })).rejects.toThrow('another post');
  expect(readMedia(document.querySelector('article')!, parsePostUrl(url), true).completeness).toBe('partial');
});

it('captures an unnumbered carousel only after observing both endpoints through scoped navigation', async () => {
  const document = page('<div id="stage"></div>');
  const stage = document.querySelector('#stage')!;
  let position = 2;
  const render = () => {
    stage.innerHTML = image(String(position)) + (position > 1 ? '<button aria-label="Go back">Previous</button>' : '') + (position < 3 ? '<button aria-label="Next">Next</button>' : '');
    stage.querySelector('[aria-label="Go back"]')?.addEventListener('click', () => { position--; render(); });
    stage.querySelector('[aria-label="Next"]')?.addEventListener('click', () => { position++; render(); });
  };
  render();
  const result = await captureCarousel(document, url, true, { verify: async media => media, sleep: async () => {} });
  expect(result.inspection.media).toMatchObject({ totalSlides: 3, composition: 'image_only', completeness: 'complete' });
  expect(result.inspection.media!.items.map(item => item.position)).toEqual([1, 2, 3]);
});
