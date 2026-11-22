import type { ProjectType } from './galaxies';
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

import type { GalaxyBridge, GalaxyGroup, GalaxyMembership } from './galaxies';
import type { Point2 } from './galaxy-layout';
import type { GlowAward, GlowTier, Richness } from './glow';

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

export interface CrystalProject {
  /** Opaque project identifier. Older statistics may only have the display name. */
  key?: string;
  name: string;
  kind?: ProjectType;
}

export interface NodeCrystal {
  nodeId: string;
  name: string;
  /** The console's 角色: the portrait folder name (e.g. claude), not a job title. null when there is none. */
  role: string | null;
  /** 未知: no console statistics exist for this live profile, so its presence on the console cannot be told. */
  status: '線上' | '休眠' | '封存' | '未知';
  canWake: boolean;
  /** First sentence of the first user-authored 特長 section, when present. */
  specialty?: string;
  cliRecordExists?: boolean;
  projectNames: string[];
  projects?: CrystalProject[];
  avatarUrl?: string | null;
  portraitUrl?: string | null;
  /** Glow tier from the richness score, or rainbow when the user granted one (DESIGN.md §6.9). */
  glow?: GlowTier;
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
  /** State of .vault-awards.json: the version for setAward, and whether the file is damaged (read as no awards). */
  awards?: { version: FileVersion | null; corrupt: boolean };
}

/**
 * Project galaxies (DESIGN.md §6.10). enabled: false when the stats have no 專案表 — the flat star map stays and
 * nothing else changes. Groups are keyed by opaque p_ keys; raw 專案ID values never appear.
 */
export type GalaxyMap =
  | { enabled: false }
  | {
    enabled: true;
    /** Galaxies (git repos and promoted folders) and nebulae (shared folders), each with its fixed position. */
    groups: (GalaxyGroup & { position: Point2 })[];
    /** Current chief(s): the hub at the centre. */
    hub: string[];
    /** Nodes without a project: the outer star-dust belt. */
    outer: string[];
    membership: Record<string, GalaxyMembership>;
    /** Collaboration between galaxies over the last 30 days (delegations, meetings, dual residents). */
    bridges: GalaxyBridge[];
  };

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
  /** Score, parts and caps behind the glow tier (M5c). */
  richness?: Richness;
  award?: GlowAward | null;
}

export type VaultWriteFailure = {
  ok: false;
  reason: 'conflict' | 'missing' | 'occupied' | 'io' | 'legacy' | 'readonly' | 'recycle-io';
  current?: FileVersion;
  residualPath?: string;
};
export type VaultWriteResult = ({ ok: true } & FileVersion) | VaultWriteFailure;
/** setAward: corrupt = .vault-awards.json is damaged and is left untouched; invalid = bad node, version or reason. */
export type AwardWriteResult =
  /** masked: how many key- or token-like strings in the reason were replaced with [已遮罩] before writing. */
  | ({ ok: true; award: GlowAward | null; masked: number } & FileVersion)
  | { ok: false; reason: 'conflict' | 'corrupt' | 'invalid' | 'io'; current?: FileVersion | null };
export interface RecycledVersion extends FileVersion { originalPath: string }
export type VaultRecycleResult = ({ ok: true; recycledPath: string } & RecycledVersion) | VaultWriteFailure;
export interface RecycledEntry extends FileVersion { title: string; body: string; review: string }

export type WakeResult =
  | { ok: true }
  | { ok: false; nodeName: string | null; sessionId: string | null };

export interface ConsoleAppendix {
  /** The original UTC timestamp as written in the heading. */
  at: string;
  /** Formatted in the main process's local time zone, with a label. */
  localTime: string | null;
  text: string;
  review: string;
}

export interface ReadableNodeProfile {
  nodeId: string;
  source: { kind: 'live' | 'archived'; path: string; archivedAt: string | null };
  body: string;
  review: string;
  consoleAppendices: ConsoleAppendix[];
  consoleAppendixCount: number;
}

export interface ProfileEditVersion extends FileVersion {
  identity: string;
  editToken: string;
}

export type ProfilePlaceholderIssue = 'missing' | 'duplicate' | 'modified-or-unknown';
export type ProfilePlaceholderFailure =
  | { ok: false; reason: 'invalid-placeholders'; issue: 'missing'; missingPlaceholders: number[]; message: string }
  | { ok: false; reason: 'invalid-placeholders'; issue: Exclude<ProfilePlaceholderIssue, 'missing'> };

export interface ProfileSaveOptions {
  /** Must match exactly the missing numbers in the current edit. */
  acknowledgedRemovals?: readonly number[];
}

export type ProfileFailure =
  | VaultWriteFailure
  | { ok: false; reason: 'encoding' | 'invalid-input' | 'edit-session' | 'appendix-marker' }
  | ProfilePlaceholderFailure;

export type ProfileEditResult =
  | { ok: true; body: string; version: ProfileEditVersion; isArchive: boolean; archiveNotice: string | null }
  | ProfileFailure;
export type ProfileSaveResult = { ok: true; version: ProfileEditVersion } | ProfileFailure;
export type RequestWakeResult = { ok: true } | {
  ok: false;
  reason: 'invalid-node' | 'not-wakeable' | 'unregistered' | 'rejected';
  nodeName: string | null;
  sessionId: string | null;
};
