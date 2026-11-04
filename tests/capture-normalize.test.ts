import { describe, expect, it } from 'vitest';
import { deriveHashtags, normalizeCapture, parseCaptureJson, validateMediaReference } from '../src/lib/capture/normalize';
import { captureFixture } from './capture-fixture';

describe('capture normalization', () => {
  it('preserves Unicode hashtags, numbers and underscores without duplicates', () => {
    expect(deriveHashtags('#memoar #日本語 #العربية #кириллица #𐐀test #2026_update #memoar 😀'))
      .toEqual(['#memoar', '#日本語', '#العربية', '#кириллица', '#𐐀test', '#2026_update']);
  });

  it('roundtrips through JSON without accumulating warnings or trusting derived claims', () => {
    const raw = captureFixture();
    Object.assign(raw.inspection, { aiReadiness: { museSpark: [{ status: 'ready' }] }, preview: { html: '<script>attack()</script>' }, cookie: 'SECRET' });
    raw.inspection.fields.captionText.processingEligibility = 'allowed';
    const capture = normalizeCapture(raw);
    expect(parseCaptureJson(JSON.stringify(capture))).toEqual(capture);
    expect(capture.inspection.fields.captionText.processingEligibility).toBe('unverified');
    expect(capture.inspection.aiReadiness.museSpark[0]).toMatchObject({ status: 'unknown', technicallyAccessible: true });
    expect(capture.inspection.fields.hashtags.value).toEqual(['#test']);
    expect(JSON.stringify(capture)).not.toMatch(/SECRET|attack|<script/);
  });

  it('validates post identity and capture source', () => {
    const raw = captureFixture();
    raw.inspection.fields.postId.value = 'OTHER';
    expect(() => normalizeCapture(raw)).toThrow('post ID');
    const wrong = captureFixture(); wrong.inspection.platform = 'threads';
    expect(() => normalizeCapture(wrong)).toThrow('platform');
    const source = captureFixture(); source.inspection.fields.captionText.source = 'official_api';
    expect(() => normalizeCapture(source)).toThrow('source');
  });

  it('enforces byte, text, image-count, URL and reason bounds without silent truncation', () => {
    expect(() => parseCaptureJson(' '.repeat(256 * 1024 + 1))).toThrow('256 KiB');
    const text = captureFixture(); text.inspection.fields.captionText.value = 'x'.repeat(32001);
    expect(() => normalizeCapture(text)).toThrow('size limit');
    const images = captureFixture();
    images.inspection.fields.imageUrls = { value: Array(21).fill('https://scontent.cdninstagram.com/image.jpg'), status: 'available', source: 'browser_media_reference', reason: null, processingEligibility: 'unverified' };
    expect(() => normalizeCapture(images)).toThrow('20 image');
    expect(() => validateMediaReference('https://scontent.cdninstagram.com/' + 'x'.repeat(4096), 'instagram')).toThrow('size limit');
    const reason = captureFixture(); reason.inspection.fields.captionText.reason = 'x'.repeat(1001);
    expect(() => normalizeCapture(reason)).toThrow('size limit');
  });

  it.each(['https://cdninstagram.com.evil.tld/image', 'http://127.0.0.1/image', 'data:image/png;base64,abc', 'blob:https://evil.tld/id', 'https://scontent.fbcdn.net/x?access_token=SECRET'])('rejects unsafe media references: %s', input => {
    expect(() => validateMediaReference(input, 'instagram')).toThrow();
  });

  it('keeps media as references and rejects an author URL with credentials', () => {
    const raw = captureFixture();
    raw.inspection.fields.videoUrl = { value: 'blob:https://www.instagram.com/fixture', status: 'available', source: 'browser_media_reference', reason: null, processingEligibility: 'allowed', assetAccess: 'verified_accessible' };
    const capture = normalizeCapture(raw);
    expect(capture.inspection.fields.videoUrl).toMatchObject({ assetAccess: 'reference_only', processingEligibility: 'unverified' });
    expect(capture.inspection.aiReadiness.museSpark.find(input => input.modality === 'video')).toMatchObject({ technicallyAccessible: false, status: 'unknown' });
    raw.inspection.fields.authorUrl = { value: 'https://secret@www.instagram.com/example/', status: 'available', source: 'browser_dom', reason: null, processingEligibility: 'unverified' };
    expect(() => normalizeCapture(raw)).toThrow('author');
  });

  it('does not derive hashtags from unobserved content', () => {
    const raw = captureFixture(); raw.inspection.fields.captionText = { value: null, status: 'unavailable', source: 'none', reason: 'No visible text.', processingEligibility: 'unverified' };
    raw.inspection.fields.hashtags = { value: ['#invented'], status: 'available', source: 'browser_dom', reason: null, processingEligibility: 'unverified' };
    expect(normalizeCapture(raw).inspection.fields.hashtags.value).toBeNull();
  });
});
