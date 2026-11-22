import type {
  CrystalList,
  BrandPortraitSettings,
  EntryFilter,
  FileVersion,
  MemoryEntry,
  MemoryEntryDetail,
  ReadableNodeProfile,
  ProfileEditVersion,
  ProfileEditResult,
  ProfileSaveResult,
  ProfileSaveOptions,
  RequestWakeResult,
  NodeCrystalDetail,
  NodeHit,
  NodePortraitResult,
  GalaxyMap,
  AwardWriteResult,
  RecycledEntry,
  RecycledVersion,
  VaultInfo,
  VaultRecycleResult,
  VaultStatusUpdate,
  VaultWriteResult,
  ViewSettings,
  WakeResult,
} from './types';

export interface NodeProfileApi {
  readNodeProfile(nodeId: string): Promise<ReadableNodeProfile | null>;
  readProfileForEdit(nodeId: string): Promise<ProfileEditResult>;
  saveProfileBody(nodeId: string, body: string, expectedVersion: ProfileEditVersion, options?: ProfileSaveOptions): Promise<ProfileSaveResult>;
  requestWake(nodeId: string): Promise<RequestWakeResult>;
}

export interface BrandPortraitApi {
  getBrandPortraitSettings(): Promise<BrandPortraitSettings>;
  chooseBrandPortraitFolder(): Promise<BrandPortraitSettings | null>;
  clearBrandPortraitFolder(): Promise<BrandPortraitSettings>;
}

/** Pictures the user assigns to single nodes (DESIGN.md §6.5.2). */
export interface NodePortraitApi {
  /** Opens the system file dialog in the main process; null when the user cancels. */
  chooseNodePortrait(nodeId: string): Promise<NodePortraitResult | null>;
  clearNodePortrait(nodeId: string): Promise<NodePortraitResult>;
}

// The M5d preload always provides these methods. Older consumers/test bridges can still use the base API.
export interface VaultApi extends Partial<NodeProfileApi>, Partial<BrandPortraitApi>, Partial<NodePortraitApi> {
  getVaultInfo(): Promise<VaultInfo>;
  chooseVault(): Promise<VaultInfo | null>;
  getSettings(): Promise<ViewSettings>;
  setSettings(patch: Partial<ViewSettings>): Promise<ViewSettings>;
  listEntries(filter: EntryFilter): Promise<MemoryEntry[]>;
  readEntry(path: string): Promise<MemoryEntryDetail | null>;
  search(query: string, filter: EntryFilter): Promise<MemoryEntry[]>;
  searchNodes(query: string): Promise<NodeHit[]>;
  listCrystals(): Promise<CrystalList>;
  /** Project galaxies (DESIGN.md §6.10); { enabled: false } without a 專案表. */
  listGalaxies(): Promise<GalaxyMap>;
  /** Promotes a shared-folder project (nebula) to a galaxy, or undoes it. Git projects are always galaxies. */
  setGalaxyPromotion(projectKey: string, promoted: boolean): Promise<GalaxyMap>;
  /** "Arrange once": re-lays out every group by collaboration. Only on the user's request; never automatic. */
  arrangeGalaxies(): Promise<GalaxyMap>;
  readCrystal(nodeId: string): Promise<NodeCrystalDetail | null>;
  /** Grants (award = { reason }) or withdraws (null) a rainbow; expected = CrystalList.awards.version. */
  setAward(nodeId: string, award: { reason: string } | null, expected: FileVersion | null): Promise<AwardWriteResult>;
  setStatus(path: string, status: VaultStatusUpdate, expected: FileVersion): Promise<VaultWriteResult>;
  saveEntry(path: string, text: string, expected: FileVersion): Promise<VaultWriteResult>;
  moveToRecycle(path: string, expected: FileVersion): Promise<VaultRecycleResult>;
  restoreFromRecycle(path: string, expected: RecycledVersion): Promise<VaultWriteResult>;
  readRecycledEntry(path: string, originalPath: string): Promise<RecycledEntry | null>;
  wake(nodeId: string): Promise<WakeResult>;
  onVaultChanged(callback: (paths: string[]) => void): () => void;
}

export type VaultRequests = Omit<VaultApi, keyof NodeProfileApi | keyof BrandPortraitApi | keyof NodePortraitApi | 'onVaultChanged'> &
  NodeProfileApi & BrandPortraitApi & NodePortraitApi;

export const vaultChannels = {
  getVaultInfo: 'vault:get-info',
  chooseVault: 'vault:choose',
  getSettings: 'vault:get-settings',
  setSettings: 'vault:set-settings',
  getBrandPortraitSettings: 'vault:get-brand-portrait-settings',
  chooseBrandPortraitFolder: 'vault:choose-brand-portrait-folder',
  clearBrandPortraitFolder: 'vault:clear-brand-portrait-folder',
  chooseNodePortrait: 'vault:choose-node-portrait',
  clearNodePortrait: 'vault:clear-node-portrait',
  listEntries: 'vault:list-entries',
  readEntry: 'vault:read-entry',
  search: 'vault:search',
  searchNodes: 'vault:search-nodes',
  listCrystals: 'vault:list-crystals',
  listGalaxies: 'vault:list-galaxies',
  setGalaxyPromotion: 'vault:set-galaxy-promotion',
  arrangeGalaxies: 'vault:arrange-galaxies',
  readCrystal: 'vault:read-crystal',
  readNodeProfile: 'vault:read-node-profile',
  readProfileForEdit: 'vault:read-profile-for-edit',
  saveProfileBody: 'vault:save-profile-body',
  requestWake: 'vault:request-wake',
  setAward: 'vault:set-award',
  setStatus: 'vault:set-status',
  saveEntry: 'vault:save-entry',
  moveToRecycle: 'vault:move-to-recycle',
  restoreFromRecycle: 'vault:restore-from-recycle',
  readRecycledEntry: 'vault:read-recycled-entry',
  wake: 'vault:wake',
  onVaultChanged: 'vault:changed',
} as const satisfies Record<keyof VaultApi, string>;
