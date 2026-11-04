import { describe, expect, it } from 'vitest';
import { instagramPreviewUrl } from '../src/lib/inspection/instagram-preview';
import { normalizeCapture } from '../src/lib/capture/normalize';
import { captureFixture } from './capture-fixture';

describe('display-only Instagram iframe URL', () => {
  it('preserves a supplied username and the entire post ID without making it an author field', () => {
    const raw = captureFixture();
    raw.inspection.normalizedUrl = 'https://www.instagram.com/supplied/reel/UNIT_TEST_ONLY/?igsh=tracking';
    const { inspection } = normalizeCapture(raw);
    expect(instagramPreviewUrl(inspection)).toBe('https://www.instagram.com/supplied/reel/UNIT_TEST_ONLY/embed/');
    expect(inspection.fields.authorHandle.value).toBeNull();
  });

  it.each(['p', 'reels'])('uses the DOM-observed profile and video evidence for /%s/ captures', path => {
    const { inspection } = normalizeCapture(captureFixture());
    inspection.normalizedUrl = `https://www.instagram.com/${path}/UNIT_TEST_ONLY/`;
    inspection.fields.authorUrl = { ...inspection.fields.authorUrl, value: 'https://www.instagram.com/observed/', source: 'browser_dom', status: 'available' };
    inspection.fields.mediaType = { ...inspection.fields.mediaType, value: 'video', source: 'browser_dom', status: 'available' };
    expect(instagramPreviewUrl(inspection)).toBe('https://www.instagram.com/observed/reel/UNIT_TEST_ONLY/embed/');
  });

  it('does not infer video or author from a bare post URL and respects disabled embeds', () => {
    const { inspection } = normalizeCapture(captureFixture());
    expect(instagramPreviewUrl(inspection)).toBeNull();
    inspection.fields.mediaType.value = 'video';
    inspection.fields.authorUrl.value = 'https://evil.tld/forged/';
    inspection.fields.authorUrl.source = 'browser_dom';
    expect(instagramPreviewUrl(inspection)).toBe('https://www.instagram.com/reel/UNIT_TEST_ONLY/embed/');
    inspection.preview.reason = 'Official embeds are disabled in this installation (MEMOAR_EMBEDS_ENABLED=false).';
    expect(instagramPreviewUrl(inspection)).toBeNull();
    inspection.platform = 'threads';
    expect(instagramPreviewUrl(inspection)).toBeNull();
  });
});
