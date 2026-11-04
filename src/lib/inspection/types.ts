export type Platform = 'instagram' | 'threads' | 'facebook';
export type FieldStatus = 'available' | 'unavailable' | 'restricted' | 'unsupported' | 'unknown';
export type ProcessingEligibility = 'allowed' | 'not_allowed' | 'unverified';
export type Readiness = 'ready' | 'partial' | 'blocked' | 'unknown';
export type Modality = 'text' | 'image' | 'video' | 'audio';
export type Model = 'museSpark' | 'sam31' | 'museVoiceTranscribe';

export type InspectedField<T> = {
  value: T | null;
  status: FieldStatus;
  source: 'url' | 'official_api' | 'none' | 'browser_dom' | 'browser_media_reference';
  reason: string | null;
  processingEligibility: ProcessingEligibility;
  assetAccess?: 'reference_only' | 'verified_accessible' | 'unavailable' | 'unverified';
};

export type InspectionFields = {
  postId: InspectedField<string>;
  authorHandle: InspectedField<string>;
  authorUrl: InspectedField<string>;
  collaboratorHandles: InspectedField<string[]>;
  audioLabel: InspectedField<string>;
  captionText: InspectedField<string>;
  textContent: InspectedField<string>;
  hashtags: InspectedField<string[]>;
  mediaType: InspectedField<'image' | 'video' | 'carousel' | 'text'>;
  thumbnailUrl: InspectedField<string>;
  imageUrls: InspectedField<string[]>;
  videoUrl: InspectedField<string>;
  audioUrl: InspectedField<string>;
  publishedAt: InspectedField<string>;
  location: InspectedField<string>;
};

export type AIInput = {
  modality: Modality;
  status: Readiness;
  technicallyAccessible: boolean;
  processingEligibility: ProcessingEligibility;
  sourceFields: string[];
  reason: string;
};

export type Attempt = {
  method: string;
  outcome: 'success' | 'partial' | 'skipped' | 'failed';
  reason: string;
};

export type PostInspection = {
  media?: MediaCapture;
  inspectionMethod?: 'url' | 'extension';
  platform: Platform;
  inputUrl: string;
  normalizedUrl: string;
  inspectedAt: string;
  status: 'partial';
  fields: InspectionFields;
  preview: {
    kind: 'official_embed' | 'source_link' | 'none';
    status: 'available' | 'unavailable' | 'not_configured' | 'permission_required' | 'error';
    renderStatus: 'unverified';
    reason: string | null;
  };
  aiReadiness: Record<Model, AIInput[]>;
  attempts: Attempt[];
  warnings: string[];
};

export type MediaItem = {
  position: number | null;
  type: 'image' | 'video';
  url: string | null;
  referenceUrl: string | null;
  posterUrl: string | null;
  width: number | null;
  height: number | null;
  assetAccess: 'reference_only' | 'verified_accessible' | 'unavailable';
  reason: string;
  processingEligibility: 'unverified';
  verification?: { method: 'cors_get'; mimeType: string; byteLength: number; checkedAt: string;
    durationSeconds?: number; audio?: 'present' | 'absent'; sha256?: string };
};
export type MediaCapture = {
  discovery?: 'embedded_json';
  kind: 'single' | 'carousel';
  composition: 'image_only' | 'video_only' | 'mixed' | 'unknown';
  totalSlides: number | null;
  completeness: 'complete' | 'partial';
  navigation: 'not_requested' | 'completed' | 'stopped';
  reason: string;
  items: MediaItem[];
};

export type DisplayPayload = {
  provider: Platform;
  html: string;
} | null;

export type InspectionResponse = {
  inspection: PostInspection;
  display: DisplayPayload;
};

export type ParsedPostUrl = {
  platform: Platform;
  inputUrl: string;
  normalizedUrl: string;
  postId: string;
  route: 'post' | 'video';
  previewSupported: boolean;
};
