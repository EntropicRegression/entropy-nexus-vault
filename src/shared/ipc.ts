import type {
  CrystalList,
  EntryFilter,
  FileVersion,
  MemoryEntry,
  MemoryEntryDetail,
  NodeCrystalDetail,
  VaultInfo,
  VaultStatusUpdate,
  VaultWriteResult,
  WakeResult,
} from './types';

export interface VaultApi {
  getVaultInfo(): Promise<VaultInfo>;
  chooseVault(): Promise<VaultInfo | null>;
  listEntries(filter: EntryFilter): Promise<MemoryEntry[]>;
  readEntry(path: string): Promise<MemoryEntryDetail | null>;
  search(query: string, filter: EntryFilter): Promise<MemoryEntry[]>;
  listCrystals(): Promise<CrystalList>;
  readCrystal(nodeId: string): Promise<NodeCrystalDetail | null>;
  setStatus(path: string, status: VaultStatusUpdate, expected: FileVersion): Promise<VaultWriteResult>;
  saveEntry(path: string, text: string, expected: FileVersion): Promise<VaultWriteResult>;
  moveToRecycle(path: string, expected: FileVersion): Promise<VaultWriteResult>;
  restoreFromRecycle(path: string): Promise<VaultWriteResult>;
  wake(nodeId: string): Promise<WakeResult>;
  onVaultChanged(callback: (paths: string[]) => void): () => void;
}

export type VaultRequests = Omit<VaultApi, 'onVaultChanged'>;

export const vaultChannels = {
  getVaultInfo: 'vault:get-info',
  chooseVault: 'vault:choose',
  listEntries: 'vault:list-entries',
  readEntry: 'vault:read-entry',
  search: 'vault:search',
  listCrystals: 'vault:list-crystals',
  readCrystal: 'vault:read-crystal',
  setStatus: 'vault:set-status',
  saveEntry: 'vault:save-entry',
  moveToRecycle: 'vault:move-to-recycle',
  restoreFromRecycle: 'vault:restore-from-recycle',
  wake: 'vault:wake',
  onVaultChanged: 'vault:changed',
} as const satisfies Record<keyof VaultApi, string>;
