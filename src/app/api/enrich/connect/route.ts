import { createEnrichmentAccess } from '@/lib/library/enrichment-auth';
import { isMemoarOrigin } from '@/lib/capture/protocol';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  const headers = { 'Cache-Control': 'no-store' };
  const url = new URL(request.url);
  if (!isMemoarOrigin(url.origin) || request.headers.get('host') !== url.host || request.headers.get('origin') !== url.origin || request.headers.get('sec-fetch-site') !== 'same-origin') return Response.json({ error: 'Open the Memoar website to connect.' }, { status: 403, headers });
  const secret = process.env.MEMOAR_ENRICHMENT_TOKEN?.trim();
  if (!secret || secret.length < 24 || !process.env.MODEL_API_KEY?.trim()) return Response.json({ error: 'Background organizing is not configured on this server yet.' }, { status: 503, headers });
  return Response.json({ accessCode: createEnrichmentAccess(secret) }, { headers });
}
