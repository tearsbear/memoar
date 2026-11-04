import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { POST } from '../src/app/api/inspect/route';

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://localhost:3000/api/inspect', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
}

describe('inspection route without an application server', () => {
  it('revalidates URL input on the server', async () => {
    const response = await POST(request({ url: 'https://instagram.com.evil.tld/p/UNIT_TEST_ONLY/' }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'unsupported_host' } });
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it.each([null, [], {}, { url: 42 }])('rejects invalid body shapes: %s', async body => {
    expect((await POST(request(body))).status).toBe(400);
  });

  it('rejects secret-bearing URL input without echoing the secret', async () => {
    const response = await POST(request({ url: 'https://instagram.com/p/UNIT_TEST_ONLY/?access_token=SECRET' }));
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain('SECRET');
  });

  it('rejects cross-origin, invalid JSON, non-JSON and oversized bodies', async () => {
    expect((await POST(request({}, { origin: 'https://evil.tld' }))).status).toBe(403);
    expect((await POST(new Request('http://localhost:3000/api/inspect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{invalid' }))).status).toBe(400);
    expect((await POST(request({}, { 'content-type': 'text/plain' }))).status).toBe(400);
    expect((await POST(request({ url: 'A'.repeat(9000) }))).status).toBe(400);
  });

  it('returns normalized observations with official display disabled and no network', async () => {
    vi.stubEnv('MEMOAR_EMBEDS_ENABLED', 'false');
    const response = await POST(request({ url: 'https://threads.net/@example/post/UNIT_TEST_ONLY/' }));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.display).toBeNull();
    expect(data.inspection.preview.status).toBe('not_configured');
    expect(data.inspection.fields.postId.source).toBe('url');
    expect(data.inspection.fields.captionText.value).toBeNull();
  });
});
