import type { HeatInfo } from './heat';
import type { Shelf } from './shelves';

export type { HeatInfo, HeatLevel } from './heat';

export type MemoryKind = 'node' | 'case' | 'knowledge' | 'preference';
export type MemoryScope = '全域' | '專案';
export type VaultStatusUpdate = '已確認' | '退回' | '已完成';
export type FrontMatterValue = string | string[];
export type DeskMode = 'A' | 'B';

export interface ViewSettings {
  deskMode: DeskMode;
  reducedMotion: boolean;
}

export interface VaultInfo {
  path: string;
  exists: boolean;
  wakeAvailable: boolean;
}

export interface FileVersion {
  mtime: number;
  size: number;
}

export interface EntryFilter {
  kind?: MemoryKind;
  subtype?: string;
  status?: string | string[];
  shelf?: Shelf;
  projectId?: string;
  nodeId?: string;
  nodeLabel?: string;
  includeSuperseded?: boolean;
}

export interface MemoryEntry {
  path: string;
  title: string;
  summary: string;
  kind: MemoryKind;
  shelf: Shelf | null;
  scope: MemoryScope;
  subtype: string;
  status: string;
  projectId: string;
  projectName: string;
  nodeId: string;
  nodeLabel: string;
  participantNodeIds: string[];
  nodeIds: string[];
  caseId: string | null;
  updatedAt: number;
  heat: HeatInfo;
  superseded: boolean;
  previousCount: number;
}

export interface SupersessionLink {
  path: string;
  title: string | null;
  caseId: string | null;
  updatedAt: number | null;
  status: 'available' | 'recycled' | 'missing';
}

export interface MemoryEntryDetail extends MemoryEntry, FileVersion {
  attributes: [string, FrontMatterValue][];
  body: string;
  review: string;
  supersessionChain: SupersessionLink[];
  caseReferences: string[];
}

export interface NodeCrystal {
  nodeId: string;
  name: string;
  role: string | null;
  status: '線上' | '休眠' | '封存';
  canWake: boolean;
  projectNames: string[];
  avatarUrl?: string | null;
}

export type CrystalLink =
  | { kind: 'lineage'; from: string; to: string }
  | { kind: 'delegate'; from: string; to: string; count: number; lastAt: string }
  | { kind: 'meeting'; nodeIds: string[]; count: number }
  | { kind: 'project'; nodeIds: string[]; projectName: string };

export interface CrystalList {
  crystals: NodeCrystal[];
  links: CrystalLink[];
}

export interface CrystalStats {
  tasks: number;
  completed: number;
  completionRate: number | null;
  accepted: number;
  rejected: number;
  cases: number;
}

export interface NodeCrystalDetail extends NodeCrystal {
  profile: MemoryEntryDetail | null;
  stats: CrystalStats | null;
  archives: Array<{ path: string; archivedAt: string }>;
  relatedEntries: MemoryEntry[];
}

export type VaultWriteResult =
  | ({ ok: true } & FileVersion)
  | { ok: false; reason: 'conflict' | 'missing' | 'io'; current?: FileVersion };

export type WakeResult =
  | { ok: true }
  | { ok: false; nodeName: string | null; sessionId: string | null };
