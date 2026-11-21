import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { appUrl } from './app-assets';
import { isVaultFrameUrl, registerVaultIpc } from './ipc-handlers';
import { readVaultPath, readViewSettings, saveVaultPath, saveViewSettings } from './settings';
import { vaultChannels } from '../shared/ipc';

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
});
