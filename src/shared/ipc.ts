import type {
  CrystalList,
  EntryFilter,
  FileVersion,
  MemoryEntry,
  MemoryEntryDetail,
  NodeCrystalDetail,
  NodeHit,
  RecycledEntry,
  RecycledVersion,
  VaultInfo,
  VaultRecycleResult,
  VaultStatusUpdate,
  VaultWriteResult,
  ViewSettings,
  WakeResult,
} from './types';

export interface VaultApi {
  getVaultInfo(): Promise<VaultInfo>;
  chooseVault(): Promise<VaultInfo | null>;
  getSettings(): Promise<ViewSettings>;
  setSettings(patch: Partial<ViewSettings>): Promise<ViewSettings>;
  listEntries(filter: EntryFilter): Promise<MemoryEntry[]>;
  readEntry(path: string): Promise<MemoryEntryDetail | null>;
  search(query: string, filter: EntryFilter): Promise<MemoryEntry[]>;
  searchNodes(query: string): Promise<NodeHit[]>;
  listCrystals(): Promise<CrystalList>;
  readCrystal(nodeId: string): Promise<NodeCrystalDetail | null>;
  setStatus(path: string, status: VaultStatusUpdate, expected: FileVersion): Promise<VaultWriteResult>;
  saveEntry(path: string, text: string, expected: FileVersion): Promise<VaultWriteResult>;
  moveToRecycle(path: string, expected: FileVersion): Promise<VaultRecycleResult>;
  restoreFromRecycle(path: string, expected: RecycledVersion): Promise<VaultWriteResult>;
  readRecycledEntry(path: string, originalPath: string): Promise<RecycledEntry | null>;
  wake(nodeId: string): Promise<WakeResult>;
  onVaultChanged(callback: (paths: string[]) => void): () => void;
}

export type VaultRequests = Omit<VaultApi, 'onVaultChanged'>;

export const vaultChannels = {
  getVaultInfo: 'vault:get-info',
  chooseVault: 'vault:choose',
  getSettings: 'vault:get-settings',
  setSettings: 'vault:set-settings',
  listEntries: 'vault:list-entries',
  readEntry: 'vault:read-entry',
  search: 'vault:search',
  searchNodes: 'vault:search-nodes',
  listCrystals: 'vault:list-crystals',
  readCrystal: 'vault:read-crystal',
  setStatus: 'vault:set-status',
  saveEntry: 'vault:save-entry',
  moveToRecycle: 'vault:move-to-recycle',
  restoreFromRecycle: 'vault:restore-from-recycle',
  readRecycledEntry: 'vault:read-recycled-entry',
  wake: 'vault:wake',
  onVaultChanged: 'vault:changed',
} as const satisfies Record<keyof VaultApi, string>;
