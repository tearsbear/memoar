import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { capturePost } from '../extension/capture-post';
import { samePost } from '../extension/adapters/dom';
import { parsePostUrl } from '../src/lib/inspection/parse-url';
import { snapshotCandidate } from '../extension/snapshot-region';

const instagramUrl = 'https://www.instagram.com/p/UNIT_TEST_ONLY/';
const threadsUrl = 'https://www.threads.com/@fixture/post/UNIT_TEST_ONLY/';
const windows: JSDOM[] = [];

it.each(['li', 'div'])('reads a formatted author caption with many mentions in a %s entry', tag => {
  const body = `<${tag}><a href="/fixture/">fixture</a><span>Edited · </span><time>19w</time><div><p>Another build using <a href="/brand_a/">@brand_a</a> and <a href="/brand_b/">@brand_b</a>.</p><div>• Processor: <a href="/cpu/">@cpu</a> Model A</div><div>• Memory: <a href="/memory/">@memory</a> 32GB</div><p>Credits <a href="/credit/">@credit</a></p><button>See translation</button></div></${tag}>`;
  const comments = `<${tag}><a href="/commenter/">commenter</a><a href="/p/UNIT_TEST_ONLY/c/123/">Now</a><span dir="auto">Comment must stay out</span></${tag}>`;
  const html = `<article><header><a href="/fixture/">fixture</a> and <a href="/brand_b/">brand_b</a></header><img src="https://scontent.cdninstagram.com/post.jpg"><ul>${body}${comments}</ul><a href="${instagramUrl}"><time>Today</time></a></article>`;
  const fields = capturePost(page(html, instagramUrl), instagramUrl).inspection.fields;
  expect(fields.captionText.value).toBe('Another build using @brand_a and @brand_b.\n• Processor: @cpu Model A\n• Memory: @memory 32GB\nCredits @credit');
  expect(fields.collaboratorHandles.value).toEqual(['fixture', 'brand_b']);
  expect(fields.captionText.value).not.toMatch(/Edited|19w|translation|Comment/);
});

function page(body: string, url: string) {
  const dom = new JSDOM(body, { url }); windows.push(dom);
  const rect = { top: 1, left: 1, right: 301, bottom: 101, width: 300, height: 100, x: 1, y: 1, toJSON: () => ({}) };
  vi.spyOn(dom.window.Element.prototype, 'getBoundingClientRect').mockReturnValue(rect);
  vi.spyOn(dom.window.Element.prototype, 'getClientRects').mockReturnValue({ 0: rect, length: 1, item: () => rect, [Symbol.iterator]: () => [rect][Symbol.iterator]() });
  return dom.window.document;
}
afterEach(() => { windows.splice(0).forEach(dom => dom.window.close()); });

