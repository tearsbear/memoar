import { describe, expect, it } from 'vitest';
import { parsePostUrl, UrlValidationError } from '../src/lib/inspection/parse-url';

describe('provider URL parsing', () => {
  it.each([
    ['https://instagram.com/p/Example_1/', 'instagram', 'Example_1', 'post', true],
    ['https://www.instagram.com/reel/Example-2', 'instagram', 'Example-2', 'post', true],
    ['https://www.instagram.com/example.name/reel/Example-2/', 'instagram', 'Example-2', 'post', true],
    ['https://www.instagram.com/example.name/p/Example_1/', 'instagram', 'Example_1', 'post', true],
    ['https://threads.net/@example/post/Example_3', 'threads', 'Example_3', 'post', true],
    ['https://www.threads.com/t/Example_4/', 'threads', 'Example_4', 'post', true],
    ['https://m.facebook.com/example/posts/pfbidExample/', 'facebook', 'pfbidExample', 'post', true],
    ['https://facebook.com/reel/12345/', 'facebook', '12345', 'video', true],
    ['https://facebook.com/example/videos/12345', 'facebook', '12345', 'video', false],
    ['https://facebook.com/watch/?v=12345', 'facebook', '12345', 'video', false],
  ])('parses %s without inferring content', (url, platform, postId, route, previewSupported) => {
    expect(parsePostUrl(url)).toMatchObject({ platform, postId, route, previewSupported });
  });

  it('removes known tracking, preserves identifiers and unknown parameters', () => {
    expect(parsePostUrl(' https://m.facebook.com/watch?v=123&fbclid=tracking&custom=yes#fragment ').normalizedUrl)
      .toBe('https://www.facebook.com/watch/?custom=yes&v=123');
    expect(parsePostUrl('https://threads.net/@example/post/ABC?igsh=tracking').normalizedUrl)
      .toBe('https://www.threads.com/@example/post/ABC/');
  });

  it('preserves the username prefix for display without changing the identifier or claiming an author', () => {
    const id = 'DXExtkWCYdb5cCZLZhAo2p26Qan8RceERUaSS00';
    const result = parsePostUrl(`https://www.instagram.com/jiaanandka/reel/${id}/?utm_source=test&custom=yes#fragment`);
    expect(result.normalizedUrl).toBe(`https://www.instagram.com/jiaanandka/reel/${id}/?custom=yes`);
    expect(result.postId).toBe(id);
    expect(result).not.toHaveProperty('authorHandle');
  });

  it.each([
    '', 'not a url', 'http://instagram.com/p/ABC/', 'https://instagram.com.evil.tld/p/ABC/',
    'https://evilinstagram.com/p/ABC/', 'https://localhost/p/ABC/', 'https://127.0.0.1/p/ABC/',
    'https://[::1]/p/ABC/', 'https://user:pass@instagram.com/p/ABC/',
    'https://instagram.com:444/p/ABC/', 'https://instagram.com\\@evil.tld/p/ABC/',
    'https://instagram.com/p/ABC/?access_token=secret', 'https://instagram.com/p/ABC/?api_key=secret',
    'https://instagram.com/p/AB\nC/', 'https://facebook.com/watch/?v=123&v=456',
  ])('rejects invalid or unsafe input: %s', input => {
    expect(() => parsePostUrl(input)).toThrow(UrlValidationError);
  });

  it.each([
    'https://instagram.com/example/', 'https://instagram.com/stories/example/123/',
    'https://instagram.com/p/ABC/more/', 'https://threads.com/@example/',
    'https://instagram.com/example/reel/ABC/comments/', 'https://instagram.com/example/p/ABC/c/123/',
    'https://facebook.com/share/r/123/', 'https://facebook.com/watch/?v=not-an-id',
    'https://facebook.com/permalink.php?story_fbid=123&id=456',
  ])('distinguishes unsupported paths: %s', input => {
    try { parsePostUrl(input); throw new Error('Expected validation to fail'); }
    catch (error) { expect(error).toMatchObject({ code: 'unsupported_path' }); }
  });

  it('rejects nonstring and excessively long input', () => {
    expect(() => parsePostUrl({ url: 'https://instagram.com/p/ABC/' })).toThrow();
    expect(() => parsePostUrl(`https://instagram.com/p/${'A'.repeat(2048)}`)).toThrow();
  });
});

it('accepts the plural Reels permalink, preserves its full ID, and still rejects the Reels feed/audio routes', () => {
  const id = 'DVYYn2kkq6_rcgQ6wi2jZNJSKKFiwh_VrJiJ240';
  expect(parsePostUrl(`https://www.instagram.com/reels/${id}/`).normalizedUrl).toBe(`https://www.instagram.com/reel/${id}/`);
  for (const path of ['/reels/', '/reels/audio/123/', '/reels/ID/extra/', '/somebody/reels/']) expect(() => parsePostUrl(`https://www.instagram.com${path}`)).toThrow();
});
