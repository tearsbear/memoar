import { createEnrichmentAccess } from '@/lib/library/enrichment-auth';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  const headers = { 'Cache-Control': 'no-store' };
  if (new URL(request.url).origin !== 'http://localhost:3000' || request.headers.get('host') !== 'localhost:3000' || request.headers.get('origin') !== 'http://localhost:3000' || request.headers.get('sec-fetch-site') !== 'same-origin') return Response.json({ error: 'Local Memoar connection required.' }, { status: 403, headers });
  const secret = process.env.MEMOAR_ENRICHMENT_TOKEN?.trim();
  if (!secret || secret.length < 24 || !process.env.MODEL_API_KEY?.trim()) return Response.json({ error: 'Background organizing is not configured on this local server yet.' }, { status: 503, headers });
  return Response.json({ accessCode: createEnrichmentAccess(secret) }, { headers });
}
