import type { InspectionFields, MediaCapture } from '@/lib/inspection/types';
import { StatusBadge } from './status-badge';

const groups: Array<{ title: string; fields: Array<[keyof InspectionFields, string]> }> = [
  { title: 'Identity', fields: [['postId', 'Post ID / shortcode']] },
  { title: 'Author', fields: [['authorHandle', 'Author handle'], ['authorUrl', 'Author URL'], ['collaboratorHandles', 'Collaboration header accounts']] },
  { title: 'Text', fields: [['captionText', 'Caption'], ['textContent', 'Post text'], ['hashtags', 'Hashtags']] },
  { title: 'Media', fields: [['mediaType', 'Media type'], ['thumbnailUrl', 'Thumbnail URL'], ['imageUrls', 'Image URLs'], ['videoUrl', 'Video URL'], ['audioUrl', 'Audio URL']] },
  { title: 'Context', fields: [['publishedAt', 'Published at'], ['location', 'Location'], ['audioLabel', 'Audio label (not an audio file)']] },
];

export function ExtractedData({ fields, media }: { fields: InspectionFields; media?: MediaCapture }) {
  return (
    <div>
      <p className="section-copy">Only values obtained through an identified source appear below. Empty fields retain their reasons.</p>
      {media && <section aria-label="Captured media">
        <h3 className="field-group-title">Media capture</h3>
        <p className="section-copy">{media.kind} · {media.composition.replaceAll('_', ' ')} · {media.items.length} observed / {media.totalSlides ?? 'unknown'} total · {media.completeness}</p>
        <p className="field-reason">{media.reason} Completeness describes observed slides, not downloadable files or AI permission.</p>
        <ol className="media-items">
          {media.items.map((item, index) => <li key={`${item.position}:${index}`}>
            <p>Slide {item.position ?? 'position unknown'} · {item.type} · {item.assetAccess.replaceAll('_', ' ')}</p>
            <p className="field-value">{item.url ?? 'No supported media URL observed'}</p>
            {item.referenceUrl && item.referenceUrl !== item.url && <p className="field-value">Player reference: {item.referenceUrl}</p>}
            {item.posterUrl && <p className="field-value">Poster: {item.posterUrl}</p>}
            <p className="field-reason">{item.reason}</p>
            {item.verification && <p className="field-reason">{item.verification.mimeType} · {item.width} × {item.height} · {item.verification.byteLength} bytes · checked {item.verification.checkedAt}</p>}
          </li>)}
        </ol>
      </section>}
      {groups.map(group => (
        <section key={group.title} aria-label={group.title}>
          <h3 className="field-group-title">{group.title}</h3>
          <dl className="data-fields">
            {group.fields.map(([key, label]) => {
              const field = fields[key];
              return (
                <div className="field-row" key={key}>
                  <dt className="field-label">{label}</dt>
                  <dd className="field-details">
                    {field.value === null ? <span className="field-null">No value retrieved</span>
                      : <span className="field-value">{Array.isArray(field.value) ? JSON.stringify(field.value) : field.value}</span>}
                    <div className="field-provenance">
                      {field.status === 'unavailable' ? <span>Unavailable</span> : <StatusBadge status={field.status} />}
                      <span>Source: {{ url: 'URL parser', official_api: 'Official API', none: 'None', browser_dom: 'Visible browser DOM', browser_media_reference: 'Browser media reference' }[field.source]}</span>
                      <span>AI use: {field.processingEligibility.replaceAll('_', ' ')}</span>
                      {field.assetAccess && <span>Asset: {field.assetAccess.replaceAll('_', ' ')}</span>}
                    </div>
                    {field.reason && <p className="field-reason">{field.reason}</p>}
                  </dd>
                </div>
              );
            })}
          </dl>
        </section>
      ))}
    </div>
  );
}
