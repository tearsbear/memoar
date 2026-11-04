import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { capturePost, captureWithRetry } from '../extension/capture-post';

const url = 'https://www.instagram.com/p/UNIT_TEST_ONLY/';
const body = `<main><article><header><a href="/fixture_author/">fixture_author</a><img src="https://scontent.cdninstagram.com/avatar.jpg"></header>
<a href="${url}"><time datetime="2026-11-04T00:00:00Z">Today</time></a><h1>Visible fixture #caption</h1>
<img src="https://scontent.cdninstagram.com/post.jpg"><aside><h1>Suggested text</h1></aside>
<div role="comment">Comment fixture<img src="https://scontent.cdninstagram.com/comment.jpg"></div><div hidden><h1>Hidden text</h1></div></article></main>`;
const windows: JSDOM[] = [];

function page(html = body, sourceUrl = url) {
  const dom = new JSDOM(html, { url: sourceUrl }); windows.push(dom);
  const rect = { top: 1, left: 1, right: 301, bottom: 101, width: 300, height: 100, x: 1, y: 1, toJSON: () => ({}) };
  vi.spyOn(dom.window.Element.prototype, 'getBoundingClientRect').mockReturnValue(rect);
  vi.spyOn(dom.window.Element.prototype, 'getClientRects').mockReturnValue({ 0: rect, length: 1, item: () => rect, [Symbol.iterator]: () => [rect][Symbol.iterator]() });
  return dom.window.document;
}
afterEach(() => { for (const window of windows.splice(0)) window.window.close(); });

describe('one-time visible DOM capture with synthetic fixtures only', () => {
  it('separates the post from comments, hidden text, avatars, and recommendations', () => {
    const result = capturePost(page(), url).inspection;
    expect(result.fields.captionText.value).toBe('Visible fixture #caption');
    expect(result.fields.authorHandle.value).toBe('fixture_author');
    expect(result.fields.imageUrls.value).toEqual(['https://scontent.cdninstagram.com/post.jpg']);
    expect(result.fields.publishedAt.value).toBe('2026-11-04T00:00:00Z');
    expect(result.fields.imageUrls.assetAccess).toBe('reference_only');
    expect(result.aiReadiness.museSpark[0].status).toBe('unknown');
  });

  it('refuses feeds, mismatching posts, and duplicate matching contexts', () => {
    expect(() => capturePost(page(), 'https://www.instagram.com/')).toThrow();
    expect(() => capturePost(page(body.replaceAll('UNIT_TEST_ONLY', 'OTHER')), url)).toThrow('unambiguous');
    expect(() => capturePost(page(body + body), url)).toThrow('More than one');
    expect(() => capturePost(page(`<link rel="canonical" href="${url}"><main><article><h1>Unrelated text without an associated permalink</h1></article></main>`), url)).toThrow('unambiguous');
  });

  it('does not choose an unrelated article over the matching post', () => {
    const unrelated = '<article><a href="/p/OTHER/"><time>Other</time></a><h1>Wrong post</h1></article>';
    expect(capturePost(page(unrelated + body), url).inspection.fields.captionText.value).toBe('Visible fixture #caption');
  });

  it('accepts a unique caption heading in the first author-associated list entry', () => {
    const html = body.replace('<h1>Visible fixture #caption</h1>', '<ul><li><a href="/fixture_author/">fixture_author</a><h1>Caption fixture</h1></li><li><a href="/other/">other</a><span>Comment</span></li></ul>');
    expect(capturePost(page(html), url).inspection.fields.captionText.value).toBe('Caption fixture');
    expect(capturePost(page(html.replace('<a href="/fixture_author/">fixture_author</a><h1>', '<a href="/other/">other</a><h1>')), url).inspection.fields.captionText.value).toBeNull();
  });

  it('keeps rendered carousel-list media but excludes nested-post media', () => {
    const html = body.replace('<img src="https://scontent.cdninstagram.com/post.jpg">', '<ul><li><img src="https://scontent.cdninstagram.com/slide.jpg"></li></ul><article><img src="https://scontent.cdninstagram.com/another-post.jpg"></article>');
    expect(capturePost(page(html), url).inspection.fields.imageUrls.value).toEqual(['https://scontent.cdninstagram.com/slide.jpg']);
  });

  it('keeps caption truncation explicit, and does not read clipped hidden text', () => {
    const truncated = capturePost(page(body.replace('Visible fixture #caption', 'Visible fixture…')), url);
    expect(truncated.inspection.fields.captionText.reason).toContain('Completeness is unverified');
    const clipped = page(body); (clipped.querySelector('h1') as HTMLElement).style.textOverflow = 'ellipsis';
    expect(capturePost(clipped, url).inspection.fields.captionText.value).toBeNull();
  });

  it('preserves visible caption line breaks without including more-button text', () => {
    const html = body.replace('Visible fixture #caption', 'First fixture line<br>Second fixture line<button>more</button>');
    expect(capturePost(page(html), url).inspection.fields.captionText.value).toBe('First fixture line\nSecond fixture line');
  });

  it('reports only observed carousel references and blob video access', () => {
    const carousel = capturePost(page(body.replace('</article>', '<button aria-label="Next">Next</button></article>')), url).inspection;
    expect(carousel.fields.mediaType.value).toBe('carousel');
    expect(carousel.fields.imageUrls.value).toHaveLength(1);
    expect(carousel.warnings.join(' ')).toContain('remaining media are unknown');
    const reel = capturePost(page(body.replace('<img src="https://scontent.cdninstagram.com/post.jpg">', '<video src="blob:https://www.instagram.com/fixture"></video>')), url).inspection;
    expect(reel.fields.videoUrl.assetAccess).toBe('reference_only');
    expect(reel.fields.mediaType.value).toBe('video');
    expect(reel.aiReadiness.sam31.every(input => input.status !== 'ready')).toBe(true);
    expect(reel.fields.audioUrl.value).toBeNull();
  });

  it.each([
    ['https://www.threads.com/@fixture/post/UNIT_TEST_ONLY/', '<div data-testid="post-text">Threads fixture</div>', 'Threads fixture'],
    ['https://www.facebook.com/fixture/posts/UNIT_TEST_ONLY/', '<div data-ad-preview="message">Facebook fixture</div>', 'Facebook fixture'],
  ])('returns conservative platform text for %s', (sourceUrl, text, expected) => {
    const html = `<main><article><a href="${sourceUrl}"><time>Now</time></a>${text}<div role="comment">Unrelated reply</div></article></main>`;
    expect(capturePost(page(html, sourceUrl), sourceUrl).inspection.fields.textContent.value).toBe(expected);
  });

  it('bounds retries and discards a result after navigation', async () => {
    const doc = page();
    const missingText = capturePost(page(body.replace('<h1>Visible fixture #caption</h1>', '')), url);
    const read = vi.fn().mockReturnValue(missingText);
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(captureWithRetry(doc, url, { read, sleep })).resolves.toEqual(missingText);
    expect(read).toHaveBeenCalledTimes(3); expect(sleep).toHaveBeenCalledTimes(2);
    const getUrl = vi.fn().mockReturnValueOnce(url).mockReturnValue('https://www.instagram.com/p/OTHER/');
    await expect(captureWithRetry(doc, url, { read, sleep, getUrl })).rejects.toThrow('navigated');
  });
});
