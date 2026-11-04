import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { canExportModel, modelExport } from '../src/lib/inspection/model-export';
import { AiReadiness } from '../src/components/ai-readiness';
import { normalizeCapture } from '../src/lib/capture/normalize';
import { buildReadiness } from '../src/lib/inspection/readiness';
import { captureFixture } from './capture-fixture';

vi.mock('@astryxdesign/core/Card', () => ({ Card: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children) }));
vi.mock('@astryxdesign/core/Token', () => ({ Token: ({ label }: { label: string }) => React.createElement('span', null, label) }));
vi.mock('@astryxdesign/core/Button', () => ({ Button: ({ label, onClick, isDisabled }: { label: string; onClick: () => void; isDisabled: boolean }) => React.createElement('button', { onClick, disabled: isDisabled }, label) }));
vi.mock('../src/components/inspector.styles', () => ({ inspectorStyles: { panel: {} } }));
const toast = vi.fn();
vi.mock('@astryxdesign/core/Toast', () => ({ useToast: () => toast }));
let changeTarget: (value: string) => void;
vi.mock('@astryxdesign/core/TextInput', () => ({ TextInput: ({ onChange, label }: { onChange: (value: string) => void; label: string }) => {
  changeTarget = onChange;
  return React.createElement('input', { 'aria-label': label });
} }));

function inspection() {
  const raw = captureFixture();
  const item = { position: 1, type: 'image', url: 'https://scontent.cdninstagram.com/verified.jpg', referenceUrl: null, posterUrl: null,
    width: 1080, height: 1350, assetAccess: 'verified_accessible', processingEligibility: 'unverified', reason: 'Fixture verification.',
    verification: { method: 'cors_get', mimeType: 'image/jpeg', byteLength: 4096, checkedAt: '2026-11-04T09:00:00.000Z' } };
  Object.assign(raw.inspection, { media: { kind: 'carousel', totalSlides: 4, completeness: 'complete', navigation: 'completed', reason: 'Fixture carousel.', items: [
    item, { ...item, position: 2, url: 'https://scontent.cdninstagram.com/unverified.jpg', assetAccess: 'reference_only', verification: undefined },
    { ...item, position: 3, type: 'video', url: 'blob:https://www.instagram.com/local', verification: undefined, assetAccess: 'reference_only' },
    { ...item, position: 4 },
  ] } });
  return normalizeCapture(raw).inspection;
}

it('exports only captured text and independently verified images appropriate to each model', () => {
  const report = inspection();
  const spark = modelExport(report, 'museSpark');
  expect(spark).toEqual({ model: 'muse-spark-1.3', inputs: {
    text: { caption: 'Fixture caption #test', authorHandle: null },
    media: [1, 4].map(position => ({ type: 'image', position, url: 'https://scontent.cdninstagram.com/verified.jpg', mimeType: 'image/jpeg', width: 1080, height: 1350 })),
  }, task: 'content_enrichment', reasoningEffort: 'low' });
  expect(modelExport(report, 'sam31', ' drink cup ')).toEqual({ model: 'sam-3.1', inputs: { media: spark.inputs.media, target: { type: 'text', prompt: 'drink cup' } }, task: 'object_segmentation' });
  expect(modelExport(report, 'museVoiceTranscribe')).toEqual({ model: 'muse-voice-transcribe-1.0', inputs: { audio: { url: null, mimeType: null, durationSeconds: null } }, task: 'speech_transcription', status: 'not_applicable' });
  expect(canExportModel(report, 'sam31')).toBe(false);
  expect(canExportModel(report, 'sam31', 'drink cup')).toBe(true);
  expect(JSON.stringify(spark)).not.toMatch(/blob:|unverified.jpg|inspectionMethod|preview|attempts|aiReadiness/);
});

