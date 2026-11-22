import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { appUrl } from './app-assets';
import { registerVaultIpc } from './ipc-handlers';
import { serveVaultImage } from './images';
import { maxNodePortraitBytes, NodePortraitStore } from './node-portraits';
import { saveVaultPath } from './settings';
import { opaqueKey } from './vault/privacy';
import { vaultChannels } from '../shared/ipc';
import type { VaultRequests } from '../shared/ipc';

const electron = vi.hoisted(() => ({
  userData: '',
  handle: vi.fn<(channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => void>(),
  showOpenDialog: vi.fn(async (_parent: unknown, _options: unknown): Promise<{ canceled: boolean; filePaths: string[] }> =>
    ({ canceled: true, filePaths: [] })),
}));

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => resolve('.'),
    getPath: () => electron.userData,
    getApplicationNameForProtocol: () => '',
  },
  dialog: { showOpenDialog: electron.showOpenDialog },
  ipcMain: { handle: electron.handle },
  shell: { openExternal: vi.fn() },
}));

const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from('synthetic png body')]);
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('synthetic jpeg body')]);
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 synthetic')]);
const vault = opaqueKey('v', 'C:\\synthetic\\vault');
const scratch: string[] = [];

async function folder(prefix: string) {
  const path = await mkdtemp(join(tmpdir(), prefix));
  scratch.push(path);
  return path;
}

/** Hash of every file under a folder (to prove the memory vault is never changed). */
async function snapshot(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of await readdir(root, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const full = join(entry.parentPath, entry.name);
    result[relative(root, full)] = createHash('sha256').update(await readFile(full)).digest('hex');
  }
  return result;
}

