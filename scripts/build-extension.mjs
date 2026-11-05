import { build } from 'esbuild';
import { mkdir, copyFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'extension/dist');
await mkdir(output, { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: ['extension/popup.ts', 'extension/popover.ts', 'extension/background.ts', 'extension/capture.ts'],
  outdir: output, bundle: true, format: 'iife', platform: 'browser', target: 'chrome112',
  sourcemap: false, minify: false, logLevel: 'info',
  loader: { '.html': 'text', '.css': 'text', '.svg': 'text', '.png': 'dataurl' },
});
for (const name of ['manifest.json', 'popup.html', 'popup.css', 'memoar-icon.png']) await copyFile(path.join(root, 'extension', name), path.join(output, name));
await mkdir(path.join(output, 'platforms'), { recursive: true });
for (const name of ['instagram.svg', 'threads.svg', 'facebook.svg', 'LICENSE']) await copyFile(path.join(root, 'public/platforms', name), path.join(output, 'platforms', name));
const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'));
if (manifest.manifest_version !== 3 || manifest.permissions.join(',') !== 'activeTab,scripting,storage,alarms,notifications' || JSON.stringify(manifest.host_permissions) !== '["http://localhost/*"]' || manifest.content_scripts) {
  throw new Error('Unexpected extension permissions or automatic content scripts.');
}
console.log('Extension ready at extension/dist. No browser or application server was started.');
