import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { appUrl } from './app-assets';
import { isVaultFrameUrl, registerVaultIpc } from './ipc-handlers';
import { readVaultPath, readViewSettings, saveVaultPath, saveViewSettings } from './settings';
import { vaultChannels } from '../shared/ipc';
import type { VaultRequests } from '../shared/ipc';

const electron = vi.hoisted(() => ({
  userData: '',
  handle: vi.fn<(channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => void>(),
}));

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => resolve('.'),
    getPath: () => electron.userData,
    getApplicationNameForProtocol: () => '',
  },
  dialog: {},
  ipcMain: { handle: electron.handle },
}));

afterEach(async () => {
  electron.handle.mockClear();
  if (electron.userData) {
    await rm(electron.userData, { recursive: true, force: true });
    electron.userData = '';
  }
});

describe('主程序 IPC 來源驗證', () => {
  it.each([appUrl, appUrl + '#/library', appUrl + '?layout=B#/library', appUrl + '/library'])('接受 %s', (source) => {
    expect(isVaultFrameUrl(source)).toBe(true);
  });

  it.each([
    'https://app/index.html', 'vault-app://other/index.html', 'vault-app://app:44/index.html',
    'vault-app://app/index.html2', 'vault-app://app/assets/test.js', 'about:blank',
  ])('拒絕 %s', (source) => {
    expect(isVaultFrameUrl(source)).toBe(false);
  });

  it('只有本視窗頂層介面能讀開發 fixtures', async () => {
    electron.userData = await mkdtemp(join(tmpdir(), 'nexus-vault-ipc-'));
    const sender = {};
    registerVaultIpc(() => ({ webContents: sender }) as BrowserWindow);
    const [, invoke] = electron.handle.mock.calls.find(([channel]) => channel === vaultChannels.listEntries)!;
    const senderFrame = { url: appUrl + '#/library', parent: null };
    expect(await invoke({ sender, senderFrame }, { shelf: 'archive' })).toEqual(expect.arrayContaining([
      expect.objectContaining({ shelf: 'archive', kind: 'preference' }),
    ]));
    expect(() => invoke({ sender: {}, senderFrame }, {})).toThrow('無法驗證');
    expect(() => invoke({ sender, senderFrame: { ...senderFrame, parent: {} } }, {})).toThrow('無法驗證');
    expect(() => invoke({ sender, senderFrame: { ...senderFrame, url: 'https://app/index.html#/library' } }, {})).toThrow('無法驗證');
  });

  it('版式與低動態記住上次選擇且保留記憶庫位置', async () => {
    electron.userData = await mkdtemp(join(tmpdir(), 'nexus-vault-settings-'));
    const settingsFile = join(electron.userData, 'settings.dev.json');
    const vaultPath = resolve('fixtures/memory-vault');
    expect(await readViewSettings(settingsFile)).toEqual({ deskMode: 'A', reducedMotion: false });
    await Promise.all([
      saveVaultPath(settingsFile, vaultPath),
      saveViewSettings(settingsFile, { deskMode: 'B' }),
      saveViewSettings(settingsFile, { reducedMotion: true }),
    ]);
    expect(await readVaultPath(settingsFile, '')).toBe(vaultPath);
    expect(await readViewSettings(settingsFile)).toEqual({ deskMode: 'B', reducedMotion: true });
  });

  it('寫入、回收與撤銷 IPC 只操作暫存複本並重建快照', async () => {
    electron.userData = await mkdtemp(join(tmpdir(), 'nexus-vault-ipc-'));
    const vault = join(electron.userData, 'synthetic-vault');
    const fixtures = resolve('fixtures/memory-vault');
    await cp(fixtures, vault, { recursive: true });
    await saveVaultPath(join(electron.userData, 'settings.dev.json'), vault);
    const sender = {};
    registerVaultIpc(() => ({ webContents: sender }) as BrowserWindow);
    const event = { sender, senderFrame: { url: appUrl, parent: null } };
    function invoke<M extends keyof VaultRequests>(method: M, ...args: Parameters<VaultRequests[M]>): ReturnType<VaultRequests[M]> {
      return electron.handle.mock.calls.find(([channel]) => channel === vaultChannels[method])![1](event, ...args) as ReturnType<VaultRequests[M]>;
    }
    const entry = (await invoke('listEntries', { kind: 'case', status: '未確認' }))[0];
    const path = entry.path;
    const result = await invoke('setStatus', path, '已確認', { mtime: entry.mtime, size: entry.size });
    if (!result.ok) throw new Error(result.reason);
    expect(await invoke('readEntry', path)).toMatchObject({ status: '已確認', mtime: result.mtime });
    const recycled = await invoke('moveToRecycle', path, result);
    if (!recycled.ok) throw new Error(recycled.reason);
    expect(await invoke('readEntry', path)).toBeNull();
    expect(await invoke('restoreFromRecycle', recycled.recycledPath, recycled)).toMatchObject({ ok: true });
    expect(await invoke('readEntry', path)).toMatchObject({ status: '已確認' });
    expect(await readFile(join(fixtures, path), 'utf8')).toContain('狀態: 未確認');
  });

  it('完整 IPC JSON 過濾原始專案 ID、工作目錄和其他本機路徑；代號篩選仍可使用', async () => {
    electron.userData = await mkdtemp(join(tmpdir(), 'nexus-vault-privacy-'));
    const vault = join(electron.userData, 'vault');
    await cp(resolve('fixtures/memory-vault'), vault, { recursive: true });
    await saveVaultPath(join(electron.userData, 'settings.dev.json'), vault);
    const path = 'knowledge/月汐溫室/本機路徑驗證.md';
    const projectId = 'C:\\Users\\Synthetic\\Private project';
    await writeFile(join(vault, path), [
      '---', '種類: 知識', '標題: 隱私驗證', '專案ID: ' + projectId, 'project-id: 隱藏別名',
      '工作目錄: /Users/Synthetic/Note', '其他: [公開, /home/user/private]', '公開欄位: 保留下來', '---',
      '索引標記。位置是（' + projectId + '）。', '## 回顧', '開啟 file:///C:/Users/Synthetic/Nexus.txt',
    ].join('\n'));
    const archive = 'nodes/封存/霜-2026-11-22.md';
    await writeFile(join(vault, archive), [
      '---', '種類: 節點側寫', '節點ID: fixture-private', '工作目錄: /tmp/private/vault',
      '任意欄位: \\\\test-server\\share\\secret', '---', '# 霜', '位於 /Users/Synthetic/Archive',
    ].join('\n'));
    const sender = {};
    registerVaultIpc(() => ({ webContents: sender }) as BrowserWindow);
    const event = { sender, senderFrame: { url: appUrl, parent: null } };
    function invoke<M extends keyof VaultRequests>(method: M, ...args: Parameters<VaultRequests[M]>): ReturnType<VaultRequests[M]> {
      return electron.handle.mock.calls.find(([channel]) => channel === vaultChannels[method])![1](event, ...args) as ReturnType<VaultRequests[M]>;
    }
    const rows = await invoke('listEntries', { includeSuperseded: true });
    const project = rows.find((row) => row.path === path)!;
    expect(project.projectId).toMatch(/^p_[a-f0-9]{24}$/);
    expect(await invoke('listEntries', { projectId: project.projectId })).toMatchObject([{ path }]);
    expect(await invoke('listEntries', { projectId })).toEqual([]);
    const found = await invoke('search', '索引標記', { projectId: project.projectId });
    expect(found).toMatchObject([{ path, projectId: project.projectId }]);
    const entry = await invoke('readEntry', path);
    expect(entry?.attributes.filter(([key]) => ['專案ID', 'project-id', '工作目錄', '其他'].includes(key))).toEqual([]);
    expect(entry?.attributes).toContainEqual(['公開欄位', '保留下來']);
    expect(entry?.body).toContain('[本機路徑已隱藏]');
    const crystal = await invoke('readCrystal', 'fixture-private');
    expect(crystal?.profile?.path).toBe(archive);
    const fixtures = await invoke('readCrystal', 'fixture-node-moss');
    const snapshot = [rows, found, entry, crystal, fixtures, await invoke('listCrystals'), await invoke('getVaultInfo')];
    expect(JSON.stringify(snapshot)).not.toMatch(/[a-z]:[\\/]|\/(?:Users|home|tmp|Volumes)\/|file:\/\/|test-server/i);
  });
});
