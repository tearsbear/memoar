import { enrichmentSchema } from '../inspection/enrichment';
import type { Enrichment } from './types';

type Schema = { type?: string | string[]; enum?: readonly unknown[]; properties?: Record<string, Schema>; required?: readonly string[]; additionalProperties?: boolean; items?: Schema };
export function parseEnrichment(value: unknown): Enrichment {
  function validate(input: unknown, schema: Schema, depth = 0): boolean {
    if (depth > 15) return false;
    const kind = input === null ? 'null' : Array.isArray(input) ? 'array' : typeof input;
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some(type => type === kind || (type === 'integer' && Number.isSafeInteger(input)))) return false;
    if (schema.enum && !schema.enum.includes(input)) return false;
    if (typeof input === 'string' && input.length > 64000) return false;
    if (Array.isArray(input)) return input.length <= 2000 && input.every(item => schema.items && validate(item, schema.items, depth + 1));
    if (kind === 'object') {
      const object = input as Record<string, unknown>;
      if (schema.required?.some(key => !Object.hasOwn(object, key))) return false;
      return Object.entries(object).every(([key, item]) => schema.properties?.[key] ? validate(item, schema.properties[key], depth + 1) : schema.additionalProperties !== false);
    }
    return true;
  }
  if (!validate(value, enrichmentSchema as Schema)) throw new Error('AI returned an incomplete result. Try organizing this post again.');
  return value as Enrichment;
}
