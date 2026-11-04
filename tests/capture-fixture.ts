import { emptyContentFields } from '../src/lib/inspection/fields';

export function captureFixture() {
  const fields = emptyContentFields();
  fields.postId = { value: 'UNIT_TEST_ONLY', status: 'available', source: 'url', reason: null, processingEligibility: 'unverified' };
  fields.captionText = { value: 'Fixture caption #test', status: 'available', source: 'browser_dom', reason: 'Observed test fixture.', processingEligibility: 'unverified' };
  return { version: 1, inspection: { inspectionMethod: 'extension', platform: 'instagram',
    normalizedUrl: 'https://www.instagram.com/p/UNIT_TEST_ONLY/', inspectedAt: '2026-11-04T00:00:00.000Z', fields, warnings: [] as string[] } };
}
