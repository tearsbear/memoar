import { fetchEmbed, RetrievalError, type FetchTransport } from './adapters';
import { parsePostUrl } from './parse-url';
import { buildReadiness } from './readiness';
import type { InspectionResponse } from './types';
import { emptyContentFields } from './fields';
export { emptyContentFields } from './fields';

export async function inspectPost(input: unknown, options: { transport?: FetchTransport; now?: () => Date; displayEnabled?: boolean } = {}): Promise<InspectionResponse> {
  const parsed = parsePostUrl(input);
  const fields = emptyContentFields();
  fields.postId = { value: parsed.postId, status: 'available', source: 'url', reason: 'Identifier parsed from the URL; post existence has not been verified.', processingEligibility: 'unverified' };
  const inspection: InspectionResponse['inspection'] = {
    inspectionMethod: 'url',
    platform: parsed.platform, inputUrl: parsed.inputUrl, normalizedUrl: parsed.normalizedUrl,
    inspectedAt: (options.now?.() ?? new Date()).toISOString(), status: 'partial', fields,
    preview: { kind: 'source_link', status: 'unavailable', renderStatus: 'unverified', reason: null },
    aiReadiness: buildReadiness(fields),
    attempts: [{ method: 'url_parser', outcome: 'success', reason: 'Recognized the platform and identifier. This does not verify the post or its author.' }],
    warnings: [
      'Preview HTML is display-only and excluded from this normalized inspection JSON.',
      'An official embed does not provide direct image, video, or audio input for AI.',
      'No post content is persisted and no AI model is called.',
    ],
  };
  let display: InspectionResponse['display'] = null;
  if (options.displayEnabled === false || !parsed.previewSupported) {
    const reason = options.displayEnabled === false
      ? 'Official embeds are disabled in this installation (MEMOAR_EMBEDS_ENABLED=false).'
      : 'This Facebook video URL is parsed, but this preview pattern has not been verified against the official integration reference. Open the original post.';
    inspection.preview = { kind: 'source_link', status: 'not_configured', renderStatus: 'unverified', reason };
    inspection.attempts.push({ method: 'official_oembed_display', outcome: 'skipped', reason });
  } else {
    try {
      const html = await fetchEmbed(parsed, options.transport);
      display = { provider: parsed.platform, html };
      inspection.preview = { kind: 'official_embed', status: 'available', renderStatus: 'unverified', reason: 'Official embed markup was received for display. Browser rendering and playback are not verified.' };
      inspection.attempts.push({ method: 'official_oembed_display', outcome: 'success', reason: 'Received and sanitized display-only markup. No metadata was extracted from the response.' });
    } catch (error) {
      const failure = error instanceof RetrievalError ? error : new RetrievalError('error', 'The official preview could not be prepared.');
      inspection.preview = { kind: 'source_link', status: failure.status, renderStatus: 'unverified', reason: failure.message };
      inspection.attempts.push({ method: 'official_oembed_display', outcome: 'failed', reason: failure.message });
    }
  }
  inspection.attempts.push({ method: 'official_content_metadata', outcome: 'skipped', reason: 'No credentialed content API is configured. Display-only oEmbed metadata is not ingested.' });
  inspection.attempts.push({ method: 'ai_payload_evaluation', outcome: 'success', reason: 'Evaluated payload readiness locally. No model request was sent.' });
  return { inspection, display };
}
