import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import { vaultChannels } from '../shared/ipc';
import type { VaultApi, VaultRequests } from '../shared/ipc';

function invoke<Method extends keyof VaultRequests>(
  method: Method,
  ...args: Parameters<VaultRequests[Method]>
): ReturnType<VaultRequests[Method]> {
  return ipcRenderer.invoke(vaultChannels[method], ...args) as ReturnType<VaultRequests[Method]>;
}

const vault: VaultApi = {
  getVaultInfo: () => invoke('getVaultInfo'),
  chooseVault: () => invoke('chooseVault'),
  getSettings: () => invoke('getSettings'),
  setSettings: (patch) => invoke('setSettings', patch),
  listEntries: (filter) => invoke('listEntries', filter),
  readEntry: (path) => invoke('readEntry', path),
  search: (query, filter) => invoke('search', query, filter),
  searchNodes: (query) => invoke('searchNodes', query),
  listCrystals: () => invoke('listCrystals'),
  listGalaxies: () => invoke('listGalaxies'),
  setGalaxyPromotion: (projectKey, promoted) => invoke('setGalaxyPromotion', projectKey, promoted),
  arrangeGalaxies: () => invoke('arrangeGalaxies'),
  readCrystal: (nodeId) => invoke('readCrystal', nodeId),
  setAward: (nodeId, award, expected) => invoke('setAward', nodeId, award, expected),
  setStatus: (path, status, expected) => invoke('setStatus', path, status, expected),
  saveEntry: (path, text, expected) => invoke('saveEntry', path, text, expected),
  moveToRecycle: (path, expected) => invoke('moveToRecycle', path, expected),
  restoreFromRecycle: (path, expected) => invoke('restoreFromRecycle', path, expected),
  readRecycledEntry: (path, originalPath) => invoke('readRecycledEntry', path, originalPath),
  wake: (nodeId) => invoke('wake', nodeId),
  onVaultChanged: (callback) => {
    const listener = (_event: IpcRendererEvent, paths: string[]) => callback(paths);
    ipcRenderer.on(vaultChannels.onVaultChanged, listener);
    return () => ipcRenderer.removeListener(vaultChannels.onVaultChanged, listener);
  },
};

contextBridge.exposeInMainWorld('vault', vault);
