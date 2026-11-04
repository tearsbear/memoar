'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { TextArea } from '@astryxdesign/core/TextArea';
import { createCaptureImporter, captureLinkParameters, type ChromeWebRuntime } from '@/lib/capture/bridge';
import { parseCaptureJson, type CaptureEnvelope } from '@/lib/capture/normalize';

export function CaptureImport({ onCapture, disabled }: { onCapture: (capture: CaptureEnvelope) => void; disabled: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [json, setJson] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const importer = useRef(createCaptureImporter());
  const callback = useRef(onCapture);
  const parameters = useRef<{ captureId: string; extensionId: string } | null | undefined>(undefined);
  callback.current = onCapture;

  useEffect(() => {
    let live = true;
    try {
      if (parameters.current === undefined) {
        const url = new URL(window.location.href);
        parameters.current = captureLinkParameters(url);
        if (parameters.current) {
          url.searchParams.delete('captureId'); url.searchParams.delete('extensionId');
          window.history.replaceState(window.history.state, '', url.href);
        }
      }
      if (parameters.current) {
        const { captureId, extensionId } = parameters.current;
        setStatus('Importing the extension capture…');
        const runtime = (window as Window & { chrome?: ChromeWebRuntime }).chrome?.runtime;
        void importer.current(runtime, extensionId, captureId).then(capture => {
          if (live) { callback.current(capture); setStatus('Extension capture imported. Processing permission remains unverified.'); }
        }).catch(failure => {
          if (live) { setError(failure instanceof Error ? failure.message : 'Capture import failed.'); setExpanded(true); setStatus(''); }
        });
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Capture link is invalid.'); setExpanded(true);
    }
    return () => { live = false; };
  }, []);

  function importJson() {
    setError('');
    try {
      const capture = parseCaptureJson(json);
      onCapture(capture);
      setJson(''); setExpanded(false);
      setStatus('Captured JSON imported. This is an unverified browser observation, not an API response.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Invalid captured JSON.'); }
  }

  return (
    <section className="capture-import" aria-label="Capture from Chrome Extension">
      <div className="section-heading">
        <div><h2>Capture from Chrome Extension</h2><p className="section-copy">Open a post in Chrome, then use Memoar’s Capture current post → Open in Memoar.</p></div>
        <Button label={expanded ? 'Close JSON import' : 'Paste captured JSON'} onClick={() => setExpanded(!expanded)} isDisabled={disabled} aria-expanded={expanded} aria-controls="capture-json-import" />
      </div>
      {expanded && <div id="capture-json-import" className="capture-json-import">
        <TextArea label="Captured JSON" description="Fallback for JSON copied from the Memoar extension. No post contents are sent to the server." value={json} onChange={setJson} rows={5} width="100%" hasSpellCheck={false} autoComplete="off" isDisabled={disabled} />
        <Button label="Import capture" onClick={importJson} isDisabled={disabled || !json.trim()} />
      </div>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <p className="copy-status" role="status">{status}</p>
    </section>
  );
}
