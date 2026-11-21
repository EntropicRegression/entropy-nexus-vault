import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { app, dialog, ipcMain } from 'electron';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { vaultChannels } from '../shared/ipc';
import type { VaultRequests } from '../shared/ipc';
import type { VaultInfo, VaultWriteResult } from '../shared/types';
import { appUrl } from './app-assets';
import { avatarUrl, portraitUrl } from './images';
import { readVaultPath, readViewSettings, saveVaultPath, saveViewSettings } from './settings';
import { VaultReader } from './vault';
import { VaultWriter } from './vault/write';
import { opaqueKey, redactForRenderer } from './vault/privacy';
import { CrystalLayoutStore } from './vault/crystal-layout-store';

type VaultHandlers = {
  [Method in keyof VaultRequests]: (
    event: IpcMainInvokeEvent,
    ...args: Parameters<VaultRequests[Method]>
  ) => ReturnType<VaultRequests[Method]>;
};

function writeUnavailable(): Promise<VaultWriteResult> {
  return Promise.resolve({ ok: false, reason: 'io' });
}

export function isVaultFrameUrl(value: string): boolean {
  try {
    const actual = new URL(value);
    const expected = new URL(appUrl);
    // URL.origin is "null" for custom schemes in Node. Check the origin components directly.
    return actual.protocol === expected.protocol && actual.host === expected.host &&
      !actual.username && !actual.password &&
      (actual.pathname === expected.pathname || actual.pathname.startsWith(expected.pathname + '/'));
  } catch {
    return false;
  }
}

export function registerVaultIpc(getWindow: () => BrowserWindow | null) {
  const settingsFile = join(app.getPath('userData'), app.isPackaged ? 'settings.json' : 'settings.dev.json');
  const crystalLayout = new CrystalLayoutStore(join(app.getPath('userData'), 'crystal-layout.json'));
  const defaultPath = app.isPackaged ? join(app.getPath('appData'), 'entropy-nexus', 'memory-vault')
    : join(app.getAppPath(), 'fixtures', 'memory-vault');
  let activeVault: { path: string; reader: VaultReader; writer: VaultWriter } | undefined;

  async function getActiveVault() {
    const path = await readVaultPath(settingsFile, defaultPath);
    if (activeVault?.path !== path) {
      const reader = new VaultReader(path);
      activeVault = { path, reader, writer: new VaultWriter(path, () => reader.invalidate()) };
    }
    return activeVault;
  }

  async function readVaultContext() {
    const { path, reader } = await getActiveVault();
    return { root: path, snapshot: await reader.read() };
  }

  async function readVault() {
    return (await readVaultContext()).snapshot;
  }

  const avatarCache = new WeakMap<object, Map<string, Promise<string | null>>>();

  async function crystalImages(context: Awaited<ReturnType<typeof readVaultContext>>, nodeId: string) {
    const [avatar, portrait] = await Promise.all([avatarUrl(context, nodeId), portraitUrl(context, nodeId)]);
    return { avatarUrl: avatar, portraitUrl: portrait };
  }

  async function getInfo(path: string): Promise<VaultInfo> {
    const exists = await stat(path).then((info) => info.isDirectory(), () => false);
    return {
      key: opaqueKey('v', path),
      path: path === defaultPath ? (app.isPackaged ? '%APPDATA%\\entropy-nexus\\memory-vault' : 'fixtures/memory-vault') : '自訂記憶庫',
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
    getSettings: () => readViewSettings(settingsFile),
    setSettings: (_event, patch) => saveViewSettings(settingsFile, patch),
    listEntries: async (_event, filter) => (await readVault()).listEntries(filter),
    readEntry: async (_event, path) => (await readVault()).readEntry(path),
    search: async (_event, query, filter) => (await readVault()).search(query, filter),
    searchNodes: async (_event, query) => {
      const context = await readVaultContext();
      // Avatar lookups touch the file system; reuse them while the snapshot (vault version) is the same.
      let avatars = avatarCache.get(context.snapshot);
      if (!avatars) avatarCache.set(context.snapshot, avatars = new Map());
      const cache = avatars;
      return Promise.all(context.snapshot.searchNodes(query).slice(0, 50).map(async (hit) => {
        let url = cache.get(hit.nodeId);
        if (!url) cache.set(hit.nodeId, url = avatarUrl(context, hit.nodeId));
        return { ...hit, avatarUrl: await url };
      }));
    },
    listCrystals: async () => {
      const context = await readVaultContext();
      const { crystals, links } = context.snapshot.listCrystals();
      const positions = await crystalLayout.positions(opaqueKey('v', context.root), crystals.map(({ nodeId }) => nodeId));
      return {
        crystals: await Promise.all(crystals.map(async (crystal) => ({
          ...crystal, position: positions.get(crystal.nodeId)!, ...await crystalImages(context, crystal.nodeId),
        }))),
        links,
      };
    },
    readCrystal: async (_event, nodeId) => {
      const context = await readVaultContext();
      const detail = await context.snapshot.readCrystal(nodeId);
      return detail ? { ...detail, ...await crystalImages(context, nodeId) } : null;
    },
    setStatus: async (_event, path, status, expected) => (await getActiveVault()).writer.setStatus(path, status, expected),
    saveEntry: writeUnavailable,
    moveToRecycle: async (_event, path, expected) => (await getActiveVault()).writer.moveToRecycle(path, expected),
    restoreFromRecycle: async (_event, path, expected) => (await getActiveVault()).writer.restoreFromRecycle(path, expected),
    readRecycledEntry: async (_event, path, originalPath) => (await getActiveVault()).writer.readRecycledEntry(path, originalPath),
    wake: async () => ({ ok: false, nodeName: null, sessionId: null }),
  };

  function register<Method extends keyof VaultRequests>(method: Method): void {
    ipcMain.handle(vaultChannels[method], (event, ...args: Parameters<VaultRequests[Method]>) => {
      const frame = event.senderFrame;
      if (event.sender !== getWindow()?.webContents || !frame || frame.parent || !isVaultFrameUrl(frame.url)) {
        throw new Error('無法驗證記憶庫 IPC 呼叫來源');
      }
      return handlers[method](event, ...args).then(redactForRenderer, () => {
        throw new Error('無法完成記憶庫操作');
      });
    });
  }

  for (const method of Object.keys(handlers) as Array<keyof VaultRequests>) register(method);
  return readVaultContext;
}
