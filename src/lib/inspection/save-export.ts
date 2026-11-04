import { mkdir, mkdtemp, lstat, rm, writeFile, stat, chmod, chown, readdir } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { isRecord } from '../capture/protocol';

const scripts = { museSpark: 'test-muse-spark.mjs', sam31: 'test-sam.mjs', museVoiceTranscribe: 'test-muse-voice.mjs' };

export async function repairExportPermissions(root: string, directory: string) {
  if (!/^(museSpark|sam31|museVoiceTranscribe)-[A-Za-z0-9]+$/.test(directory)) throw new Error('Invalid export directory.');
  const owner = await stat(root);
  const apply = async (path: string, isDirectory: boolean) => {
    const entry = await lstat(path);
    if (entry.isSymbolicLink() || (isDirectory ? !entry.isDirectory() : !entry.isFile())) throw new Error('Invalid export file type.');
    if (process.getuid?.() === 0) await chown(path, owner.uid, owner.gid);
    await chmod(path, isDirectory ? 0o755 : 0o644);
  };
  const exportRoot = join(root, 'export'), folder = join(exportRoot, directory);
  await apply(exportRoot, true); await apply(folder, true);
  for (const entry of await readdir(folder)) {
    if (Object.values(scripts).includes(entry)) await apply(join(folder, entry), false);
    else if (entry === 'media') {
      const media = join(folder, entry); await apply(media, true);
      for (const file of await readdir(media)) {
        if (!/^(slide-\d+\.(jpg|png|webp|mp4)|audio\.wav)$/.test(file)) throw new Error('Invalid export media filename.');
        await apply(join(media, file), false);
      }
    } else throw new Error('Invalid export filename.');
  }
  return { directory: `export/${directory}` };
}

export async function saveExport(root: string, payload: unknown) {
  if (!isRecord(payload) || typeof payload.model !== 'string' || !Object.hasOwn(scripts, payload.model) || !Array.isArray(payload.files) || payload.files.length < 1 || payload.files.length > 21) throw new Error('Invalid export files.');
  const script = scripts[payload.model as keyof typeof scripts];
  const seen = new Set<string>(); let total = 0;
  const files = payload.files.map(file => {
    if (!isRecord(file) || typeof file.name !== 'string' || typeof file.base64 !== 'string' || seen.has(file.name)) throw new Error('Invalid or duplicate export file.');
    if (file.name !== script && !(payload.model === 'museVoiceTranscribe' ? file.name === 'media/audio.wav' : /^media\/slide-\d+\.(jpg|png|webp|mp4)$/.test(file.name))) throw new Error('Invalid export filename.');
    if (!file.base64 || file.base64.length % 4 || /[^A-Za-z0-9+/=]/.test(file.base64)) throw new Error('Invalid export encoding.');
    const bytes = Buffer.from(file.base64, 'base64'); total += bytes.length;
    if (bytes.toString('base64') !== file.base64) throw new Error('Invalid export encoding.');
    if (total > 52 * 1024 * 1024) throw new Error('Export exceeds 52 MiB.');
    seen.add(file.name); return { name: file.name, bytes };
  });
  if (!seen.has(script)) throw new Error('The model test script is missing.');
  const exportRoot = join(root, 'export'); await mkdir(exportRoot, { recursive: true });
  if ((await lstat(exportRoot)).isSymbolicLink()) throw new Error('The export folder must be a local directory, not a symbolic link.');
  const folder = await mkdtemp(join(exportRoot, `${payload.model}-`));
  try {
    for (const file of files) {
      if (file.name.startsWith('media/')) await mkdir(join(folder, 'media'), { recursive: true });
      await writeFile(join(folder, file.name), file.bytes, { flag: 'wx', mode: 0o600 });
    }
    await repairExportPermissions(root, basename(folder));
    const path = relative(root, folder);
    return { directory: path, files: files.map(file => `${path}/${file.name}`), command: `node ${path}/${script}` };
  } catch (error) { await rm(folder, { recursive: true, force: true }); throw error; }
}
