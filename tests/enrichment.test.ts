import { expect, it } from 'vitest';
import { cleanVisibleText, enrichmentSchema } from '../src/lib/inspection/enrichment';

it('deduplicates OCR without losing prices, quantities, variants, meaningful short labels or punctuation', () => {
  expect(cleanVisibleText([' McCafé ', 'MCCAFÉ', 'Cookie  Butter Frappé', 'Cookie Butter Frappé', 'Red Bull', 'Red Bull Frosted Cranberry Energizer', '$5', '5%', '500 ml', '250 ml', '“Holiday Drinks”', '"Holiday Drinks"', '', null]))
    .toEqual(['McCafé', 'Cookie  Butter Frappé', 'Red Bull', 'Red Bull Frosted Cranberry Energizer', '$5', '5%', '500 ml', '250 ml', '“Holiday Drinks”']);
});

it('drops explicitly truncated fragments only when complete observed OCR covers them', () => {
  expect(cleanVisibleText(['Frosted Cranb…', 'Frosted Cranberry Splash with Sprite', 'Cookie Butter...', 'Cookie Butter Frappé', 'Unknown prod…', 'Red Bull', 'Bull', 'Unmarked incomplete fragment']))
    .toEqual(['Frosted Cranberry Splash with Sprite', 'Cookie Butter Frappé', 'Unknown prod…', 'Red Bull', 'Bull', 'Unmarked incomplete fragment']);
});

it('uses strict structured objects and a separate caption context without forcing names or positions', () => {
  const object = enrichmentSchema.properties.objects.items;
  expect(object.type).toBe('object');
  expect(object.required).toEqual(['name', 'type', 'position', 'attributes', 'evidence']);
  expect(object.properties.name.type).toContain('null');
  expect(object.properties.position.properties.slide.type).toContain('null');
  expect(object.properties.evidence.items.properties.source.enum).toEqual(['visual', 'visible_text', 'caption']);
  expect(object.properties.evidence.items.required).toEqual(['claim', 'source', 'text']);
  expect(enrichmentSchema.properties.brands.items.properties.sources.items.enum).toEqual(['visual', 'visible_text', 'caption', 'author_metadata']);
  expect(enrichmentSchema.required).toContain('rawVisibleText');
  expect(enrichmentSchema.required).toContain('slides');
  expect(enrichmentSchema.properties.slides.items.required).toEqual(['position', 'summary', 'keyInsights']);
  expect(enrichmentSchema.properties.slides.items.properties.position.type).toContain('null');
  expect(enrichmentSchema.properties.slides.items.properties.summary.type).toContain('null');
  expect(enrichmentSchema.properties.captionContext.required).toContain('productNames');
  const checkStrict = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    const node = value as { type?: string; properties?: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };
    if (node.type === 'object') {
      expect(node.additionalProperties).toBe(false);
      expect([...node.required!].sort()).toEqual(Object.keys(node.properties!).sort());
    }
    Object.values(value).forEach(checkStrict);
  };
  checkStrict(enrichmentSchema);
});
