import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { app, dialog, ipcMain } from 'electron';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { vaultChannels } from '../shared/ipc';
import type { VaultRequests } from '../shared/ipc';
import type { VaultInfo, VaultWriteResult } from '../shared/types';
import { appUrl } from './app-assets';
import { readVaultPath, saveVaultPath } from './settings';
import { VaultReader } from './vault';

type VaultHandlers = {
  [Method in keyof VaultRequests]: (
    event: IpcMainInvokeEvent,
    ...args: Parameters<VaultRequests[Method]>
  ) => ReturnType<VaultRequests[Method]>;
};

function writeUnavailable(): Promise<VaultWriteResult> {
  return Promise.resolve({ ok: false, reason: 'io' });
}

export function registerVaultIpc(getWindow: () => BrowserWindow | null): void {
  const settingsFile = join(app.getPath('userData'), 'settings.json');
  const defaultPath = join(app.getPath('appData'), 'entropy-nexus', 'memory-vault');
  let activeVault: { path: string; reader: VaultReader } | undefined;

  async function readVault() {
    const path = await readVaultPath(settingsFile, defaultPath);
    if (activeVault?.path !== path) activeVault = { path, reader: new VaultReader(path) };
    return activeVault.reader.read();
  }

  async function getInfo(path: string): Promise<VaultInfo> {
    const exists = await stat(path).then((info) => info.isDirectory(), () => false);
    return {
      path,
      exists,
      wakeAvailable: Boolean(app.getApplicationNameForProtocol('entropy-nexus://wake')),
    };
  }

  const handlers: VaultHandlers = {
    getVaultInfo: async () => getInfo(await readVaultPath(settingsFile, defaultPath)),
    chooseVault: async () => {
      const parent = getWindow();
      if (!parent) return null;
      const defaultPathForDialog = await readVaultPath(settingsFile, defaultPath);
      const { canceled, filePaths } = await dialog.showOpenDialog(parent, {
        title: '選擇記憶庫資料夾',
        defaultPath: defaultPathForDialog,
        properties: ['openDirectory'],
      });
      const [chosenPath] = filePaths;
      if (canceled || !chosenPath) return null;
      const info = await getInfo(chosenPath);
      if (!info.exists) throw new Error('找不到選擇的記憶庫資料夾');
      await saveVaultPath(settingsFile, chosenPath);
      return info;
    },
    listEntries: async (_event, filter) => (await readVault()).listEntries(filter),
    readEntry: async (_event, path) => (await readVault()).readEntry(path),
    search: async (_event, query, filter) => (await readVault()).search(query, filter),
    listCrystals: async () => (await readVault()).listCrystals(),
    readCrystal: async (_event, nodeId) => (await readVault()).readCrystal(nodeId),
    setStatus: writeUnavailable,
    saveEntry: writeUnavailable,
    moveToRecycle: writeUnavailable,
    restoreFromRecycle: writeUnavailable,
    wake: async () => ({ ok: false, nodeName: null, sessionId: null }),
  };

  function register<Method extends keyof VaultRequests>(method: Method): void {
    ipcMain.handle(vaultChannels[method], (event, ...args: Parameters<VaultRequests[Method]>) => {
      const frame = event.senderFrame;
      if (event.sender !== getWindow()?.webContents || !frame || frame.parent || frame.url !== appUrl) {
        throw new Error('無法驗證記憶庫 IPC 呼叫來源');
      }
      return handlers[method](event, ...args);
    });
  }

  for (const method of Object.keys(handlers) as Array<keyof VaultRequests>) register(method);
}
