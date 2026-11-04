'use client';

import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import type { PostInspection } from '@/lib/inspection/types';

export function InspectionJson({ inspection }: { inspection: PostInspection }) {
  const [feedback, setFeedback] = useState('');
  const [copying, setCopying] = useState(false);
  const json = JSON.stringify({
    data: Object.fromEntries(Object.entries(inspection.fields).map(([key, field]) => [key, field.value])),
    ...inspection,
  }, null, 2);

  async function copy() {
    setCopying(true);
    setFeedback('');
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(json);
      setFeedback('Normalized inspection JSON copied.');
    } catch {
      setFeedback('Could not access the clipboard. Select the JSON below and copy it manually.');
    } finally { setCopying(false); }
  }

  return (
    <div>
      <div className="json-toolbar">
        <p>Field values are in data, matching Extracted Data. Status, source, and access details remain in fields.</p>
        <Button label="Copy JSON" size="md" onClick={() => void copy()} isLoading={copying} />
      </div>
      <pre className="json-code" tabIndex={0} aria-label="Normalized inspection JSON"><code>{json}</code></pre>
      <p className="copy-status" role="status">{feedback}</p>
      <p className="section-copy">Display HTML and provider response bodies are excluded.</p>
    </div>
  );
}
