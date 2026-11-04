import { expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm, symlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveExport } from '../src/lib/inspection/save-export';
vi.mock('server-only', () => ({}));
import { POST } from '../src/app/api/exports/route';

const payload = { model: 'museSpark', files: [
  { name: 'test-muse-spark.mjs', base64: Buffer.from('// Test fixture script\n').toString('base64') },
  { name: 'media/slide-1.jpg', base64: Buffer.from([255, 216, 255, 217]).toString('base64') },
] };
function request(body: unknown, origin = 'http://localhost:3000') {
  return new Request('http://localhost:3000/api/exports', { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

it('writes script and exact media bytes under export without overwriting earlier exports', async () => {
  const root = await mkdtemp(join(tmpdir(), 'memoar-save-'));
  try {
    const first = await saveExport(root, payload), second = await saveExport(root, payload);
    expect(first.directory).toMatch(/^export\/museSpark-/); expect(first.directory).not.toBe(second.directory);
    expect(first.command).toBe(`node ${first.directory}/test-muse-spark.mjs`);
    expect(await readFile(join(root, first.files[0]), 'utf8')).toBe('// Test fixture script\n');
    expect(await readFile(join(root, first.files[1]))).toEqual(Buffer.from([255, 216, 255, 217]));
    expect(await readdir(join(root, 'export'))).toHaveLength(2);
    expect((await stat(join(root, first.directory))).mode & 0o777).toBe(0o755);
    expect((await stat(join(root, first.directory, 'media'))).mode & 0o777).toBe(0o755);
    expect((await stat(join(root, first.files[0]))).mode & 0o777).toBe(0o644);
    expect((await stat(join(root, first.files[1]))).mode & 0o777).toBe(0o644);
    for (const name of ['../.env', '/tmp/escape.mjs', 'media/../../escape.jpg', 'test-sam.mjs']) await expect(saveExport(root, { ...payload, files: [{ ...payload.files[0], name }] })).rejects.toThrow('filename');
    await expect(saveExport(root, { ...payload, files: [payload.files[0], payload.files[0]] })).rejects.toThrow('duplicate');
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('preserves MP4 file bytes alongside ordered image slides in the existing local exporter', async () => {
  const root = await mkdtemp(join(tmpdir(), 'memoar-video-save-'));
  const video = { name: 'media/slide-2.mp4', base64: Buffer.from([0, 0, 0, 8, 109, 100, 97, 116]).toString('base64') };
  try {
    const result = await saveExport(root, { ...payload, files: [...payload.files, video] });
    expect(result.files.map(file => file.split('/').at(-1))).toEqual(['test-muse-spark.mjs', 'slide-1.jpg', 'slide-2.mp4']);
    expect(await readFile(join(root, result.files[2]))).toEqual(Buffer.from(video.base64, 'base64'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('rejects export directory symlinks and remote or cross-origin requests', async () => {
  const root = await mkdtemp(join(tmpdir(), 'memoar-save-'));
  try {
    await symlink(tmpdir(), join(root, 'export'));
    await expect(saveExport(root, payload)).rejects.toThrow('symbolic link');
    expect((await POST(request(payload, 'https://other.example'))).status).toBe(403);
    expect((await POST(new Request('https://example.com/api/exports', { method: 'POST', headers: { origin: 'https://example.com' }, body: '{}' }))).status).toBe(403);
    expect((await POST(request({}))).status).toBe(400);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('saves through the local route without a running server or any model API call', async () => {
  const root = await mkdtemp(join(tmpdir(), 'memoar-route-'));
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(root);
  try {
    const response = await POST(request(payload));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const saved = await response.json();
    expect(await readFile(join(root, saved.files[0]), 'utf8')).toContain('Test fixture');
  } finally { cwd.mockRestore(); await rm(root, { recursive: true, force: true }); }
});
