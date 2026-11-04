'use client';

import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Token } from '@astryxdesign/core/Token';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useToast } from '@astryxdesign/core/Toast';
import type { Model, PostInspection, Readiness } from '@/lib/inspection/types';
import { modelNames, summarizeReadiness } from '@/lib/inspection/readiness';
import { inspectorStyles } from './inspector.styles';
import { canExportModel, modelExport } from '@/lib/inspection/model-export';
import { buildTestScript, readExportImages, wavAsset, type ScriptAsset } from '@/lib/inspection/test-script';

const readinessChips = {
  blocked: { label: 'Unavailable', color: 'red' },
  unknown: { label: 'Available', color: 'green' },
  ready: { label: 'Ready', color: 'green' },
  partial: { label: 'Partial', color: 'orange' },
} as const;

function ReadinessChip({ status, accessible = false }: { status: Readiness; accessible?: boolean }) {
  if (status === 'unknown' && !accessible) return <Token label="Unverified" color="gray" size="sm" />;
  return <Token {...readinessChips[status]} size="sm" />;
}

export function AiReadiness({ inspection }: { inspection: PostInspection }) {
  const toast = useToast();
  const readiness = inspection.aiReadiness;
  const [feedback, setFeedback] = useState<Partial<Record<Model, string>>>({});
  const [fallback, setFallback] = useState<Partial<Record<Model, string>>>({});
  const [targetPrompt, setTargetPrompt] = useState('');
  const [exportPermission, setExportPermission] = useState(false);
  const [exporting, setExporting] = useState<Model | null>(null);
  const [audio, setAudio] = useState<ScriptAsset | null>(null);
  async function selectAudio(file?: File) {
    setAudio(null);
    if (!file) return;
    try {
      if (file.size > 25 * 1024 * 1024) throw new Error('Audio exceeds 25 MiB.');
      setAudio(wavAsset(new Uint8Array(await file.arrayBuffer())));
      setFeedback(current => ({ ...current, museVoiceTranscribe: 'Local WAV bytes selected for script export only.' }));
    } catch (error) { setFeedback(current => ({ ...current, museVoiceTranscribe: error instanceof Error ? error.message : 'Audio could not be read.' })); }
  }
  async function exportScript(model: Model) {
    if (!exportPermission || exporting) return;
    setExporting(model);
    try {
      const assets = model === 'museVoiceTranscribe' ? audio ? [audio] : [] : await readExportImages(inspection, model, targetPrompt);
      const result = await buildTestScript(inspection, model, assets, targetPrompt, 'files');
      const files = result.files!.map(file => {
        let binary = '';
        for (let offset = 0; offset < file.bytes.length; offset += 16384) binary += String.fromCharCode(...file.bytes.subarray(offset, offset + 16384));
        return { name: file.name, base64: btoa(binary) };
      });
      let response: Response;
      try {
        response = await fetch('/api/exports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, files }), cache: 'no-store' });
      } catch { throw new Error('Media was prepared, but Memoar could not reach the local export endpoint. Check the local app connection and retry.'); }
      const saved = await response.json();
      if (!response.ok) throw new Error(saved.error ?? 'Export could not be saved.');
      toast({ body: `Export saved to ${saved.directory}`, uniqueID: `export-${model}` });
      setFeedback(current => ({ ...current, [model]: `Saved to ${saved.directory}. From the project root run: ${saved.command}. Saving does not call Meta AI.` }));
    } catch (error) { setFeedback(current => ({ ...current, [model]: error instanceof Error ? error.message : 'Script export failed.' })); }
    finally { setExporting(null); }
  }
  async function copy(model: Model) {
    if (!canExportModel(inspection, model, targetPrompt)) return;
    const json = JSON.stringify(modelExport(inspection, model, targetPrompt), null, 2);
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(json);
      setFeedback(current => ({ ...current, [model]: 'Input JSON copied. AI permission and model format compatibility remain unverified.' }));
      setFallback(current => ({ ...current, [model]: undefined }));
    } catch {
      setFeedback(current => ({ ...current, [model]: 'Clipboard unavailable. Select and copy the input JSON below.' }));
      setFallback(current => ({ ...current, [model]: json }));
    }
  }
  return (
    <Card padding={0} xstyle={inspectorStyles.panel}>
      <section className="panel-content" aria-labelledby="readiness-title">
        <h2 id="readiness-title">AI Readiness</h2>
        <p className="section-copy">Payload availability, input compatibility, and processing permission. No AI requests are made.</p>
        <label className="section-copy"><input type="checkbox" checked={exportPermission} onChange={event => setExportPermission(event.target.checked)} /> I have permission to save this content in the local export folder for testing with Meta AI. Only running the saved script sends it to Meta.</label>
        <div className="readiness-grid">
          {(Object.keys(modelNames) as Model[]).map(model => (
            <section className="model-section" key={model} aria-label={modelNames[model]}>
              <div className="model-heading">
                <h3>{modelNames[model]}</h3>
                <ReadinessChip status={summarizeReadiness(readiness[model])} accessible={readiness[model].some(input => input.technicallyAccessible)} />
              </div>
              <dl className="modality-list">
                {readiness[model].map(input => (
                  <div key={input.modality}>
                    <dt className="modality-heading"><span>{input.modality}</span><ReadinessChip status={input.status} accessible={input.technicallyAccessible} /></dt>
                    <dd className="modality-detail">{input.reason}</dd>
                    {input.status !== 'blocked' && input.sourceFields.length > 0 && (
                      <dd className="modality-evidence">
                        <span>Fields:</span>
                        {input.sourceFields.map(field => <Token key={field} label={field} size="sm" color="gray" />)}
                      </dd>
                    )}
                  </div>
                ))}
              </dl>
              {model === 'sam31' && <TextInput label="Segmentation target" value={targetPrompt} onChange={value => { setTargetPrompt(value); setFallback(current => ({ ...current, sam31: undefined })); setFeedback(current => ({ ...current, sam31: undefined })); }} placeholder="Describe the object to segment" size="sm" width="100%" />}
              <Button label="Copy JSON" size="sm" onClick={() => void copy(model)} isDisabled={!canExportModel(inspection, model, targetPrompt)} />
              {model === 'museVoiceTranscribe' && <label className="section-copy">Audio for script export (WAV)<input type="file" accept="audio/wav,.wav" onChange={event => void selectAudio(event.target.files?.[0])} /></label>}
              <Button label="Export Test Script" size="sm" onClick={() => void exportScript(model)} isLoading={exporting === model} isDisabled={!exportPermission || exporting !== null || (model === 'museVoiceTranscribe' ? !audio : !canExportModel(inspection, model, targetPrompt))} />
              {feedback[model] && <p className="copy-status" role="status">{feedback[model]}</p>}
              {fallback[model] && <pre className="json-code" tabIndex={0} aria-label={`${modelNames[model]} input JSON`}><code>{fallback[model]}</code></pre>}
            </section>
          ))}
        </div>
      </section>
    </Card>
  );
}
