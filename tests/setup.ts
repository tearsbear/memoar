import { afterEach, beforeEach, expect, vi } from 'vitest';

const forbiddenFetch = vi.fn(() => { throw new Error('Live network requests are forbidden in unit tests. Inject a transport fixture.'); });

beforeEach(() => {
  forbiddenFetch.mockClear();
  vi.stubGlobal('fetch', forbiddenFetch);
});

afterEach(() => {
  expect(forbiddenFetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