describe('div-based layouts modeled on observed public DOM structure, with synthetic text', () => {
  const instagram = `<main><div class="post"><div class="media"><img src="https://scontent.cdninstagram.com/post.jpg"></div><div class="details">
    <div><a href="/fixture/">fixture</a><button>Following</button></div>
    <div class="entries"><div class="caption"><a href="/fixture/"><img alt="fixture's profile picture" src="https://scontent.cdninstagram.com/avatar.jpg"></a><div><span dir="auto"><div><a href="/fixture/">fixture</a><time>14h</time><span>Real fixture caption<br>Second fixture line</span></div></span></div></div>
    <div class="comment"><a href="/other/">other</a><a href="/p/UNIT_TEST_ONLY/c/123/"><time>12h</time></a><span dir="auto">Do not capture this comment</span><img src="https://scontent.cdninstagram.com/comment.jpg"></div></div>
    <a href="/fixture/p/UNIT_TEST_ONLY/"><time datetime="2026-11-04T00:00:00Z">14 hours ago</time></a>
    <section><div><span role="link"><img alt="" src="https://scontent.cdninstagram.com/composer-avatar.jpg"></span><textarea aria-label="Add a comment"></textarea></div></section></div></div>
    <div><a href="/fixture/p/OTHER/">Suggested post</a></div></main>`;

  it('captures an Instagram div layout without article, header, or h1 and with a username-prefixed permalink', () => {
    const report = capturePost(page(instagram, instagramUrl), instagramUrl).inspection;
    expect(report.fields.captionText.value).toBe('Real fixture caption\nSecond fixture line');
    expect(report.fields.authorHandle.value).toBe('fixture');
    expect(report.fields.imageUrls.value).toEqual(['https://scontent.cdninstagram.com/post.jpg']);
    expect(report.fields.publishedAt.value).toBe('2026-11-04T00:00:00Z');
    expect(JSON.stringify(report.fields)).not.toContain('Do not capture');
  });

  it('matches prefixed Instagram permalinks without accepting comment or likes links', () => {
    const expected = parsePostUrl(instagramUrl);
    expect(samePost('/fixture/p/UNIT_TEST_ONLY/', expected)).toBe(true);
    expect(samePost('/fixture/p/OTHER/', expected)).toBe(false);
    expect(samePost('/p/UNIT_TEST_ONLY/c/123/', expected)).toBe(false);
    expect(samePost('/p/UNIT_TEST_ONLY/liked_by/', expected)).toBe(false);
    expect(samePost('https://instagram.com.evil.tld/fixture/p/UNIT_TEST_ONLY/', expected)).toBe(false);
  });

  const threads = `<main><div><a aria-label="Column title" href="${threadsUrl}">Thread</a></div>
    <div data-pressable-container="true"><div><div><a href="/@fixture">fixture</a><a href="${threadsUrl}"><time>21h</time></a></div>
    <div><span dir="auto"><span>Only the primary Threads fixture text</span></span></div><video src="blob:https://www.threads.com/fixture"></video>
    <a href="/search?q=somewhere">Location</a><div role="button"><span>Like 12</span></div></div></div>
    <div data-pressable-container="true"><a href="/@reply">reply</a><a href="/@reply/post/OTHER/"><time>Now</time></a><span dir="auto">Do not capture this reply</span></div></main>`;

  it('captures a Threads pressable card with plain spans and excludes replies and page chrome', () => {
    const report = capturePost(page(threads, threadsUrl), threadsUrl).inspection;
    expect(report.fields.textContent.value).toBe('Only the primary Threads fixture text');
    expect(report.fields.authorHandle.value).toBe('fixture');
    expect(report.fields.videoUrl.value).toBe('blob:https://www.threads.com/fixture');
    expect(JSON.stringify(report.fields)).not.toContain('Do not capture');
  });

  it('supports a plain div post without a semantic card or time element', () => {
    const html = `<main><div><div><a href="/@fixture">fixture</a><a href="${threadsUrl}">21h</a></div><div><span dir="auto">Visible body fixture</span></div><video src="blob:https://www.threads.com/fixture"></video></div></main>`;
    expect(capturePost(page(html, threadsUrl), threadsUrl).inspection.fields.textContent.value).toBe('Visible body fixture');
  });

  it('refuses ambiguous duplicate matching div cards and does not select page-title links', () => {
    const card = `<div data-pressable-container="true"><a href="/@fixture">fixture</a><a href="${threadsUrl}">21h</a><span dir="auto">Fixture</span></div>`;
    expect(() => capturePost(page(`<main>${card}${card}</main>`, threadsUrl), threadsUrl)).toThrow('More than one');
    const headingOnly = `<main><div><a aria-label="Column title" href="${threadsUrl}">Thread</a></div><div><a href="/@other">other</a><span dir="auto">Unrelated text</span></div></main>`;
    expect(() => capturePost(page(headingOnly, threadsUrl), threadsUrl)).toThrow('adapter limitation');
  });
});

