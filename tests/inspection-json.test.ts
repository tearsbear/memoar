import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { InspectionJson } from '../src/components/inspection-json';
import { ExtractedData } from '../src/components/extracted-data';
import { normalizeCapture } from '../src/lib/capture/normalize';
import type { PostInspection } from '../src/lib/inspection/types';
import { captureFixture } from './capture-fixture';

vi.mock('@astryxdesign/core/Button', () => ({ Button: ({ label, onClick }: { label: string; onClick: () => void }) => React.createElement('button', { onClick }, label) }));
vi.mock('../src/components/status-badge', () => ({ StatusBadge: ({ status }: { status: string }) => React.createElement('span', null, status) }));

let dom: JSDOM;
let root: Root;
const writeText = vi.fn(async (_text: string) => {});
beforeEach(() => {
  dom = new JSDOM('<div id="root"></div>');
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  vi.stubGlobal('React', React);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  root = createRoot(dom.window.document.querySelector('#root')!);
});
afterEach(async () => { await act(async () => root.unmount()); dom.window.close(); });

async function checkExport(inspection: PostInspection) {
  await act(async () => root.render(React.createElement(React.Fragment, null,
    React.createElement(ExtractedData, { fields: inspection.fields, media: inspection.media }),
    React.createElement(InspectionJson, { inspection }),
  )));
  const json = dom.window.document.querySelector('.json-code code')!.textContent!;
  const exported = JSON.parse(json);
  expect(exported.fields).toEqual(inspection.fields);
  expect(exported.media).toEqual(inspection.media);
  expect(Object.keys(exported.data).sort()).toEqual(Object.keys(inspection.fields).sort());
  const rows = [...dom.window.document.querySelectorAll('.field-row')];
  expect(rows).toHaveLength(Object.keys(inspection.fields).length);
  const renderedValues = rows.flatMap(row => [...row.querySelectorAll('.field-value')].map(node => node.textContent));
  for (const [key, field] of Object.entries(inspection.fields)) {
    expect(exported.data[key]).toEqual(field.value);
    if (field.value !== null) expect(renderedValues).toContain(Array.isArray(field.value) ? JSON.stringify(field.value) : field.value);
  }
  expect(rows.filter(row => row.querySelector('.field-null'))).toHaveLength(Object.values(inspection.fields).filter(field => field.value === null).length);
  await act(async () => dom.window.document.querySelector('button')!.click());
  expect(writeText).toHaveBeenLastCalledWith(json);
  return exported;
}

it('exports every extracted value, preserving full captions, media references, arrays and provenance when copied', async () => {
  const raw = captureFixture();
  raw.inspection.fields.captionText.value = 'Full caption 📸🎥 #日本語\n\n' + 'Caption line. '.repeat(400);
  raw.inspection.fields.authorHandle = { ...raw.inspection.fields.captionText, value: 'fixture_author' };
  raw.inspection.fields.authorUrl = { ...raw.inspection.fields.captionText, value: 'https://www.instagram.com/fixture_author/' };
  raw.inspection.fields.collaboratorHandles = { ...raw.inspection.fields.captionText, value: ['fixture_author', 'collaborator'] };
  raw.inspection.fields.audioLabel = { ...raw.inspection.fields.captionText, value: 'Artist · Song' };
  raw.inspection.fields.publishedAt = { ...raw.inspection.fields.captionText, value: '2026-03-02T11:59:35.000Z' };
  raw.inspection.fields.location = { ...raw.inspection.fields.captionText, value: 'Fixture location' };
  raw.inspection.fields.mediaType = { ...raw.inspection.fields.captionText, value: 'video' };
  const reference = { status: 'available' as const, source: 'browser_media_reference' as const, processingEligibility: 'unverified' as const, reason: 'Visible reference only.' };
  raw.inspection.fields.thumbnailUrl = { ...reference, value: 'https://scontent.cdninstagram.com/poster.jpg?size=large&v=1' };
  raw.inspection.fields.imageUrls = { ...reference, value: ['https://scontent.cdninstagram.com/one.jpg', 'https://scontent.cdninstagram.com/two.jpg'] };
  raw.inspection.fields.videoUrl = { ...reference, value: 'blob:https://www.instagram.com/fixture_video' };
  raw.inspection.fields.audioUrl = { ...reference, value: 'https://scontent.cdninstagram.com/audio.mp4' };
  const { inspection } = normalizeCapture(raw);
  const exported = await checkExport(inspection);
  expect(exported.data.captionText).toBe(raw.inspection.fields.captionText.value);
  expect(exported.fields.videoUrl.assetAccess).toBe('reference_only');
  expect(exported.fields.videoUrl.processingEligibility).toBe('unverified');
});

it('updates displayed and copied JSON together, preserving unavailable nulls and available empty arrays', async () => {
  const { inspection } = normalizeCapture(captureFixture());
  await checkExport(inspection);
  const next = structuredClone(inspection);
  next.fields.captionText.value = 'New capture caption';
  next.fields.hashtags.value = [];
  const exported = await checkExport(next);
  expect(exported.data.captionText).toBe('New capture caption');
  expect(exported.data.hashtags).toEqual([]);
  expect(exported.data.thumbnailUrl).toBeNull();
  expect(exported.data.imageUrls).toBeNull();
  expect(exported.data.videoUrl).toBeNull();
});

it('keeps ordered carousel media and access evidence in the displayed and copied JSON', async () => {
  const raw = captureFixture();
  const item = { position: 1, type: 'image', url: 'https://scontent.cdninstagram.com/slide.jpg', referenceUrl: null, posterUrl: null,
    width: 1080, height: 1350, assetAccess: 'verified_accessible', processingEligibility: 'unverified', reason: 'Observed test verification.',
    verification: { method: 'cors_get', mimeType: 'image/jpeg', byteLength: 4096, checkedAt: '2026-11-04T09:00:00.000Z' } };
  Object.assign(raw.inspection, { media: { kind: 'carousel', composition: 'mixed', totalSlides: 2, completeness: 'complete', navigation: 'completed', reason: 'Observed both endpoints.',
    items: [item, { ...item, position: 2, type: 'video', url: 'blob:https://www.instagram.com/local', width: null, height: null, assetAccess: 'reference_only', verification: undefined }] } });
  const { inspection } = normalizeCapture(raw);
  const exported = await checkExport(inspection);
  expect(exported.media.items.map((entry: { position: number }) => entry.position)).toEqual([1, 2]);
  expect(exported.data.imageUrls).toEqual([item.url]);
  expect(exported.data.videoUrl).toBe('blob:https://www.instagram.com/local');
  expect(exported.media.items[0].assetAccess).toBe('verified_accessible');
  expect(exported.media.items[1].assetAccess).toBe('reference_only');
});
