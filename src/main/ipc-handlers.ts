import { realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { app, dialog, ipcMain, shell } from 'electron';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { vaultChannels } from '../shared/ipc';
import type { VaultRequests } from '../shared/ipc';
import type { GalaxyMap, VaultInfo, VaultWriteResult } from '../shared/types';
import { appUrl } from './app-assets';
import { avatarUrl, portraitUrl } from './images';
import { brandPortraitSettings, readBrandPortraitPath, readVaultPath, readViewSettings, saveBrandPortraitPath, saveVaultPath,
  saveViewSettings } from './settings';
import { VaultReader } from './vault';
import { VaultWriter } from './vault/write';
import { opaqueKey, redactForRenderer } from './vault/privacy';
import { CrystalLayoutStore } from './vault/crystal-layout-store';
import { readAwards, writeAward } from './vault/awards';
import type { AwardsState } from './vault/awards';
import { GlowPeakStore } from './vault/glow-peaks';
import { GalaxyLayoutStore, GalaxySettingsStore } from './vault/galaxy-store';
import { assignGalaxies } from '../shared/galaxies';
import { computeRichness, glowOf } from '../shared/glow';
import type { Richness } from '../shared/glow';
import { requestWakeForNode, wakeEndpoint } from './wake';

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
  const glowPeaks = new GlowPeakStore(join(app.getPath('userData'), 'glow-peaks.json'));
  const galaxySettings = new GalaxySettingsStore(join(app.getPath('userData'), 'galaxy-settings.json'));
  const galaxyLayout = new GalaxyLayoutStore(join(app.getPath('userData'), 'galaxy-layout.json'));
  const defaultPath = app.isPackaged ? join(app.getPath('appData'), 'entropy-nexus', 'memory-vault')
    : join(app.getAppPath(), 'fixtures', 'memory-vault');
  const readBrandPortraitFolder = () => readBrandPortraitPath(settingsFile);
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

  async function profileEditor() {
    const { writer, reader } = await getActiveVault();
    return {
      writer,
      find: async (nodeId: string) => (await getActiveVault()).writer === writer
        ? (await reader.read()).nodeProfilePath(nodeId) : undefined,
    };
  }

  function requestWake(nodeId: string) {
    return requestWakeForNode(nodeId, {
      findNode: async (id) => (await readVault()).wakeNode(id),
      registered: (url) => Boolean(app.getApplicationNameForProtocol(url)),
      open: (url) => shell.openExternal(url),
    });
  }

  /** Richness with the local peaks, and the manual awards, for every node of the snapshot (DESIGN.md §6.9). */
  async function glowState(context: Awaited<ReturnType<typeof readVaultContext>>) {
    const inputs = context.snapshot.richnessInputs();
    const peaks = await glowPeaks.update(opaqueKey('v', context.root),
      new Map([...inputs].map(([id, input]) => [id, { completed: input.completedNow, rejected: input.rejectedNow }])));
    const richness = new Map<string, Richness>();
    for (const [id, input] of inputs) {
      const peak = peaks.get(id) ?? { completed: input.completedNow, rejected: input.rejectedNow };
      richness.set(id, computeRichness({ ...input, completedPeak: peak.completed, rejectedPeak: peak.rejected }));
    }
    // A file that cannot be read right now (locked by a sync client) shows no awards; setAward reads it again.
    const awards: AwardsState = await readAwards(context.root, inputs.keys())
      .catch(() => ({ awards: new Map(), version: null, corrupt: false }));
    return { richness, awards };
  }

  /** Project galaxies for the active vault (DESIGN.md §6.10). Only an explicit request re-arranges the layout. */
  async function galaxyMap(context: Awaited<ReturnType<typeof readVaultContext>>, arrange = false): Promise<GalaxyMap> {
    const key = opaqueKey('v', context.root);
    const input = context.snapshot.galaxyInput(await galaxySettings.promoted(key));
    if (!input) return { enabled: false };
    const { groups, hub, outer, membership, bridges } = assignGalaxies(input);
    const keys = groups.map((group) => group.key);
    const positions = arrange ? await galaxyLayout.arrange(key, keys, bridges) : await galaxyLayout.positions(key, keys, bridges);
    return {
      enabled: true,
      groups: groups.map((group) => ({ ...group, position: positions.get(group.key)! })),
      hub, outer, membership: Object.fromEntries(membership), bridges,
    };
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
      wakeAvailable: Boolean(app.getApplicationNameForProtocol(wakeEndpoint)),
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
      if (activeVault?.path !== chosenPath) activeVault = undefined;
      return info;
    },
    getSettings: () => readViewSettings(settingsFile),
    setSettings: (_event, patch) => saveViewSettings(settingsFile, patch),
    getBrandPortraitSettings: async () => brandPortraitSettings(await readBrandPortraitFolder()),
    chooseBrandPortraitFolder: async () => {
      const parent = getWindow();
      if (!parent) return null;
      const { canceled, filePaths } = await dialog.showOpenDialog(parent, {
        title: '選擇廠牌預設立繪資料夾',
        defaultPath: (await readBrandPortraitFolder()) ?? undefined,
        properties: ['openDirectory'],
      });
      const [chosenPath] = filePaths;
      if (canceled || !chosenPath) return null;
      if (!isAbsolute(chosenPath)) throw new Error('廠牌預設立繪資料夾無效');
      const folder = await realpath(chosenPath);
      if (dirname(folder) === folder || !(await stat(folder)).isDirectory()) throw new Error('廠牌預設立繪資料夾無效');
      return saveBrandPortraitPath(settingsFile, folder);
    },
    clearBrandPortraitFolder: () => saveBrandPortraitPath(settingsFile, null),
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
      const { richness, awards } = await glowState(context);
      return {
        crystals: await Promise.all(crystals.map(async (crystal) => ({
          ...crystal, position: positions.get(crystal.nodeId)!, ...await crystalImages(context, crystal.nodeId),
          glow: glowOf(richness.get(crystal.nodeId) ?? { tier: 'white' }, awards.awards.get(crystal.nodeId)),
        }))),
        links,
        awards: { version: awards.version, corrupt: awards.corrupt },
      };
    },
    listGalaxies: async () => galaxyMap(await readVaultContext()),
    setGalaxyPromotion: async (_event, projectKey, promoted) => {
      const context = await readVaultContext();
      const key = opaqueKey('v', context.root);
      // Only shared-folder projects of this vault's 專案表 can be promoted; git projects are galaxies already.
      const input = context.snapshot.galaxyInput(new Set());
      const project = typeof projectKey === 'string' ? input?.projects.get(projectKey) : undefined;
      if (project?.type === '資料夾' && typeof promoted === 'boolean') await galaxySettings.setPromoted(key, projectKey, promoted);
      return galaxyMap(context);
    },
    arrangeGalaxies: async () => galaxyMap(await readVaultContext(), true),
    readCrystal: async (_event, nodeId) => {
      const context = await readVaultContext();
      const detail = await context.snapshot.readCrystal(nodeId);
      if (!detail) return null;
      const { richness, awards } = await glowState(context);
      const award = awards.awards.get(nodeId) ?? null;
      const nodeRichness = richness.get(nodeId);
      return { ...detail, ...await crystalImages(context, nodeId), richness: nodeRichness, award,
        glow: glowOf(nodeRichness ?? { tier: 'white' }, award) };
    },
    readNodeProfile: async (_event, nodeId) => (await readVault()).readNodeProfile(nodeId),
    readProfileForEdit: async (_event, nodeId) => {
      const { writer, find } = await profileEditor();
      return writer.readProfileForEdit(nodeId, find);
    },
    saveProfileBody: async (_event, nodeId, body, expected, options) => {
      const { writer, find } = await profileEditor();
      return writer.saveProfileBody(nodeId, body, expected, find, options);
    },
    requestWake: (_event, nodeId) => requestWake(nodeId),
    setAward: async (_event, nodeId, award, expected) => {
      const context = await readVaultContext();
      if (!context.snapshot.hasNode(nodeId)) return { ok: false, reason: 'invalid' };
      return writeAward(context.root, nodeId, award && typeof award === 'object' ? { reason: award.reason } : null, expected);
    },
    setStatus: async (_event, path, status, expected) => (await getActiveVault()).writer.setStatus(path, status, expected),
    saveEntry: writeUnavailable,
    moveToRecycle: async (_event, path, expected) => (await getActiveVault()).writer.moveToRecycle(path, expected),
    restoreFromRecycle: async (_event, path, expected) => (await getActiveVault()).writer.restoreFromRecycle(path, expected),
    readRecycledEntry: async (_event, path, originalPath) => (await getActiveVault()).writer.readRecycledEntry(path, originalPath),
    wake: (_event, nodeId) => requestWake(nodeId),
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
  return { readVaultContext, readBrandPortraitFolder };
}