describe('Instagram collaboration, linked captions, and modal scope', () => {
  const card = `<article><header><span><a href="/fixture/">fixture</a> and <a href="/coauthor/">coauthor</a></span><div role="button"><span>Original audio</span></div><a href="/explore/locations/123/test-place/">Test Place</a></header>
    <video src="blob:https://www.instagram.com/test"></video>
    <div><a href="/fixture/">fixture</a><span dir="auto">Fixture caption<br>Credit <a href="/mentioned/">@mentioned</a> and <a href="/explore/tags/test/">#test</a></span></div>
    <div><a href="/commenter/">commenter</a><a href="/p/UNIT_TEST_ONLY/c/123/"><time>Now</time></a><span>Comment only</span><a href="/explore/locations/999/comment-place/">Comment place</a></div>
    <a href="/p/UNIT_TEST_ONLY/"><time datetime="2026-11-04T00:00:00Z">Today</time></a></article>`;

  it('preserves caption mentions and hashtags without treating them as collaborators', () => {
    const fields = capturePost(page(card, instagramUrl), instagramUrl).inspection.fields;
    expect(fields.captionText.value).toBe('Fixture caption\nCredit @mentioned and #test');
    expect(fields.authorHandle.value).toBe('fixture');
    expect(fields.collaboratorHandles.value).toEqual(['fixture', 'coauthor']);
    expect(fields.location.value).toBe('Test Place');
    expect(fields.audioLabel.value).toBe('Original audio');
    expect(fields.audioUrl.value).toBeNull();
    expect(fields.hashtags.value).toEqual(['#test']);
  });

  it('uses the active dialog instead of an identical background post', () => {
    const fields = capturePost(page(`${card}<div role="dialog">${card}</div>`, instagramUrl), instagramUrl).inspection.fields;
    expect(fields.captionText.value).toContain('Fixture caption');
    expect(fields.collaboratorHandles.value).toEqual(['fixture', 'coauthor']);
  });

  it('does not fall back to a background post when the dialog lacks a matching permalink', () => {
    expect(() => capturePost(page(`${card}<div role="dialog"><span>Unrelated dialog</span></div>`, instagramUrl), instagramUrl)).toThrow();
  });
});

it('retains a semantic modal context when its permalink is rendered below the viewport', () => {
  const document = page(`<div role="dialog"><article><header><a href="/fixture/">fixture</a>and<a href="/coauthor/">coauthor</a></header><div><a href="/fixture/">fixture</a><h1>Modal caption <a href="/mentioned/">@mentioned</a></h1></div><video src="blob:https://www.instagram.com/fixture"></video><a id="permalink" href="${instagramUrl}"><time>Today</time></a></article></div>`, instagramUrl);
  Object.defineProperty(document.querySelector('#permalink')!, 'getBoundingClientRect', { value: () => ({ top: 2000, bottom: 2020, left: 1, right: 100, width: 99, height: 20, x: 1, y: 2000, toJSON: () => ({}) }) });
  const fields = capturePost(document, instagramUrl).inspection.fields;
  expect(fields.captionText.value).toBe('Modal caption @mentioned');
  expect(fields.collaboratorHandles.value).toEqual(['fixture', 'coauthor']);
  expect(fields.videoUrl.value).toBe('blob:https://www.instagram.com/fixture');
  expect(fields.publishedAt.value).toBeNull();
});

it('keeps modal post media when comments share a wrapper and reads its interactive caption heading', () => {
  const document = page(`<div role="dialog"><article><div><header><a href="/fixture/">fixture</a></header><video src="blob:https://www.instagram.com/fixture"></video><div role="button"><h1>Caption with <a href="/mentioned/">@mentioned</a></h1></div><div><a href="/p/UNIT_TEST_ONLY/c/1/">Comment</a><img src="https://scontent.cdninstagram.com/comment.jpg"></div><a href="${instagramUrl}"><time>Today</time></a></div></article></div>`, instagramUrl);
  const fields = capturePost(document, instagramUrl).inspection.fields;
  expect(fields.captionText.value).toBe('Caption with @mentioned');
  expect(fields.videoUrl.value).toBe('blob:https://www.instagram.com/fixture');
  expect(fields.imageUrls.value).toBeNull();
});

