import { emptyContentFields } from '../inspection/fields';
import { parsePostUrl } from '../inspection/parse-url';
import { buildReadiness } from '../inspection/readiness';
import type { InspectionFields, InspectedField, PostInspection } from '../inspection/types';
import { captureBytes, isRecord, MAX_CAPTURE_BYTES, MAX_TEXT_CHARS, MAX_URL_CHARS } from './protocol';
import { normalizeSnapshot, type CaptureSnapshot } from './snapshot';
import { normalizeMedia, applyMediaFields } from './media';

export type CaptureEnvelope = { version: 1; inspection: PostInspection; snapshot?: CaptureSnapshot };
const mediaKeys = new Set(['thumbnailUrl', 'imageUrls', 'videoUrl', 'audioUrl']);
const nullableStatuses = new Set(['unavailable', 'unknown', 'restricted', 'unsupported']);
const secretKey = /token|password|authorization|cookie|api[_-]?key|secret/i;

function boundedString(value: unknown, maximum: number, label: string): string {
  if (typeof value !== 'string' || value.length > maximum) throw new Error(`${label} is invalid or exceeds its size limit.`);
  return value;
}

export function validateMediaReference(value: unknown, platform: string): string {
  const input = boundedString(value, MAX_URL_CHARS, 'Media reference');
  let url: URL;
  try { url = new URL(input); } catch { throw new Error('Invalid media reference URL.'); }
  if (url.protocol === 'blob:') {
    let origin: URL;
    try { origin = new URL(input.slice(5)); } catch { throw new Error('Invalid blob reference.'); }
    const permitted = platform === 'threads' ? ['threads.com', 'threads.net'] : [`${platform}.com`];
    if (origin.protocol !== 'https:' || !permitted.some(host => origin.hostname === host || origin.hostname === `www.${host}`)) throw new Error('Blob reference belongs to another origin.');
    return input;
  }
  const host = url.hostname;
  const cdn = ['cdninstagram.com', 'fbcdn.net'];
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !cdn.some(domain => host === domain || host.endsWith(`.${domain}`))) {
    throw new Error('Media reference is not an allowlisted Meta CDN URL.');
  }
  if ([...url.searchParams.keys()].some(key => secretKey.test(key))) throw new Error('Credential-like media URL parameters are not accepted.');
  return input;
}

export function deriveHashtags(text: string): string[] {
  // Next's bundled Babel regexp transform fails on this Unicode character class.
  const pattern = new RegExp('#[\\p{L}\\p{N}_]+', 'gu');
  return [...new Set(text.match(pattern) ?? [])];
}

