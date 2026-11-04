import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { PostPreview } from '../src/components/post-preview';
import { normalizeCapture } from '../src/lib/capture/normalize';
import type { CaptureSnapshot } from '../src/lib/capture/snapshot';
import { captureFixture } from './capture-fixture';

vi.mock('@astryxdesign/core/Card', () => ({ Card: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children) }));
vi.mock('@astryxdesign/core/Button', () => ({ Button: ({ label, onClick }: { label: string; onClick?: () => void }) => React.createElement('button', { onClick }, label) }));
vi.mock('../src/components/status-badge', () => ({ StatusBadge: ({ status }: { status: string }) => React.createElement('span', null, status) }));
vi.mock('../src/components/inspector.styles', () => ({ inspectorStyles: { panel: {} } }));
vi.mock('next/script', () => ({ default: () => null }));

let dom: JSDOM;
let root: Root;
const snapshot: CaptureSnapshot = { status: 'available', dataUrl: 'data:image/jpeg;base64,fixture', width: 100, height: 100, source: 'browser_snapshot', processingEligibility: 'unverified' };

beforeEach(() => {
  dom = new JSDOM('<div id="root"></div>');
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('React', React);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  root = createRoot(dom.window.document.querySelector('#root')!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  dom.window.close();
});

async function renderPreview(options: { snapshot?: CaptureSnapshot; video?: boolean } = { snapshot }) {
  const { inspection } = normalizeCapture(captureFixture());
  if (options.video !== false) inspection.fields.mediaType.value = 'video';
  const display = options.video === false ? { provider: 'instagram' as const, html: '<blockquote class="instagram-media"></blockquote>' } : null;
  await act(async () => root.render(React.createElement(PostPreview, { inspection, display, snapshot: options.snapshot })));
}

describe('Instagram video snapshot fallback', () => {
  it('shows the available snapshot immediately without mounting an Instagram iframe', async () => {
    await renderPreview();
    expect(dom.window.document.querySelector('figure img')?.getAttribute('src')).toBe(snapshot.status === 'available' ? snapshot.dataUrl : '');
    expect(dom.window.document.querySelector('iframe')).toBeNull();
    expect(dom.window.document.body.textContent).toContain('Show official embed');
    await act(async () => vi.advanceTimersByTime(13000));
    expect(dom.window.document.querySelector('figure img')).not.toBeNull();
    expect(dom.window.document.querySelector('iframe')).toBeNull();
  });

  it('keeps the iframe when no snapshot is available, without treating timeout as a render failure', async () => {
    await renderPreview({ snapshot: { status: 'unavailable', reason: 'No visible media snapshot.' } });
    const iframe = dom.window.document.querySelector('iframe')!;
    expect(iframe.src).toBe('https://www.instagram.com/reel/UNIT_TEST_ONLY/embed/');
    expect(dom.window.document.querySelector('figure')).toBeNull();
    await act(async () => {
      iframe.dispatchEvent(new dom.window.Event('load'));
      vi.advanceTimersByTime(13000);
    });
    expect(dom.window.document.querySelector('iframe')).not.toBeNull();
    expect(dom.window.document.querySelector('figure')).toBeNull();
    expect(dom.window.document.body.textContent).toContain('unverified');
  });

  it('falls back on an iframe error and lets a user report an error inside the frame', async () => {
    await renderPreview();
    const toggle = [...dom.window.document.querySelectorAll('button')].find(button => button.textContent === 'Show official embed')!;
    await act(async () => toggle.click());
    expect(dom.window.document.querySelector('iframe')).not.toBeNull();
    await act(async () => toggle.click());
    expect(dom.window.document.querySelector('figure img')).not.toBeNull();
    await act(async () => toggle.click());
    const iframe = dom.window.document.querySelector('iframe')!;
    await act(async () => iframe.dispatchEvent(new dom.window.Event('error')));
    expect(dom.window.document.querySelector('figure img')).not.toBeNull();
    expect(dom.window.document.querySelector('iframe')).toBeNull();
  });

  it('preserves official embed priority for non-video posts', async () => {
    await renderPreview({ snapshot, video: false });
    expect(dom.window.document.querySelector('.instagram-media')).not.toBeNull();
    expect(dom.window.document.querySelector('figure')).toBeNull();
    expect(dom.window.document.body.textContent).toContain('Show captured snapshot');
  });

  it('keeps the snapshot decode failure explicit and leaves the original link available', async () => {
    await renderPreview();
    const image = dom.window.document.querySelector('figure img')!;
    await act(async () => image.dispatchEvent(new dom.window.Event('error')));
    expect(dom.window.document.querySelector('figure')).toBeNull();
    expect(dom.window.document.body.textContent).toContain('The captured snapshot could not be decoded.');
    expect(dom.window.document.body.textContent).toContain('Open original post');
  });
});
