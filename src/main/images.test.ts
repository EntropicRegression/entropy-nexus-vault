import { copyFile, mkdir, mkdtemp, open, readFile, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { avatarUrl, serveNodeImage } from './images';
import { VaultReader } from './vault';
import { statsFilename } from './vault/sidecars';

const node = 'fixture-node-moss';
const url = 'vault-image://node/' + node + '/avatar';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRXcAAAAASUVORK5CYII=', 'base64');
const source = resolve('fixtures/memory-vault', statsFilename);

vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs/promises')>();
  return { ...fs, open: vi.fn(fs.open) };
});

describe('本機節點圖像協定', () => {
  let root: string;
  let archive: string;
  const context = async () => ({ root, snapshot: await new VaultReader(root).read() });

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'nexus-vault-image-'));
    archive = join(root, 'nodes', '封存', '_圖像', node);
    await mkdir(archive, { recursive: true });
    await copyFile(resolve('fixtures/memory-vault/nodes/封存/夜苔-2026-11-18.md'),
      join(root, 'nodes', '封存', '夜苔-2026-11-18.md'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('立繪白名單使用真實路徑，拒絕透過目錄連結讀取並回退封存圖', async () => {
    const allowed = join(root, 'allowed-portraits');
    const outside = join(root, 'outside-portraits');
    await mkdir(allowed);
    await mkdir(outside);
    await symlink(outside, join(allowed, 'redirected'), 'junction');
    await writeFile(join(outside, 'portrait.png'), png);
    const stats = JSON.parse(await readFile(source, 'utf8'));
    stats.圖像目錄 = allowed;
    stats.節點[node].立繪路徑 = join(allowed, 'redirected', 'portrait.png');
    await writeFile(join(root, statsFilename), JSON.stringify(stats));

    const request = new Request(url.replace('/avatar', '/portrait'));
    expect((await serveNodeImage(request, context)).status).toBe(404);
    await writeFile(join(archive, 'portrait.png'), png);
    const response = await serveNodeImage(request, context);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
  });

  async function installStatsAvatar(bytes: Buffer | string) {
    const folder = join(root, 'synthetic-images');
    await mkdir(folder);
    const path = join(folder, 'stats-avatar.png');
    await writeFile(path, bytes);
    const stats = JSON.parse(await readFile(source, 'utf8'));
    stats.圖像目錄 = folder;
    stats.節點[node].頭像路徑 = path;
    await writeFile(join(root, statsFilename), JSON.stringify(stats));
  }

  it('從封存取得合成頭像，網址只回傳節點代號', async () => {
    await writeFile(join(archive, 'avatar.png'), png);
    expect(await avatarUrl(await context(), node)).toBe(url);
    const response = await serveNodeImage(new Request(url), context);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.has('access-control-allow-origin')).toBe(false);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
    await writeFile(join(archive, 'portrait.png'), png);
    expect((await serveNodeImage(new Request(url.replace('/avatar', '/portrait')), context)).status).toBe(200);
    const unlisted = join(root, 'nodes', '封存', '_圖像', 'unlisted');
    await mkdir(unlisted);
    await writeFile(join(unlisted, 'avatar.png'), png);
    expect((await serveNodeImage(new Request('vault-image://node/unlisted/avatar'), context)).status).toBe(404);
  });

  it('使用統計檔的白名單且圖檔必須在圖像目錄內', async () => {
    const portraitsDir = join(root, 'synthetic-images');
    await mkdir(portraitsDir);
    const inside = join(portraitsDir, 'dot.png');
    const outside = join(root, 'outside.png');
    await writeFile(inside, png);
    await copyFile(inside, outside);
    const stats = JSON.parse(await readFile(source, 'utf8'));
    stats.圖像目錄 = portraitsDir;
    stats.節點[node].頭像路徑 = outside;
    await writeFile(join(root, statsFilename), JSON.stringify(stats));
    expect((await serveNodeImage(new Request(url), context)).status).toBe(404);
    stats.節點[node].頭像路徑 = inside;
    await writeFile(join(root, statsFilename), JSON.stringify(stats));
    expect((await serveNodeImage(new Request(url), context)).status).toBe(200);
  });

  it('找不到、不符格式、超限、非白名單副檔名或非代號路由都回 404', async () => {
    expect((await serveNodeImage(new Request(url), context)).status).toBe(404);
    await writeFile(join(archive, 'avatar.png'), 'plain text');
    expect((await serveNodeImage(new Request(url), context)).status).toBe(404);
    await truncate(join(archive, 'avatar.png'), 20 * 1024 * 1024 + 1);
    await writeFile(join(archive, 'avatar.svg'), '<svg/>');
    expect((await serveNodeImage(new Request(url), context)).status).toBe(404);

    await writeFile(join(archive, 'avatar.png'), png);
    const response = await serveNodeImage(new Request(url + '?size=20'), context);
    expect(response.status).toBe(404);
    expect((await serveNodeImage(new Request('vault-image://node/unknown/avatar'), context)).status).toBe(404);
  });

  it('統計圖像簽章不符時改讀封存，兩邊都損毀才回 404', async () => {
    await installStatsAvatar('stats image with an invalid signature');
    const backup = join(archive, 'avatar.png');
    await writeFile(backup, png);

    const response = await serveNodeImage(new Request(url), context);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png);

    await writeFile(backup, 'archive image with an invalid signature');
    expect((await serveNodeImage(new Request(url), context)).status).toBe(404);
  });

  it('統計圖像通過初步檢查後發生讀取錯誤，仍可取得封存圖像', async () => {
    await installStatsAvatar(png);
    await writeFile(join(archive, 'avatar.png'), png);
    const imageContext = await context();
    const fs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(open).mockImplementationOnce(async (...args) => {
      const handle = await fs.open(...args);
      vi.spyOn(handle, 'read').mockRejectedValueOnce(new Error('模擬圖像讀取失敗'));
      return handle;
    });
    const response = await serveNodeImage(new Request(url), async () => imageContext);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
    expect(vi.mocked(open).mock.calls.at(-1)?.[0]).toBe(await fs.realpath(join(archive, 'avatar.png')));
  });
});
