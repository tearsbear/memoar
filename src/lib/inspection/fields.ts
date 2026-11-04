import type { InspectionFields, InspectedField } from './types';

function missing<T>(reason: string): InspectedField<T> {
  return { value: null, status: 'unavailable', source: 'none', reason, processingEligibility: 'unverified' };
}

export function emptyContentFields(): InspectionFields {
  const reason = 'No permitted content retrieval API is configured. oEmbed is used only for display, not content extraction or AI ingestion.';
  return {
    postId: missing('No post identifier parsed.'),
    authorHandle: missing('The actual author has not been verified through a permitted metadata API.'),
    authorUrl: missing('The actual author profile has not been verified.'),
    collaboratorHandles: missing('No unambiguous collaboration header was observed.'),
    audioLabel: missing('No scoped audio label was observed. An audio label is not an audio file.'),
    captionText: missing(reason), textContent: missing(reason), hashtags: missing(reason),
    mediaType: missing('The URL path does not establish the actual media type or carousel contents.'),
    thumbnailUrl: missing(reason), imageUrls: missing(reason), videoUrl: missing(reason), audioUrl: missing(reason),
    publishedAt: missing('Publication time is not available. Inspection time is a different observation.'),
    location: missing(reason),
  };
}