it('captures a username-prefixed Reel and keeps its video poster as a reference, without inferring the author', () => {
  const url = 'https://www.instagram.com/not_the_author/reel/UNIT_TEST_ONLY/';
  const document = page(`<article><header><a href="/fixture/">fixture</a></header><h1>Video fixture</h1><video src="blob:https://www.instagram.com/fixture" poster="https://scontent.cdninstagram.com/poster.jpg"></video><a href="/reel/UNIT_TEST_ONLY/"><time>Today</time></a></article>`, url);
  const report = capturePost(document, url).inspection;
  expect(report.normalizedUrl).toBe(url);
  expect(report.fields.authorHandle.value).toBe('fixture');
  expect(report.fields.thumbnailUrl).toMatchObject({ value: 'https://scontent.cdninstagram.com/poster.jpg', source: 'browser_media_reference', assetAccess: 'reference_only', processingEligibility: 'unverified' });
  expect(report.fields.imageUrls.value).toBeNull();
  expect(report.aiReadiness.museSpark.find(input => input.modality === 'image')?.technicallyAccessible).toBe(false);
});

it.each(['', 'https://evil.tld/poster.jpg'])('leaves thumbnail unavailable when the video has no supported poster: %s', poster => {
  const document = page(`<article><header><a href="/fixture/">fixture</a></header><h1>Video fixture</h1><video src="blob:https://www.instagram.com/fixture" poster="${poster}"></video><a href="${instagramUrl}"><time>Today</time></a></article>`, instagramUrl);
  const fields = capturePost(document, instagramUrl).inspection.fields;
  expect(fields.thumbnailUrl.value).toBeNull();
  expect(fields.thumbnailUrl.reason).toContain('no supported poster');
  expect(fields.videoUrl.value).toBe('blob:https://www.instagram.com/fixture');
});

it('isolates the single visible Reel player and reads only its visible audio attribution', () => {
  const url = 'https://www.instagram.com/reels/UNIT_TEST_ONLY/';
  const document = page(`<main><div><div><video src="blob:https://www.instagram.com/fixture"></video><a href="/fixture/reels/">fixture</a><a href="/reels/audio/123/">Fixture artist · Fixture song</a><span dir="auto">Fixture caption <a href="/mentioned/">@mentioned</a></span></div></div><div hidden><video src="blob:https://www.instagram.com/other"></video><a href="/other/reels/">other</a><a href="/reels/audio/456/">Other song</a></div></main>`, url);
  for (const video of document.querySelectorAll('video')) Object.defineProperty(video, 'getBoundingClientRect', { value: () => ({ top: 1, left: 1, right: 301, bottom: 501, width: 300, height: 500 }) });
  const fields = capturePost(document, url).inspection.fields;
  expect(fields.authorUrl.value).toBe('https://www.instagram.com/fixture/');
  expect(fields.audioLabel.value).toBe('Fixture artist · Fixture song');
  expect(fields.audioLabel.reason).toContain('/reels/audio/123/');
  expect(fields.audioUrl.value).toBeNull();
  expect(fields.captionText.value).toBe('Fixture caption @mentioned');
  expect(JSON.stringify(fields)).not.toContain('Other song');
});

it('clips snapshot bounds to the viewport and rejects overlays or ambiguous media', () => {
  const document = page(`<article><header><a href="/fixture/">fixture</a></header><h1>Fixture caption</h1><video src="blob:https://www.instagram.com/fixture"></video><a href="${instagramUrl}"><time>Today</time></a></article>`, instagramUrl);
  const video = document.querySelector('video')!;
  Object.defineProperty(video, 'getBoundingClientRect', { value: () => ({ top: -10, left: 10, right: 310, bottom: 190, width: 300, height: 200 }) });
  Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => [video] });
  const candidate = snapshotCandidate(document, instagramUrl);
  expect(candidate?.region).toMatchObject({ x: 10, y: 0, width: 300, height: 190 });
  const overlay = document.createElement('aside'); document.body.append(overlay);
  Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => [overlay] });
  expect(snapshotCandidate(document, instagramUrl)).toBeNull();
  Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => [video] });
  video.after(video.cloneNode());
  expect(snapshotCandidate(document, instagramUrl)).toBeNull();
});

