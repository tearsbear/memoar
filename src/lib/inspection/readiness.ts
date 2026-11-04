import type { AIInput, InspectionFields, MediaCapture, Modality, Model, ProcessingEligibility, Readiness } from './types';

export type InputEvidence = {
  access: 'available' | 'missing' | 'unknown';
  processingEligibility: ProcessingEligibility;
  formatSupported: boolean | null;
  sourceFields: string[];
};

export const modelNames: Record<Model, string> = {
  museSpark: 'Muse Spark 1.3',
  sam31: 'SAM 3.1',
  museVoiceTranscribe: 'Muse Voice Transcribe',
};

export function evaluateInput(modality: Modality, evidence: InputEvidence): AIInput {
  const base = {
    modality,
    technicallyAccessible: evidence.access === 'available',
    processingEligibility: evidence.processingEligibility,
    sourceFields: evidence.sourceFields,
  };
  if (evidence.access === 'missing') return { ...base, status: 'blocked', reason: `No retrieved ${modality} input. A post URL or embedded player is not an AI payload.` };
  if (evidence.processingEligibility === 'not_allowed') return { ...base, status: 'blocked', reason: 'The source does not permit AI processing of this input.' };
  if (evidence.formatSupported === false) return { ...base, status: 'blocked', reason: 'The available input format is not supported by this model.' };
  if (evidence.access === 'unknown' || evidence.processingEligibility === 'unverified' || evidence.formatSupported === null) {
    return { ...base, status: 'unknown', reason: evidence.access === 'available' && evidence.processingEligibility === 'unverified'
      ? 'Technically captured / Permission unverified. Input exists, but permission for AI processing has not been established.'
      : 'Access, processing permission, or input format has not been verified.' };
  }
  return { ...base, status: 'ready', reason: 'Input is accessible, its format is supported, and processing is permitted.' };
}

export function summarizeReadiness(inputs: AIInput[]): Readiness {
  if (inputs.length === 0) return 'unknown';
  if (inputs.every(input => input.status === 'ready')) return 'ready';
  if (inputs.some(input => input.status === 'ready' || input.status === 'partial')) return 'partial';
  if (inputs.some(input => input.status === 'unknown')) return 'unknown';
  return 'blocked';
}

export function buildReadiness(fields: InspectionFields, media?: MediaCapture): Record<Model, AIInput[]> {
  const candidates: Record<Modality, Array<keyof InspectionFields>> = {
    text: ['captionText', 'textContent'], image: ['imageUrls'], video: ['videoUrl'], audio: ['audioUrl'],
  };
  const input = (modality: Modality, embeddedAudio = false): AIInput => {
    const available = candidates[modality].filter(key => {
      const field = fields[key];
      return field.status === 'available' && (Array.isArray(field.value) ? field.value.length > 0 : typeof field.value === 'string' && field.value.trim().length > 0);
    });
    const text = modality === 'text' && available.some(key => typeof fields[key].value === 'string' && String(fields[key].value).trim().length > 0);
    const items = media?.items.filter(item => item.type === modality || embeddedAudio && item.type === 'video' && item.verification?.audio === 'present') ?? [];
    const verified = items.filter(item => item.assetAccess === 'verified_accessible' && item.verification && item.url && !item.url.startsWith('blob:'));
    const accessible = text || verified.length > 0;
    const sources = items.length ? [...new Set([...available, ...items.map(item => `media.items[${media!.items.indexOf(item)}]`)])] : available;
    const evaluated = evaluateInput(modality, {
      access: accessible ? 'available' : items.length && items.every(item => item.assetAccess === 'unavailable') ? 'missing'
        : items.length || available.length > 0 || candidates[modality].some(key => fields[key].status === 'unknown') ? 'unknown' : 'missing',
      processingEligibility: candidates[modality].some(key => fields[key].processingEligibility === 'not_allowed')
        || embeddedAudio && fields.videoUrl.processingEligibility === 'not_allowed' ? 'not_allowed'
        : available.length > 0 && available.every(key => fields[key].processingEligibility === 'allowed') ? 'allowed' : 'unverified',
      formatSupported: text || modality === 'video' && verified.length > 0 ? true : null,
      sourceFields: sources,
    });
    if (items.length) evaluated.reason += ` ${verified.length} of ${items.length} observed ${modality} item(s) independently verified. ${embeddedAudio ? 'Audio evidence is an embedded MP4 track, not a separate WAV input; speech content and model audio quality are unverified. ' : ''}${media?.completeness === 'partial' ? 'Media capture is incomplete; remaining slides and their types are unknown.' : 'Slide completeness does not establish model format compatibility or processing permission.'}`;
    return evaluated;
  };
  return {
    museSpark: ['text', 'image', 'video', 'audio'].map(modality => input(modality as Modality, modality === 'audio')),
    sam31: [input('image'), input('video')].map(item => ({ ...item, reason: `${item.reason} Segmentation also needs an appropriate target/prompt in a later phase.` })),
    museVoiceTranscribe: [input('audio')],
  };
}
