import { buildReadiness } from './readiness';
import type { Model, PostInspection } from './types';

export function modelExport<M extends Model>(inspection: PostInspection, model: M, targetPrompt = '') {
  const readiness = buildReadiness(inspection.fields, inspection.media)[model];
  const usable = (modality: string) => readiness.some(input => input.modality === modality && input.technicallyAccessible && input.status !== 'blocked');
  const media: Array<{ type: 'image' | 'video'; position: number | null; url: string; mimeType: string; width?: number; height?: number; durationSeconds?: number; audio?: 'present' | 'absent'; sha256?: string }> = [];
  if (usable('image') || usable('video')) {
    const seen = new Set<string>();
    const captured = (inspection.media?.items ?? []).flatMap(item => {
      const identity = `${item.position ?? '?'}:${item.type}:${item.url}`;
      if (!usable(item.type) || !item.url?.startsWith('https:') || item.assetAccess !== 'verified_accessible' || !item.verification || seen.has(identity)) return [];
      if (inspection.fields[item.type === 'image' ? 'imageUrls' : 'videoUrl'].processingEligibility === 'not_allowed') return [];
      if (item.type === 'video' && (item.verification.mimeType !== 'video/mp4' || !item.verification.durationSeconds || !item.verification.sha256 || !item.verification.audio)) return [];
      seen.add(identity);
      return [{ type: item.type, position: item.position, url: item.url, mimeType: item.verification.mimeType,
        ...(item.type === 'video' ? { durationSeconds: item.verification.durationSeconds, audio: item.verification.audio, sha256: item.verification.sha256 } : {}),
        ...(item.width !== null ? { width: item.width } : {}), ...(item.height !== null ? { height: item.height } : {}) }];
    });
    media.push(...captured.sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity)));
  }
  const value = (key: 'captionText' | 'textContent' | 'authorHandle' | 'location' | 'publishedAt') => {
    const field = inspection.fields[key];
    return field.status === 'available' && field.value?.trim() && field.processingEligibility !== 'not_allowed' ? field.value : null;
  };
  const location = value('location');
  const publishedAt = value('publishedAt');
  const payloads = {
    museSpark: {
      model: 'muse-spark-1.3',
      inputs: { text: { caption: usable('text') ? value('captionText') ?? value('textContent') : null, authorHandle: value('authorHandle'),
        ...(location !== null ? { location } : {}), ...(publishedAt !== null ? { publishedAt } : {}) }, media },
      task: 'content_enrichment', reasoningEffort: 'low',
    },
    sam31: { model: 'sam-3.1', inputs: { media, target: { type: 'text', prompt: targetPrompt.trim() } }, task: 'object_segmentation' },
    museVoiceTranscribe: { model: 'muse-voice-transcribe-1.0', inputs: { audio: { url: null, mimeType: null, durationSeconds: null } }, task: 'speech_transcription', status: 'not_applicable' },
  };
  return payloads[model];
}

export function canExportModel(inspection: PostInspection, model: Model, targetPrompt = ''): boolean {
  if (model === 'museVoiceTranscribe') return true;
  if (model === 'sam31') return Boolean(targetPrompt.trim() && modelExport(inspection, model, targetPrompt).inputs.media.length);
  const payload = modelExport(inspection, model);
  return Boolean(payload.inputs.text.caption || payload.inputs.media.length);
}
