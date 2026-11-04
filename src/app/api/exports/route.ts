import 'server-only';
import { repairExportPermissions, saveExport } from '@/lib/inspection/save-export';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || request.headers.get('origin') !== url.origin) return Response.json({ error: 'Use Export Test Script from the local Memoar app.' }, { status: 403, headers });
  if (!request.headers.get('content-type')?.startsWith('application/json')) return Response.json({ error: 'Expected JSON export files.' }, { status: 400, headers });
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: 'Export files are missing.' }, { status: 400, headers });
  try {
    const parts: Uint8Array[] = []; let size = 0;
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 75 * 1024 * 1024) { await reader.cancel(); return Response.json({ error: 'Export exceeds the 75 MiB request limit.' }, { status: 413, headers }); }
      parts.push(value);
    }
    const payload = JSON.parse(Buffer.concat(parts).toString('utf8'));
    if (payload?.action === 'repair_permissions' && typeof payload.directory === 'string') return Response.json(await repairExportPermissions(process.cwd(), payload.directory), { headers });
    return Response.json(await saveExport(process.cwd(), payload), { headers });
  } catch (error) {
    const systemError = error instanceof Error && 'code' in error;
    return Response.json({ error: systemError ? 'Could not write the local export folder. Check filesystem permissions.' : error instanceof Error ? error.message : 'Export could not be saved.' }, { status: systemError ? 500 : 400, headers });
  } finally { reader.releaseLock(); }
}
