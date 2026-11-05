import { build } from 'esbuild';
import { mkdir, copyFile, readFile, rm, rename } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'extension/dist');
const origin = process.env.MEMOAR_EXTENSION_ORIGIN || 'https://memoar-theta.vercel.app';
if (!['https://memoar-theta.vercel.app', 'http://localhost:3000'].includes(origin)) throw new Error('Unsupported Memoar extension origin.');
await mkdir(output, { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: ['extension/popup.ts', 'extension/popover.ts', 'extension/background.ts', 'extension/capture.ts'],
  outdir: output, bundle: true, format: 'iife', platform: 'browser', target: 'chrome112',
  sourcemap: false, minify: false, logLevel: 'info',
  define: { MEMOAR_EXTENSION_ORIGIN: JSON.stringify(origin) },
  loader: { '.html': 'text', '.css': 'text', '.svg': 'text', '.png': 'dataurl' },
});
for (const name of ['manifest.json', 'popup.html', 'popup.css', 'memoar-icon.png']) await copyFile(path.join(root, 'extension', name), path.join(output, name));
await mkdir(path.join(output, 'platforms'), { recursive: true });
for (const name of ['instagram.svg', 'threads.svg', 'facebook.svg', 'LICENSE']) await copyFile(path.join(root, 'public/platforms', name), path.join(output, 'platforms', name));
const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'));
const expectedHosts = JSON.stringify(['https://memoar-theta.vercel.app/*', 'http://localhost/*']);
if (manifest.manifest_version !== 3 || manifest.permissions.join(',') !== 'activeTab,scripting,storage,alarms,notifications' || JSON.stringify(manifest.host_permissions) !== expectedHosts || JSON.stringify(manifest.externally_connectable?.matches) !== expectedHosts || manifest.content_scripts) {
  throw new Error('Unexpected extension permissions or automatic content scripts.');
}
const archive = path.join(root, 'extension/memoar-extension.zip');
const temporaryArchive = path.join(root, 'extension/memoar-extension.tmp.zip');
await rm(temporaryArchive, { force: true });
try {
  await promisify(execFile)('zip', ['-q', temporaryArchive,
    'popup.js', 'popover.js', 'background.js', 'capture.js',
    'manifest.json', 'popup.html', 'popup.css', 'memoar-icon.png',
    'platforms/instagram.svg', 'platforms/threads.svg', 'platforms/facebook.svg', 'platforms/LICENSE',
  ], { cwd: output });
  await rename(temporaryArchive, archive);
} finally {
  await rm(temporaryArchive, { force: true });
}
console.log('Extension ready at extension/dist and extension/memoar-extension.zip. No browser or application server was started.');
