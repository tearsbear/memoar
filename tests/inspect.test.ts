import { describe, expect, it, vi } from 'vitest';
import { emptyContentFields, inspectPost } from '../src/lib/inspection/inspect';
import { buildReadiness, evaluateInput, summarizeReadiness } from '../src/lib/inspection/readiness';

describe('normalized observations', () => {
  it('never calls a provider for invalid input', async () => {
    const transport = vi.fn();
    await expect(inspectPost('https://instagram.com.evil.tld/p/ABC', { transport })).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });

  it('keeps display-only content out of normalized JSON and AI inputs', async () => {
    const transport = vi.fn().mockResolvedValue(Response.json({
      html: '<blockquote class="instagram-media" data-instgrm-permalink="https://www.instagram.com/reel/UNIT_TEST_ONLY/"><p>DISPLAY_ONLY_TEXT</p></blockquote>',
      author_name: 'PRIVATE_UPSTREAM_AUTHOR', thumbnail_url: 'https://example.com/PRIVATE_MEDIA', access_token: 'SECRET',
    }));
    const { inspection, display } = await inspectPost('https://instagram.com/reel/UNIT_TEST_ONLY/', { transport, now: () => new Date('2026-11-04T00:00:00Z') });
    expect(display?.html).toContain('DISPLAY_ONLY_TEXT');
    expect(inspection.preview).toMatchObject({ kind: 'official_embed', status: 'available', renderStatus: 'unverified' });
    expect(inspection.inspectedAt).toBe('2026-11-04T00:00:00.000Z');
    expect(inspection.fields.postId).toMatchObject({ value: 'UNIT_TEST_ONLY', source: 'url' });
    expect(inspection.fields.mediaType.value).toBeNull();
    expect(inspection.fields.publishedAt.value).toBeNull();
    const exported = JSON.stringify(inspection);
    expect(exported).not.toMatch(/DISPLAY_ONLY_TEXT|PRIVATE_UPSTREAM_AUTHOR|PRIVATE_MEDIA|SECRET|<blockquote/);
    for (const field of Object.values(inspection.fields).slice(1)) expect(field.value).toBeNull();
    for (const inputs of Object.values(inspection.aiReadiness)) expect(inputs.every(input => input.status === 'blocked')).toBe(true);
    expect(JSON.parse(exported)).toEqual(inspection);
  });

  it('keeps a useful partial result after a provider failure without leaking its message', async () => {
    const result = await inspectPost('https://threads.net/@example/post/UNIT_TEST_ONLY/', { transport: async () => { throw new Error('SECRET upstream body'); } });
    expect(result.inspection.status).toBe('partial');
    expect(result.inspection.fields.postId.value).toBe('UNIT_TEST_ONLY');
    expect(result.inspection.fields.authorHandle.value).toBeNull();
    expect(result.inspection.preview.kind).toBe('source_link');
    expect(result.inspection.attempts.some(attempt => attempt.outcome === 'failed')).toBe(true);
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });

  it('explains disabled display and unverified video patterns without fetching', async () => {
    const transport = vi.fn();
    const disabled = await inspectPost('https://instagram.com/p/UNIT_TEST_ONLY/', { transport, displayEnabled: false });
    const video = await inspectPost('https://facebook.com/watch/?v=123', { transport });
    expect(disabled.inspection.preview.status).toBe('not_configured');
    expect(video.inspection.preview.status).toBe('not_configured');
    expect(transport).not.toHaveBeenCalled();
  });
});

describe('readiness evidence rules', () => {
  const permitted = { access: 'available' as const, processingEligibility: 'allowed' as const, formatSupported: true, sourceFields: ['textContent'] };
  it('requires confirmed access, format and permission', () => {
    expect(evaluateInput('text', permitted).status).toBe('ready');
    expect(evaluateInput('text', { ...permitted, processingEligibility: 'unverified' }).status).toBe('unknown');
    expect(evaluateInput('text', { ...permitted, processingEligibility: 'not_allowed' }).status).toBe('blocked');
    expect(evaluateInput('text', { ...permitted, formatSupported: null }).status).toBe('unknown');
    expect(evaluateInput('text', { ...permitted, formatSupported: false }).status).toBe('blocked');
    expect(evaluateInput('text', { ...permitted, access: 'missing' }).status).toBe('blocked');
    expect(evaluateInput('text', { ...permitted, access: 'unknown' }).status).toBe('unknown');
  });

  it('does not treat a direct media URL as proof of accessible bytes or format', () => {
    const fields = emptyContentFields();
    fields.imageUrls = { value: ['https://example.com/image.jpg'], status: 'available', source: 'official_api', reason: null, processingEligibility: 'allowed' };
    expect(buildReadiness(fields).museSpark.find(item => item.modality === 'image')).toMatchObject({ status: 'unknown', technicallyAccessible: false });
  });

  it('preserves unknown and distinguishes empty arrays from unavailable values', () => {
    const fields = emptyContentFields();
    expect(fields.imageUrls.value).toBeNull();
    fields.imageUrls = { value: [], status: 'available', source: 'official_api', reason: 'Confirmed no images.', processingEligibility: 'allowed' };
    expect(buildReadiness(fields).museSpark.find(item => item.modality === 'image')?.status).toBe('blocked');
    fields.audioUrl.status = 'unknown';
    expect(buildReadiness(fields).museVoiceTranscribe[0].status).toBe('unknown');
  });

  it('summarizes partial readiness without promoting uncertainty', () => {
    const ready = evaluateInput('text', permitted);
    const blocked = evaluateInput('image', { ...permitted, access: 'missing' });
    const unknown = evaluateInput('audio', { ...permitted, access: 'unknown' });
    expect(summarizeReadiness([ready, blocked])).toBe('partial');
    expect(summarizeReadiness([unknown, blocked])).toBe('unknown');
    expect(summarizeReadiness([blocked])).toBe('blocked');
    expect(summarizeReadiness([])).toBe('unknown');
  });
});
