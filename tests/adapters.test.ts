import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchEmbed, sanitizeEmbed } from '../src/lib/inspection/adapters';
import { parsePostUrl } from '../src/lib/inspection/parse-url';

const parsed = parsePostUrl('https://www.instagram.com/reel/UNIT_TEST_ONLY/');
const html = '<blockquote class="instagram-media" data-instgrm-permalink="https://www.instagram.com/reel/UNIT_TEST_ONLY/"><p>Unit test fixture</p></blockquote>';
const json = (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' }, ...init });

afterEach(() => vi.useRealTimers());

describe('bounded official display transport', () => {
  it.each([
    ['https://threads.net/@example/post/UNIT_TEST_ONLY/', 'graph.threads.com', '/oembed', '<blockquote class="text-post-media" data-text-post-permalink="https://www.threads.com/@example/post/UNIT_TEST_ONLY/"></blockquote>'],
    ['https://facebook.com/example/posts/UNIT_TEST_ONLY/', 'graph.facebook.com', '/v25.0/oembed_post', '<div class="fb-post" data-href="https://www.facebook.com/example/posts/UNIT_TEST_ONLY/"></div>'],
    ['https://facebook.com/reel/12345/', 'graph.facebook.com', '/v25.0/oembed_video', '<div class="fb-video" data-href="https://www.facebook.com/reel/12345/"></div>'],
  ])('uses the matching official display adapter for %s', async (input, hostname, pathname, markup) => {
    const transport = vi.fn().mockResolvedValue(json({ html: markup }));
    expect(await fetchEmbed(parsePostUrl(input), transport)).toBeTruthy();
    expect(transport.mock.calls[0][0]).toMatchObject({ hostname, pathname });
  });

  it('only calls the fixed official endpoint, disables redirects and caching', async () => {
    const transport = vi.fn().mockResolvedValue(json({ html, author_name: 'DO_NOT_EXTRACT', thumbnail_url: 'https://example.com/asset.jpg' }));
    expect(await fetchEmbed(parsed, transport)).toContain('instagram-media');
    const [url, options] = transport.mock.calls[0];
    expect(url.origin).toBe('https://graph.facebook.com');
    expect(url.pathname).toBe('/v25.0/instagram_oembed');
    expect(url.searchParams.get('url')).toBe(parsed.normalizedUrl);
    expect(options).toMatchObject({ method: 'GET', redirect: 'error', cache: 'no-store' });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403, 404, 429, 503])('handles HTTP %s without making claims about privacy or deletion', async status => {
    const transport = vi.fn().mockResolvedValue(json({ error: 'sensitive upstream body' }, { status }));
    await expect(fetchEmbed(parsed, transport)).rejects.toThrow(status === 429 ? 'rate limited' : `HTTP ${status}`);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('does not follow a redirect', async () => {
    const transport = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: 'http://127.0.0.1' } }));
    await expect(fetchEmbed(parsed, transport)).rejects.toThrow('redirects are not followed');
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('times out even if the transport ignores cancellation', async () => {
    vi.useFakeTimers();
    const promise = fetchEmbed(parsed, () => new Promise(() => {}));
    const assertion = expect(promise).rejects.toThrow('8 seconds');
    await vi.advanceTimersByTimeAsync(8000);
    await assertion;
  });

  it('bounds the body stream as well as advertised content length', async () => {
    const large = new Uint8Array(1024 * 1024 + 1);
    await expect(fetchEmbed(parsed, async () => new Response(large, { headers: { 'content-type': 'application/json' } }))).rejects.toThrow('1 MiB');
    await expect(fetchEmbed(parsed, async () => new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '1048577' } }))).rejects.toThrow('1 MiB');
  });

  it.each([
    new Response('<html>Not API data</html>', { headers: { 'content-type': 'text/html' } }),
    new Response('{bad json', { headers: { 'content-type': 'application/json' } }),
    json({ html: '' }), json({ html: '<script>alert(1)</script>' }), json({ html: '<p>No embed</p>' }),
  ])('rejects unexpected response content', async response => {
    await expect(fetchEmbed(parsed, async () => response)).rejects.toThrow();
  });

  it('redacts upstream errors', async () => {
    await expect(fetchEmbed(parsed, async () => { throw new Error('access_token=SECRET'); })).rejects.not.toThrow('SECRET');
  });
});

describe('embed sanitization', () => {
  it('removes scripts, images, event handlers, arbitrary styles and unsafe URLs', () => {
    const sanitized = sanitizeEmbed(`${html}<script src="https://evil.tld/run.js">SECRET_SCRIPT</script><img src="http://localhost/private" onerror="attack()"><a href="javascript:attack()" onclick="attack()">link</a><div style="background:url(http://localhost)">x</div>`, 'instagram');
    expect(sanitized).toContain('instagram-media');
    expect(sanitized).not.toMatch(/<script|SECRET_SCRIPT|<img|onerror|onclick|javascript:|style=/);
  });

  it('allows only provider display URLs and fixed Facebook plugin iframe paths', () => {
    const sanitized = sanitizeEmbed('<div class="fb-post" data-href="https://facebook.com.evil.tld/x"></div><iframe src="http://127.0.0.1/"></iframe><iframe src="https://www.facebook.com/settings"></iframe><iframe src="https://www.facebook.com/plugins/post.php?href=https%3A%2F%2Fwww.facebook.com%2Fx%2Fposts%2F123"></iframe>', 'facebook');
    expect(sanitized).not.toContain('evil.tld');
    expect(sanitized).not.toContain('127.0.0.1');
    expect(sanitized).not.toContain('/settings');
    expect(sanitized.match(/<iframe/g)).toHaveLength(1);
    expect(sanitized).toContain('Official post preview');
  });

  it('rejects embed markers stripped of their permalink and unsafe nested iframe hrefs', () => {
    expect(sanitizeEmbed('<blockquote class="instagram-media" data-instgrm-permalink="https://evil.tld/post">text</blockquote>', 'instagram')).toBe('');
    expect(sanitizeEmbed('<iframe src="https://www.facebook.com/plugins/post.php?href=http%3A%2F%2F127.0.0.1"></iframe>', 'facebook')).toBe('');
  });
});