it('omits unavailable or explicitly disallowed inputs even when a supplied readiness claims ready', () => {
  const report = inspection();
  report.fields.captionText.processingEligibility = 'not_allowed';
  report.fields.imageUrls.processingEligibility = 'not_allowed';
  report.aiReadiness.museSpark.forEach(input => { input.status = 'ready'; input.technicallyAccessible = true; });
  expect(modelExport(report, 'museSpark').inputs).toEqual({ text: { caption: null, authorHandle: null }, media: [] });
  expect(canExportModel(report, 'museSpark')).toBe(false);
  expect(canExportModel(report, 'sam31', 'drink cup')).toBe(false);
});

it('uses observed metadata and omits missing location or date', () => {
  const report = inspection();
  report.fields.authorHandle = { ...report.fields.captionText, value: 'observed_author' };
  report.fields.publishedAt = { ...report.fields.captionText, value: '2026-11-04T15:01:50.000Z' };
  expect(modelExport(report, 'museSpark').inputs.text).toEqual({ caption: 'Fixture caption #test', authorHandle: 'observed_author', publishedAt: '2026-11-04T15:01:50.000Z' });
  report.fields.location = { ...report.fields.captionText, value: 'Bandung, Indonesia' };
  report.fields.publishedAt.value = null;
  expect(modelExport(report, 'museSpark').inputs.text).toEqual({ caption: 'Fixture caption #test', authorHandle: 'observed_author', location: 'Bandung, Indonesia' });
});

it('copies separate model payloads, disables empty exports, and provides a fallback when clipboard fails', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document); vi.stubGlobal('React', React); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const writeText = vi.fn(async (_text: string) => {});
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  const root = createRoot(dom.window.document.querySelector('#root')!);
  const report = inspection();
  report.aiReadiness = buildReadiness(report.fields, report.media);
  try {
    await act(async () => root.render(React.createElement(AiReadiness, { inspection: report })));
    const buttons = [...dom.window.document.querySelectorAll('button')].filter(button => button.textContent === 'Copy JSON');
    expect(buttons).toHaveLength(3); expect(buttons[1].disabled).toBe(true); expect(buttons[2].disabled).toBe(false);
    await act(async () => buttons[0].click());
    expect(JSON.parse(writeText.mock.calls[0][0])).toEqual(modelExport(report, 'museSpark'));
    await act(async () => changeTarget('drink cup'));
    expect(buttons[1].disabled).toBe(false);
    writeText.mockRejectedValueOnce(new Error('Clipboard denied'));
    await act(async () => buttons[1].click());
    expect(JSON.parse(dom.window.document.querySelector('.json-code code')!.textContent!)).toEqual(modelExport(report, 'sam31', 'drink cup'));
    await act(async () => buttons[2].click());
    expect(JSON.parse(writeText.mock.calls.at(-1)![0])).toEqual(modelExport(report, 'museVoiceTranscribe'));
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});

it('shows a success toast only after export files have been saved', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document); vi.stubGlobal('React', React); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const transport = vi.fn(async () => Response.json({ directory: 'export/museSpark-test', command: 'node export/museSpark-test/test-muse-spark.mjs' }));
  vi.stubGlobal('fetch', transport);
  const root = createRoot(dom.window.document.querySelector('#root')!);
  try {
    const report = normalizeCapture(captureFixture()).inspection;
    await act(async () => root.render(React.createElement(AiReadiness, { inspection: report })));
    await act(async () => dom.window.document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    const button = [...dom.window.document.querySelectorAll('button')].find(button => button.textContent === 'Export Test Script')!;
    await act(async () => button.click());
    expect(transport).toHaveBeenCalledWith('/api/exports', expect.objectContaining({ method: 'POST' }));
    expect(toast).toHaveBeenCalledWith({ body: 'Export saved to export/museSpark-test', uniqueID: 'export-museSpark' });
    toast.mockClear();
    transport.mockResolvedValueOnce(Response.json({ error: 'Write failed' }, { status: 500 }));
    await act(async () => button.click());
    expect(toast).not.toHaveBeenCalled();
    expect(dom.window.document.body.textContent).toContain('Write failed');
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});