export function normalizeCapture(raw: unknown): CaptureEnvelope {
  if (captureBytes(raw) > MAX_CAPTURE_BYTES) throw new Error('Capture exceeds the 256 KiB limit.');
  if (!isRecord(raw) || raw.version !== 1 || !isRecord(raw.inspection)) throw new Error('Paste a version 1 Memoar extension capture.');
  const input = raw.inspection;
  const parsed = parsePostUrl(input.normalizedUrl);
  if (input.platform !== parsed.platform || !isRecord(input.fields)) throw new Error('Capture platform does not match its post URL.');
  if (input.inspectionMethod !== 'extension') throw new Error('This is not an extension capture.');
  if (!isRecord(input.fields.postId) || input.fields.postId.value !== parsed.postId) throw new Error('Captured post ID does not match its URL.');
  const inspectedAt = boundedString(input.inspectedAt, 40, 'Capture time');
  if (!Number.isFinite(Date.parse(inspectedAt))) throw new Error('Capture time is invalid.');
  const fields = emptyContentFields();
  for (const key of Object.keys(fields) as Array<keyof InspectionFields>) {
    const candidate = input.fields[key];
    if (candidate === undefined && (key === 'collaboratorHandles' || key === 'audioLabel')) continue;
    if (!isRecord(candidate)) throw new Error(`Capture field ${key} is missing.`);
    const reason = candidate.reason == null ? null : boundedString(candidate.reason, 1000, 'Field reason');
    let field: InspectedField<unknown>;
    if (candidate.value === null) {
      if (typeof candidate.status !== 'string' || !nullableStatuses.has(candidate.status)) throw new Error(`Invalid null status for ${key}.`);
      field = { value: null, status: candidate.status as InspectedField<unknown>['status'], source: 'none', reason: reason || 'No unambiguous value was observed in the active post.', processingEligibility: 'unverified' };
    } else {
      const expectedSource = key === 'postId' ? 'url' : mediaKeys.has(key) ? 'browser_media_reference' : 'browser_dom';
      if (candidate.status !== 'available' || candidate.source !== expectedSource) throw new Error(`Invalid source or status for ${key}.`);
      let value: unknown = candidate.value;
      if (key === 'imageUrls') {
        if (!Array.isArray(value) || value.length > 20) throw new Error('Capture supports at most 20 image references.');
        value = value.map(item => validateMediaReference(item, parsed.platform));
      } else if (key === 'collaboratorHandles') {
        if (!Array.isArray(value) || value.length < 2 || value.length > 10 || !value.every(item => typeof item === 'string' && /^[A-Za-z0-9_.]{1,64}$/.test(item))) throw new Error('Invalid collaborator handles.');
      } else if (key === 'hashtags') {
        if (!Array.isArray(value) || value.length > MAX_TEXT_CHARS || !value.every(item => typeof item === 'string' && item.length <= MAX_TEXT_CHARS)) throw new Error('Invalid hashtags.');
      } else if (mediaKeys.has(key)) value = validateMediaReference(value, parsed.platform);
      else {
        const text = boundedString(value, key.endsWith('Url') ? MAX_URL_CHARS : MAX_TEXT_CHARS, key);
        if (!text.trim()) throw new Error(`${key} cannot be an empty available value.`);
        value = text;
      }
      if (key === 'mediaType' && !['image', 'video', 'carousel', 'text'].includes(value as string)) throw new Error('Invalid observed media type.');
      if (key === 'authorUrl') {
        const author = new URL(value as string);
        const post = new URL(parsed.normalizedUrl);
        if (author.origin !== post.origin || author.username || author.password || author.search || author.hash || !/^\/(?:@)?[A-Za-z0-9_.-]+\/?$/.test(author.pathname)) throw new Error('Invalid author profile URL.');
      }
      field = { value, status: 'available', source: expectedSource, reason, processingEligibility: 'unverified' };
    }
    if (mediaKeys.has(key)) field.assetAccess = field.value === null ? 'unavailable' : 'reference_only';
    Object.assign(fields, { [key]: field });
  }
  fields.postId = { value: parsed.postId, status: 'available', source: 'url', reason: 'Parsed from the active post URL, not verified by an API.', processingEligibility: 'unverified' };
  const capturedText = [fields.captionText.value, fields.textContent.value].filter((value): value is string => value !== null).join('\n');
  fields.hashtags = capturedText ? { value: deriveHashtags(capturedText), status: 'available', source: 'browser_dom', reason: 'Derived only from captured post text.', processingEligibility: 'unverified' }
    : { value: null, status: 'unavailable', source: 'none', reason: 'No post text was captured to derive hashtags from.', processingEligibility: 'unverified' };
  const warnings = input.warnings == null ? [] : input.warnings;
  if (!Array.isArray(warnings) || warnings.length > 12) throw new Error('Invalid capture warnings.');
  const baseWarning = 'Media references alone do not establish accessible files. Browser access does not establish permission for AI processing.';
  const cleanWarnings = [...new Set([...warnings.map(value => boundedString(value, 1000, 'Capture warning')), baseWarning])];
  if (cleanWarnings.length > 12) throw new Error('Capture contains too many warnings.');
  const media = normalizeMedia(input.media, value => validateMediaReference(value, parsed.platform));
  if (media) applyMediaFields(fields, media);
  const inspection: PostInspection = {
    ...(media ? { media } : {}),
    inspectionMethod: 'extension', platform: parsed.platform, inputUrl: parsed.normalizedUrl, normalizedUrl: parsed.normalizedUrl,
    inspectedAt: new Date(inspectedAt).toISOString(), status: 'partial', fields,
    preview: { kind: 'source_link', status: 'unavailable', renderStatus: 'unverified', reason: 'Official preview has not been requested for this capture.' },
    aiReadiness: buildReadiness(fields, media),
    attempts: [
      { method: 'url_parser', outcome: 'success', reason: 'Validated the captured platform and post identity.' },
      { method: 'browser_dom_capture', outcome: 'partial', reason: 'One-time observations from the active post. Missing fields and text completeness remain explicit.' },
      { method: 'ai_payload_evaluation', outcome: 'success', reason: 'Evaluated locally. No AI request was made; processing permission remains unverified.' },
    ],
    warnings: cleanWarnings,
  };
  const snapshot = normalizeSnapshot(raw.snapshot);
  const envelope: CaptureEnvelope = { version: 1, inspection, ...(snapshot ? { snapshot } : {}) };
  if (captureBytes(envelope) > MAX_CAPTURE_BYTES) throw new Error('Normalized capture exceeds the 256 KiB limit.');
  return envelope;
}

export function parseCaptureJson(text: string): CaptureEnvelope {
  if (captureBytes(text) > MAX_CAPTURE_BYTES) throw new Error('Capture exceeds the 256 KiB limit.');
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('Captured JSON is not valid JSON.'); }
  return normalizeCapture(value);
}