it('refuses to choose between two visible large Reel players', () => {
  const url = 'https://www.instagram.com/reels/UNIT_TEST_ONLY/';
  const card = '<div><video src="blob:https://www.instagram.com/fixture"></video><a href="/fixture/reels/">fixture</a><span dir="auto">Fixture caption</span></div>';
  const document = page(`<main>${card}${card}</main>`, url);
  for (const video of document.querySelectorAll('video')) Object.defineProperty(video, 'getBoundingClientRect', { value: () => ({ top: 1, left: 1, right: 301, bottom: 501, width: 300, height: 500 }) });
  expect(() => capturePost(document, url)).toThrow('unambiguous');
});

describe('caption and music attribution across Instagram permalink layouts', () => {
  const music = '<div role="button"><svg aria-label="Audio"></svg><span>Fixture artist · Fixture song</span></div>';
  it.each(['p', 'reels', 'fixture/reel'])('reads a separate caption and a music control without an audio link on /%s/', path => {
    const url = `https://www.instagram.com/${path}/UNIT_TEST_ONLY/`;
    const permalink = path === 'p' ? `<a href="${url}"><time>Today</time></a>` : '';
    const html = `<main><div><div><video src="blob:https://www.instagram.com/fixture"></video><div><a href="/fixture/reels/">fixture</a>${music}</div></div>
      <div role="button"><span dir="auto">Separate fixture caption<br>Second line <a href="/mentioned/">@mentioned</a><button>more</button></span></div>${permalink}</div></main>`;
    const document = page(html, url);
    Object.defineProperty(document.querySelector('video')!, 'getBoundingClientRect', { value: () => ({ top: 1, left: 1, right: 301, bottom: 501, width: 300, height: 500 }) });
    const fields = capturePost(document, url).inspection.fields;
    expect(fields.captionText.value).toBe('Separate fixture caption\nSecond line @mentioned');
    expect(fields.audioLabel.value).toBe('Fixture artist · Fixture song');
    expect(fields.audioLabel.source).toBe('browser_dom');
    expect(fields.audioUrl.value).toBeNull();
  });

  it('reads a scoped audio link beside a timestamp, without including comment or hidden audio', () => {
    const html = `<article><header><a href="/fixture/">fixture</a><a href="${instagramUrl}"><time>Today</time></a><a href="/reels/audio/123/?utm_source=test">Fixture artist · Fixture song</a></header>
      <h1>Fixture caption</h1><video></video><div><a href="/commenter/">commenter</a><a href="/p/UNIT_TEST_ONLY/c/1/">Comment</a><a href="/reels/audio/456/">Comment music</a>${music.replace('Fixture song', 'Comment song')}</div>
      <div hidden>${music}</div></article>`;
    const fields = capturePost(page(html, instagramUrl), instagramUrl).inspection.fields;
    expect(fields.audioLabel.value).toBe('Fixture artist · Fixture song');
    expect(fields.audioLabel.reason).toContain('/reels/audio/123/');
    expect(fields.captionText.value).toBe('Fixture caption');
  });

  it('keeps unmarked artist-like text and conflicting music controls unavailable', () => {
    const card = (audio: string) => `<article><header><a href="/fixture/">fixture</a>${audio}</header><a href="${instagramUrl}"><time>Today</time></a><h1>Fixture caption</h1></article>`;
    expect(capturePost(page(card('<span>Artist · Song</span>'), instagramUrl), instagramUrl).inspection.fields.audioLabel.value).toBeNull();
    expect(capturePost(page(card(music + music.replace('Fixture song', 'Different song')), instagramUrl), instagramUrl).inspection.fields.audioLabel.value).toBeNull();
  });

  it('does not reuse a plain music row as a missing caption', () => {
    const html = `<article><header><a href="/fixture/">fixture</a></header><div><svg aria-label="Music"></svg><span>Fixture artist · Fixture song</span></div><video></video><a href="${instagramUrl}"><time>Today</time></a></article>`;
    const fields = capturePost(page(html, instagramUrl), instagramUrl).inspection.fields;
    expect(fields.audioLabel.value).toBe('Fixture artist · Fixture song');
    expect(fields.captionText.value).toBeNull();
  });
});