afterEach(async () => {
  electron.handle.mockClear();
  electron.showOpenDialog.mockReset();
  await Promise.all(scratch.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  electron.userData = '';
});

describe('手動指定的節點圖片:存放(只在 App 的 userData)', () => {
  it('複製進 node-portraits/ 並以不透明代碼命名;換圖刪舊檔、版次遞增;清除刪檔', async () => {
    const userData = await folder('nexus-node-portraits-');
    const source = join(await folder('nexus-chosen-'), 'SyntheticAccount 頭像.PNG');
    await writeFile(source, png);
    const store = new NodePortraitStore(userData);
    expect(await store.assign(vault, 'node-a', source)).toEqual({ ok: true, revision: 1 });
    const first = await store.lookup(vault, 'node-a');
    expect(first!.file.startsWith(join(userData, 'node-portraits'))).toBe(true);
    expect(first!.file).toMatch(/[\\/][a-f0-9]{32}\.png$/);
    expect(await readFile(first!.file)).toEqual(png);
    // The original may move or vanish; the copy stays.
    await rm(source);
    expect(await readFile(first!.file)).toEqual(png);
    const second = join(userData, '..', 'other.jpeg');
    scratch.push(second);
    await writeFile(second, jpeg);
    expect(await store.assign(vault, 'node-a', second)).toEqual({ ok: true, revision: 2 });
    const replaced = await store.lookup(vault, 'node-a');
    expect(replaced!.file).toMatch(/\.jpg$/);
    await expect(stat(first!.file)).rejects.toThrow();
    const index = JSON.parse(await readFile(join(userData, 'node-portraits.json'), 'utf8'));
    expect(index.記憶庫[vault]['node-a']).toMatchObject({ 版次: 2 });
    // The index stores only the opaque copy name — never the chosen file's path or name.
    expect(JSON.stringify(index)).not.toMatch(/SyntheticAccount|other\.jpeg|[a-z]:[\\/]/i);
    expect(await store.clear(vault, 'node-a')).toBe(true);
    expect(await store.lookup(vault, 'node-a')).toBeNull();
    await expect(stat(replaced!.file)).rejects.toThrow();
    expect(await store.clear(vault, 'node-a')).toBe(true);
  });

  it('拒絕不支援的格式、超過 20 MB、副檔名對但內容不是圖片;拒絕時不留下任何檔案', async () => {
    const userData = await folder('nexus-node-portraits-');
    const chosen = await folder('nexus-chosen-');
    const store = new NodePortraitStore(userData);
    const gif = join(chosen, 'a.gif');
    await writeFile(gif, Buffer.from('GIF89a'));
    expect(await store.assign(vault, 'n', gif)).toEqual({ ok: false, reason: 'unsupported' });
    const fake = join(chosen, 'fake.png');
    await writeFile(fake, 'not really a png');
    expect(await store.assign(vault, 'n', fake)).toEqual({ ok: false, reason: 'not-image' });
    const webpAsJpeg = join(chosen, 'mismatch.jpg');
    await writeFile(webpAsJpeg, webp);
    expect(await store.assign(vault, 'n', webpAsJpeg)).toEqual({ ok: false, reason: 'not-image' });
    const huge = join(chosen, 'huge.png');
    await writeFile(huge, png);
    await truncate(huge, maxNodePortraitBytes + 1);
    expect(await store.assign(vault, 'n', huge)).toEqual({ ok: false, reason: 'too-large' });
    const okWebp = join(chosen, 'ok.webp');
    await writeFile(okWebp, webp);
    expect(await store.assign('not-a-vault-key', 'n', okWebp)).toEqual({ ok: false, reason: 'io' });
    expect(await store.assign(vault, '../escape', okWebp)).toEqual({ ok: false, reason: 'io' });
    expect(await readdir(join(userData, 'node-portraits')).catch(() => [])).toEqual([]);
    expect(await store.lookup(vault, 'n')).toBeNull();
  });

  it('清理:沒有索引參照的殘留檔刪除;不在記憶庫的節點紀錄保留(可能再出現,只是不顯示)', async () => {
    const userData = await folder('nexus-node-portraits-');
    const source = join(await folder('nexus-chosen-'), 'a.png');
    await writeFile(source, png);
    const store = new NodePortraitStore(userData);
    await store.assign(vault, 'kept', source);
    await mkdir(join(userData, 'node-portraits'), { recursive: true });
    await writeFile(join(userData, 'node-portraits', 'ffffffffffffffffffffffffffffffff.png'), png);
    expect(await new NodePortraitStore(userData).sweep()).toBe(1);
    expect(await readdir(join(userData, 'node-portraits'))).toHaveLength(1);
    expect(await new NodePortraitStore(userData).lookup(vault, 'kept')).not.toBeNull();
  });
});

describe('手動指定的節點圖片:IPC、vault-image 協定、隱私', () => {
  it('對話框選圖 → 只回不透明網址;協定只供應索引內的檔案;四層順序資料齊全;清除;主控台記憶庫一個位元都不變', async () => {
    electron.userData = await folder('nexus-node-portrait-ipc-');
    const vaultRoot = join(electron.userData, 'sky');
    await cp(resolve('fixtures/sky-vault'), vaultRoot, { recursive: true });
    await saveVaultPath(join(electron.userData, 'settings.dev.json'), vaultRoot);
    const chosen = join(electron.userData, 'SyntheticAccount', 'private-pictures');
    await mkdir(chosen, { recursive: true });
    const picture = join(chosen, '我的節點.png');
    await writeFile(picture, png);
    const before = await snapshot(vaultRoot);

    const sender = {};
    const sources = registerVaultIpc(() => ({ webContents: sender }) as BrowserWindow);
    const event = { sender, senderFrame: { url: appUrl, parent: null } };
    function invoke<M extends keyof VaultRequests>(method: M, ...args: Parameters<VaultRequests[M]>): ReturnType<VaultRequests[M]> {
      return electron.handle.mock.calls.find(([channel]) => channel === vaultChannels[method])![1](event, ...args) as ReturnType<VaultRequests[M]>;
    }
    const nodeId = 'fixture-sky-iris';

    // Unknown nodes and cancelled dialogs change nothing.
    expect(await invoke('chooseNodePortrait', 'no-such-node')).toEqual({ ok: false, reason: 'invalid-node' });
    expect(await invoke('chooseNodePortrait', nodeId)).toBeNull();
    expect(electron.showOpenDialog).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
      properties: ['openFile'], filters: [expect.objectContaining({ extensions: ['png', 'webp', 'jpg', 'jpeg'] })] }));

    electron.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [picture] });
    const assigned = await invoke('chooseNodePortrait', nodeId);
    expect(assigned).toEqual({ ok: true, customPortraitUrl: 'vault-image://manual/fixture-sky-iris?v=1' });

    const list = await invoke('listCrystals');
    const detail = await invoke('readCrystal', nodeId);
    const hits = await invoke('searchNodes', '稜鏡');
    const iris = list.crystals.find((crystal) => crystal.nodeId === nodeId)!;
    expect(iris).toMatchObject({ customPortraitUrl: 'vault-image://manual/fixture-sky-iris?v=1',
      portraitUrl: 'vault-image://node/fixture-sky-iris/portrait', avatarUrl: 'vault-image://node/fixture-sky-iris/avatar' });
    expect(detail).toMatchObject({ customPortraitUrl: 'vault-image://manual/fixture-sky-iris?v=1' });
    expect(hits.find((hit) => hit.nodeId === nodeId)).toMatchObject({ customPortraitUrl: 'vault-image://manual/fixture-sky-iris?v=1' });
    expect(list.crystals.find((crystal) => crystal.nodeId === 'fixture-sky-quill')).toMatchObject({ customPortraitUrl: null });

    const served = await serveVaultImage(new Request('vault-image://manual/fixture-sky-iris?v=1'), sources);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await served.arrayBuffer())).toEqual(png);
    expect((await serveVaultImage(new Request('vault-image://manual/fixture-sky-iris'), sources)).status).toBe(200);
    // Only the exact route: no other versions syntax, queries, extra segments, traversal or unknown nodes.
    for (const url of ['vault-image://manual/fixture-sky-iris?v=0', 'vault-image://manual/fixture-sky-iris?v=1&x=2',
      'vault-image://manual/fixture-sky-iris/portrait', 'vault-image://manual/..%2F..%2Fsettings.dev.json',
      'vault-image://manual/fixture-sky-quill?v=1', 'vault-image://manual/fixture-sky-iris#x']) {
      expect((await serveVaultImage(new Request(url), sources)).status, url).toBe(404);
    }

    // Refusals: unsupported format, fake image, too large.
    const gif = join(chosen, 'a.gif');
    await writeFile(gif, 'GIF89a');
    electron.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [gif] });
    expect(await invoke('chooseNodePortrait', nodeId)).toEqual({ ok: false, reason: 'unsupported' });
    const fake = join(chosen, 'fake.webp');
    await writeFile(fake, 'plain text');
    electron.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [fake] });
    expect(await invoke('chooseNodePortrait', nodeId)).toEqual({ ok: false, reason: 'not-image' });
    const huge = join(chosen, 'huge.jpg');
    await writeFile(huge, jpeg);
    await truncate(huge, maxNodePortraitBytes + 1);
    electron.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [huge] });
    expect(await invoke('chooseNodePortrait', nodeId)).toEqual({ ok: false, reason: 'too-large' });
    // The earlier picture is still assigned after the refusals.
    expect((await invoke('readCrystal', nodeId))).toMatchObject({ customPortraitUrl: 'vault-image://manual/fixture-sky-iris?v=1' });

    // Changing the picture bumps ?v=N.
    const second = join(chosen, 'second.jpg');
    await writeFile(second, jpeg);
    electron.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [second] });
    expect(await invoke('chooseNodePortrait', nodeId)).toEqual({ ok: true, customPortraitUrl: 'vault-image://manual/fixture-sky-iris?v=2' });
    expect(Buffer.from(await (await serveVaultImage(new Request('vault-image://manual/fixture-sky-iris?v=2'), sources)).arrayBuffer())).toEqual(jpeg);

    const cleared = await invoke('clearNodePortrait', nodeId);
    expect(cleared).toEqual({ ok: true, customPortraitUrl: null });
    expect((await serveVaultImage(new Request('vault-image://manual/fixture-sky-iris?v=2'), sources)).status).toBe(404);
    expect(await invoke('clearNodePortrait', 'no-such-node')).toEqual({ ok: false, reason: 'invalid-node' });

    // Privacy: no path, account name or file name ever reaches the renderer.
    expect(JSON.stringify({ assigned, list, detail, hits, cleared }))
      .not.toMatch(/(?<![a-z0-9-])[a-z]:[\\/]|\/Users\/|SyntheticAccount|private-pictures|我的節點|node-portraits/i);
    // The console's memory vault is untouched (no stats, profiles or other files changed or added).
    expect(await snapshot(vaultRoot)).toEqual(before);
  });
});
