'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Card } from '@astryxdesign/core/Card';
import { Banner } from '@astryxdesign/core/Banner';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { parsePostUrl, UrlValidationError } from '@/lib/inspection/parse-url';
import type { InspectionResponse } from '@/lib/inspection/types';
import { AiReadiness } from './ai-readiness';
import { ExtractedData } from './extracted-data';
import { InspectionJson } from './inspection-json';
import { PostPreview } from './post-preview';
import { StatusBadge } from './status-badge';
import { inspectorStyles } from './inspector.styles';
import { CaptureImport } from './capture-import';
import type { CaptureEnvelope } from '@/lib/capture/normalize';
import { summarizeReadiness } from '@/lib/inspection/readiness';
import type { CaptureSnapshot } from '@/lib/capture/snapshot';
import { instagramPreviewUrl } from '@/lib/inspection/instagram-preview';

const platforms = { instagram: 'Instagram', threads: 'Threads', facebook: 'Facebook' };

export function PostInspector() {
  const [url, setUrl] = useState('');
  const [validation, setValidation] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<InspectionResponse | null>(null);
  const [tab, setTab] = useState('data');
  const [announcement, setAnnouncement] = useState('');
  const active = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const [captured, setCaptured] = useState<InspectionResponse | null>(null);
  const [baseline, setBaseline] = useState<InspectionResponse | null>(null);
  const [previewPending, setPreviewPending] = useState(false);
  const [snapshot, setSnapshot] = useState<CaptureSnapshot | undefined>();

  useEffect(() => () => active.current?.abort(), []);

  async function inspect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setValidation('');
    setError('');
    try { parsePostUrl(url); }
    catch (failure) {
      setValidation(failure instanceof UrlValidationError ? failure.message : 'Enter a supported post URL.');
      return;
    }
    const job = ++generation.current;
    active.current?.abort();
    setCaptured(null); setBaseline(null); setPreviewPending(false); setSnapshot(undefined);
    setLoading(true);
    setResult(null);
    setTab('data');
    setAnnouncement('Inspecting the URL and requesting an official preview.');
    const controller = new AbortController();
    active.current = controller;
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('/api/inspect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }), signal: controller.signal, cache: 'no-store',
      });
      const data = await response.json();
      if (job !== generation.current) return;
      if (!response.ok) throw new Error(data.error?.message ?? 'Inspection could not be completed. Try again.');
      setResult(data as InspectionResponse);
      setAnnouncement('Inspection complete with partial data. Review the preview, field provenance, and AI blockers below.');
    } catch (failure) {
      if (job !== generation.current) return;
      const message = controller.signal.aborted ? 'The inspection did not finish within 15 seconds. You can try this URL again.'
        : failure instanceof Error ? failure.message : 'Could not reach the inspector. Try again.';
      setError(message);
      setAnnouncement('Inspection failed.');
    } finally {
      clearTimeout(timer);
      if (job === generation.current) { active.current = null; setLoading(false); }
    }
  }

  function acceptCapture(envelope: CaptureEnvelope) {
    setSnapshot(envelope.snapshot);
    const report: InspectionResponse = { inspection: envelope.inspection, display: null };
    const job = ++generation.current;
    active.current?.abort();
    setCaptured(report); setBaseline(null); setResult(report); setUrl(report.inspection.normalizedUrl);
    setError(''); setValidation(''); setTab('data'); setLoading(false); setPreviewPending(true);
    setAnnouncement('Browser capture imported. Requesting an official display preview using only the post URL.');
    const controller = new AbortController();
    active.current = controller;
    const timer = setTimeout(() => controller.abort(), 15000);
    void fetch('/api/inspect', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: report.inspection.normalizedUrl }), cache: 'no-store', signal: controller.signal,
    }).then(async response => {
      if (!response.ok) throw new Error('Preview service failed.');
      const urlOnly = await response.json() as InspectionResponse;
      if (job !== generation.current) return;
      if (urlOnly.inspection.normalizedUrl !== report.inspection.normalizedUrl) throw new Error('Preview identity mismatch.');
      const enriched: InspectionResponse = {
        inspection: { ...report.inspection, preview: urlOnly.inspection.preview,
          attempts: [...report.inspection.attempts, ...urlOnly.inspection.attempts.filter(attempt => attempt.method === 'official_oembed_display')] },
        display: urlOnly.display,
      };
      setCaptured(enriched); setResult(enriched); setBaseline(urlOnly);
    }).catch(() => {
      if (job !== generation.current) return;
      const fallback: InspectionResponse = { ...report, inspection: { ...report.inspection,
        preview: { kind: 'source_link', status: 'error', renderStatus: 'unverified', reason: 'Official preview could not be requested. Captured fields are retained.' },
        attempts: [...report.inspection.attempts, { method: 'official_oembed_display', outcome: 'failed', reason: 'Preview service was unavailable. No captured fields were sent to the server.' }],
      } };
      setCaptured(fallback); setResult(fallback);
    }).finally(() => {
      clearTimeout(timer);
      if (job === generation.current) { active.current = null; setPreviewPending(false); }
    });
  }

  async function compareUrlOnly() {
    if (!captured || previewPending || loading) return;
    if (baseline) { setResult(baseline); return; }
    setLoading(true); setError('');
    const job = ++generation.current;
    const controller = new AbortController(); active.current = controller;
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('/api/inspect', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: captured.inspection.normalizedUrl }), signal: controller.signal, cache: 'no-store' });
      if (!response.ok) throw new Error('Could not obtain URL-only comparison. Captured data is still available.');
      const comparison = await response.json() as InspectionResponse;
      if (comparison.inspection.normalizedUrl !== captured.inspection.normalizedUrl) throw new Error('Comparison URL does not match the capture.');
      if (job === generation.current) { setBaseline(comparison); setResult(comparison); }
    } catch (failure) { if (job === generation.current) setError(failure instanceof Error ? failure.message : 'Comparison failed.'); }
    finally { clearTimeout(timer); if (job === generation.current) { setLoading(false); active.current = null; } }
  }

  const inspection = result?.inspection;
  const availableFields = inspection ? Object.entries(inspection.fields).filter(([key, field]) => key !== 'postId' && field.status === 'available').length : 0;
  const aiStatus = inspection ? summarizeReadiness(Object.values(inspection.aiReadiness).flat()) : 'blocked';
  const textCaptured = inspection?.aiReadiness.museSpark.some(input => input.modality === 'text' && input.technicallyAccessible);
  return (
    <main className="inspector">
      <header className="page-header">
        <div>
          <p className="brand">Memoar</p>
          <h1>Post Inspector</h1>
          <p className="description">Find out what a Meta post URL can reveal, what can be previewed, and what is available for AI.</p>
        </div>
        <p className="session-note">Session only · No AI calls</p>
      </header>

      <form onSubmit={event => void inspect(event)} noValidate aria-label="Inspect a post">
        <div className="inspect-form">
          <div className="input-area">
            <TextInput label="Post URL" type="url" value={url} onChange={value => { setUrl(value); setValidation(''); }}
              controlXstyle={inspectorStyles.postUrlControl}
              placeholder="Paste an Instagram, Threads, or Facebook post URL" size="lg" width="100%" htmlName="post-url"
              autoComplete="off" isDisabled={loading} enterKeyHint="go"
              status={validation ? { type: 'error', message: validation } : undefined} statusVariant="detached" />
          </div>
          <Button label={loading ? 'Inspecting post' : 'Inspect post'} type="submit" size="lg" variant="primary" isLoading={loading} xstyle={inspectorStyles.action} />
        </div>
        <p className="form-help">Instagram posts & Reels · Threads posts · Supported Facebook posts & videos. Public access is not guaranteed.</p>
      </form>
      <CaptureImport onCapture={acceptCapture} disabled={loading} />
      <p className="visually-hidden" role="status">{announcement}</p>

      <div className="workspace" aria-busy={loading}>
        {error && <div role="alert"><Banner status="error" title="Inspection could not be completed" description={error} /></div>}
        {loading && <Card padding={0} xstyle={inspectorStyles.panel}><div className="loading-panel"><h2>Inspecting post</h2><p>Parsing the URL and requesting display-only embed markup. A provider failure will still return the observations we have.</p></div></Card>}
        {!loading && !result && !error && (
          <section className="first-inspection" aria-labelledby="first-title">
            <h2 id="first-title">Start with one post URL</h2>
            <p>Inspect a direct link to see its available fields and access limits. Results may be partial, even when an embed can display the post.</p>
            <p>No login, uploads, or saved history.</p>
          </section>
        )}
        {inspection && result && (
          <>
            {captured && <div className="section-heading" aria-label="Compare inspection sources">
              <p className="section-copy">Same URL, separate observations. Preview requests send only the post URL.</p>
              <div className="comparison-actions">
                <Button label="Captured via Extension" onClick={() => setResult(captured)} isDisabled={loading} aria-pressed={inspection.inspectionMethod === 'extension'} />
                <Button label="Compare with URL-only" onClick={() => void compareUrlOnly()} isDisabled={previewPending || loading} aria-pressed={inspection.inspectionMethod !== 'extension'} />
              </div>
            </div>}
            <section className="summary" aria-label="Inspection summary">
              <div className="summary-meta">
                <div className="summary-title"><h2>{platforms[inspection.platform]}</h2><StatusBadge status={inspection.status} /></div>
                <time className="timestamp" dateTime={inspection.inspectedAt}>Inspected {new Date(inspection.inspectedAt).toLocaleString()}</time>
              </div>
              <a className="summary-url" href={inspection.normalizedUrl} target="_blank" rel="noopener noreferrer">{inspection.normalizedUrl}</a>
              <p className="section-copy">Source: {inspection.inspectionMethod === 'extension' ? 'browser_extension · Captured via Extension' : 'URL-only inspection'}{previewPending ? ' · Loading official preview…' : ''}</p>
              <div className="capabilities">
                <div className="capability"><span className="capability-label">Can preview</span><strong>{instagramPreviewUrl(inspection) ? 'Official preview URL available' : inspection.preview.kind === 'official_embed' ? 'Embed markup available' : inspection.inspectionMethod === 'extension' && snapshot?.status === 'available' ? 'Captured snapshot available' : 'Original link only'}</strong><p>Official embed rendering remains unverified. Snapshots are static observations.</p></div>
                <div className="capability"><span className="capability-label">Captured as data</span><strong>{availableFields ? `${availableFields} fields observed` : 'No content retrieved'}</strong><p>{availableFields ? 'See field sources and reference-only media limits below.' : 'Only the post identifier was parsed from its URL.'}</p></div>
                <div className="capability"><span className="capability-label">Can process with AI</span><strong>{textCaptured ? 'Permission unverified' : aiStatus.charAt(0).toUpperCase() + aiStatus.slice(1)}</strong><p>{textCaptured ? 'Text is technically captured. AI use has not been authorized.' : 'No eligible, verified media payload is available.'}</p></div>
              </div>
              {inspection.inspectionMethod === 'extension' && <ul className="capture-warnings">{inspection.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
            </section>

            <div className="main-grid" key={inspection.inspectedAt}>
              <PostPreview key={`${inspection.normalizedUrl}:${inspection.inspectedAt}`} inspection={inspection} display={result.display} snapshot={inspection.inspectionMethod === 'extension' ? snapshot : undefined} />
              <Card padding={0} xstyle={inspectorStyles.panel}>
                <section className="panel-content" aria-label="Inspection data">
                  <div className="tabs-header">
                    <TabList value={tab} onChange={setTab} role="tablist" aria-label="Inspection views" hasDivider>
                      <Tab id="inspection-tab-data" value="data" label="Extracted Data" panelId="inspection-data-panel" />
                      <Tab id="inspection-tab-json" value="json" label="Raw JSON" panelId="inspection-json-panel" />
                    </TabList>
                  </div>
                  <div id="inspection-data-panel" role="tabpanel" aria-labelledby="inspection-tab-data" hidden={tab !== 'data'} tabIndex={0}>
                    <ExtractedData fields={inspection.fields} media={inspection.media} />
                  </div>
                  <div id="inspection-json-panel" role="tabpanel" aria-labelledby="inspection-tab-json" hidden={tab !== 'json'} tabIndex={0}>
                    <InspectionJson inspection={inspection} />
                  </div>
                </section>
              </Card>
            </div>

            <AiReadiness key={`${inspection.normalizedUrl}:${inspection.inspectedAt}`} inspection={inspection} />
            <section aria-labelledby="attempts-title">
              <h2 id="attempts-title">Inspection attempts</h2>
              <p className="section-copy">Methods tried or skipped, with their observed outcomes.</p>
              <ol className="attempt-list">
                {inspection.attempts.map(attempt => <li className="attempt" key={attempt.method}>
                  <div className="attempt-heading"><span>{attempt.method.replaceAll('_', ' ')}</span><StatusBadge status={attempt.outcome} /></div>
                  <p>{attempt.reason}</p>
                </li>)}
              </ol>
            </section>
          </>
        )}
      </div>
      <footer className="footer-note">A capture feasibility prototype. Official embeds remain display-only. Browser captures stay in this page’s memory; extension handoff uses a short-lived session. No model is called.</footer>
    </main>
  );
}
