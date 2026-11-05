import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const archive = await readFile(path.join(process.cwd(), 'extension/memoar-extension.zip'));
    return new Response(new Uint8Array(archive), { headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="memoar-extension.zip"',
      'Cache-Control': 'no-store',
    } });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return new Response('The extension ZIP is not ready. Run npm run extension:build in the Memoar project, then try downloading again.', {
      status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
}
