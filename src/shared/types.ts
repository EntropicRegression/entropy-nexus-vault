import type { HeatInfo } from './heat';
import type { Point3 } from './projection';
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
  key: string;
  /** Display alias; filesystem paths stay in the main process. */
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

export interface MemoryEntry extends FileVersion {
  path: string;
  writable: boolean;
  title: string;
  summary: string;
  kind: MemoryKind;
  shelf: Shelf | null;
  scope: MemoryScope;
  subtype: string;
  status: string;
  /** Stable, opaque project key. */
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

export interface MemoryEntryDetail extends MemoryEntry {
  attributes: [string, FrontMatterValue][];
  body: string;
  review: string;
  supersessionChain: SupersessionLink[];
  caseReferences: string[];
}

export interface NodeCrystal {
  nodeId: string;
  name: string;
  /** The console's 角色: the portrait folder name (e.g. claude), not a job title. null when there is none. */
  role: string | null;
  /** 未知: no console statistics exist for this live profile, so its presence on the console cannot be told. */
  status: '線上' | '休眠' | '封存' | '未知';
  canWake: boolean;
  cliRecordExists?: boolean;
  projectNames: string[];
  avatarUrl?: string | null;
  portraitUrl?: string | null;
  glow?: 'white';
}

/**
 * A node matched by the downstairs search. matchedIn names the first field that contains the first term.
 * 立繪角色: the console's 角色 field is the node's portrait folder name, not a job title.
 */
export interface NodeHit {
  nodeId: string;
  name: string;
  role: string | null;
  status: NodeCrystal['status'];
  matchedIn: '名稱' | '立繪角色' | '特長' | '側寫';
  avatarUrl?: string | null;
}

export type CrystalLink =
  | { kind: 'lineage'; from: string; to: string }
  | { kind: 'delegate'; from: string; to: string; count: number; lastAt: string }
  | { kind: 'meeting'; nodeIds: string[]; count: number }
  /** projectKey is an opaque p_ key (from 專案ID, or the name for older data); projectName is for display only. */
  | { kind: 'project'; nodeIds: string[]; projectKey: string; projectName: string };

export interface CrystalList {
  crystals: (NodeCrystal & { position: Point3 })[];
  links: CrystalLink[];
}

export interface CrystalStats {
  tasks: number | null;
  completed: number | null;
  completionRate: number | null;
  accepted: number | null;
  rejected: number | null;
  cases: number | null;
}

export interface NodeCrystalDetail extends NodeCrystal {
  profile: MemoryEntryDetail | null;
  stats: CrystalStats | null;
  archives: Array<{ path: string; archivedAt: string }>;
  relatedEntries: MemoryEntry[];
  confirmedCaseCount: number;
  specialty: string;
  workflow: string;
  review: string;
  /** 1 − 退回/完成. The console accepts finished tasks by default, so only rejections carry a user signal. */
  notRejectedRate: number | null;
  consoleAppendixCount: number;
}

export type VaultWriteFailure = {
  ok: false;
  reason: 'conflict' | 'missing' | 'occupied' | 'io' | 'legacy' | 'readonly' | 'recycle-io';
  current?: FileVersion;
  residualPath?: string;
};
export type VaultWriteResult = ({ ok: true } & FileVersion) | VaultWriteFailure;
export interface RecycledVersion extends FileVersion { originalPath: string }
export type VaultRecycleResult = ({ ok: true; recycledPath: string } & RecycledVersion) | VaultWriteFailure;
export interface RecycledEntry extends FileVersion { title: string; body: string; review: string }

export type WakeResult =
  | { ok: true }
  | { ok: false; nodeName: string | null; sessionId: string | null };
