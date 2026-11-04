'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import { Card } from '@astryxdesign/core/Card';
import { Button } from '@astryxdesign/core/Button';
import { SDK_URLS } from '@/lib/inspection/display-sdks';
import type { DisplayPayload, PostInspection } from '@/lib/inspection/types';
import { StatusBadge } from './status-badge';
import { inspectorStyles } from './inspector.styles';
import type { CaptureSnapshot } from '@/lib/capture/snapshot';
import { instagramPreviewUrl } from '@/lib/inspection/instagram-preview';

type EmbedWindow = Window & {
  instgrm?: { Embeds?: { process: () => void } };
  textPostApp?: { Embeds?: { process: () => void } };
  FB?: { XFBML?: { parse: (element: HTMLElement) => void } };
};

export function PostPreview({ inspection, display, snapshot }: { inspection: PostInspection; display: DisplayPayload; snapshot?: CaptureSnapshot }) {
  const container = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [sdkState, setSdkState] = useState<'loading' | 'requested' | 'unverified' | 'error'>('loading');
  const [previewChoice, setPreviewChoice] = useState<'embed' | 'snapshot' | null>(null);
  const [snapshotFailed, setSnapshotFailed] = useState(false);
  const hasSnapshot = snapshot?.status === 'available' && !snapshotFailed;
  const iframeUrl = instagramPreviewUrl(inspection);
  const showSnapshot = previewChoice === 'snapshot' || previewChoice === null && Boolean(iframeUrl);
  const hasPreview = Boolean(iframeUrl || display);
  const useSnapshot = hasSnapshot && (showSnapshot || !hasPreview || sdkState === 'error');

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const failed = () => setSdkState('error');
    element.addEventListener('error', failed);
    return () => element.removeEventListener('error', failed);
  }, [iframeUrl, useSnapshot]);

  useEffect(() => {
    if (!hasPreview) return;
    const timer = setTimeout(() => setSdkState(current => current === 'loading' ? 'unverified' : current), 12000);
    return () => clearTimeout(timer);
  }, [hasPreview]);

  const processEmbed = useCallback(() => {
    const sdk = window as EmbedWindow;
    try {
      if (display?.provider === 'instagram' && sdk.instgrm?.Embeds) sdk.instgrm.Embeds.process();
      else if (display?.provider === 'threads' && sdk.textPostApp?.Embeds) sdk.textPostApp.Embeds.process();
      else if (display?.provider === 'facebook' && sdk.FB?.XFBML && container.current) sdk.FB.XFBML.parse(container.current);
      else { setSdkState('unverified'); return; }
      setSdkState('requested');
    } catch { setSdkState('error'); }
  }, [display]);

  const notice = iframeUrl ? sdkState === 'error'
    ? 'The Instagram preview could not be loaded. A captured snapshot is used when available.'
    : 'Official Instagram preview requested. Rendering and playback inside this frame are unverified. If it shows an error, select the captured snapshot.'
    : sdkState === 'loading' ? 'Loading the official embed SDK. Rendering and playback are unverified.'
    : sdkState === 'error' ? 'The official embed SDK could not be loaded or initialized. Open the original post instead.'
    : sdkState === 'unverified' ? 'The SDK did not confirm a render. This does not establish whether the post is private, deleted, or restricted.'
    : 'Embed rendering was requested. This tool cannot confirm playback or the visibility of content inside the provider frame.';

  return (
    <Card padding={0} xstyle={inspectorStyles.panel}>
      <section className="panel-content" aria-labelledby="preview-title">
        <div className="section-heading panel-header"><h2 id="preview-title">Preview</h2><StatusBadge status={useSnapshot ? 'Captured snapshot' : iframeUrl ? sdkState === 'error' ? 'error' : 'unverified' : inspection.preview.status} /></div>
        {hasPreview && hasSnapshot && sdkState !== 'error' && <Button label={showSnapshot ? 'Show official embed' : 'Show captured snapshot'} onClick={() => setPreviewChoice(showSnapshot ? 'embed' : 'snapshot')} />}
        <div className={`preview-body${hasPreview ? ' has-embed' : ''}`}>
          {useSnapshot && snapshot.status === 'available' ? <figure className="captured-snapshot">
            <img src={snapshot.dataUrl} width={snapshot.width} height={snapshot.height} alt="Visible post media captured when Capture current post was clicked" onError={() => setSnapshotFailed(true)} />
            <figcaption>Captured snapshot · Static image from the source tab. No video playback or AI processing permission is established.</figcaption>
            <p>{inspection.preview.reason}</p>
          </figure> : iframeUrl ? (
            <>
              <div className="embed-container"><iframe ref={frame} src={iframeUrl} title="Official Instagram post preview" width="540" height="740" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="no-referrer" /></div>
              <p className="embed-notice" role="status">{notice}</p>
            </>
          ) : display ? (
            <>
              {display.provider === 'facebook' && <div id="fb-root" />}
              <div ref={container} className="embed-container" dangerouslySetInnerHTML={{ __html: display.html }} />
              <Script id={`memoar-${display.provider}-sdk`} src={SDK_URLS[display.provider]} strategy="afterInteractive" onReady={processEmbed} onError={() => setSdkState('error')} />
              <p className="embed-notice" role="status">{notice}</p>
            </>
          ) : (
            <div className="preview-placeholder">
              <h3>Preview is not available</h3>
              <p>{inspection.preview.reason ?? 'No official preview was returned for this URL.'}</p>
            </div>
          )}
        </div>
        {snapshot?.status === 'unavailable' && <p className="embed-notice">{snapshot.reason}</p>}
        {snapshotFailed && <p className="embed-notice" role="status">The captured snapshot could not be decoded. Open the original post instead.</p>}
        <div className="preview-footer">
          <Button label="Open original post" href={inspection.normalizedUrl} target="_blank" rel="noopener noreferrer" />
          <p>Preview is display-only. Text and media inside it are not retrieved as AI inputs. The provider controls the embed appearance.</p>
        </div>
      </section>
    </Card>
  );
}
