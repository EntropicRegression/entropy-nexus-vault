import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { HeatRecall } from '../../shared/heat';
import type { CrystalLink, CrystalStats, NodeCrystal } from '../../shared/types';
import { opaqueKey } from './privacy';
import { memoryPath } from './scan';

export const heatFilename = '.nexus-heat.json';
export const statsFilename = '.nexus-stats.json';

type ActivityLink = Extract<CrystalLink, { kind: 'delegate' | 'meeting' }>;

export interface VaultStatsNode {
  name: string;
  role: string | null;
  status: NodeCrystal['status'];
  stats: CrystalStats;
  projectNames: string[];
  /**
   * Opaque project keys aligned with projectNames: from 專案ID when present, otherwise from the name. recentTasks is
   * 專案任務數 (tasks in the last 90 days), null when the file has no such list.
   */
  projects: { key: string; name: string; hasProjectId: boolean; recentTasks: number | null }[];
  avatarPath: string | null;
  portraitPath: string | null;
  backend: string | null;
  sessionId: string | null;
  canWake: boolean;
  cliRecordExists?: boolean;
  /** 總管 (console 2026-11-22): the current chief; absent in older files. */
  chief: boolean;
}

export type ProjectType = 'git' | '資料夾';

export interface VaultStatsSnapshot {
  updatedAt: string;
  portraitsDir: string;
  nodes: ReadonlyMap<string, VaultStatsNode>;
  activity: ActivityLink[];
  /** 專案表 by opaque project key (console 2026-11-22); null for older files without it. */
  projectTypes: ReadonlyMap<string, ProjectType> | null;
  /** 專案表 names by opaque project key (display only). */
  projectNames: ReadonlyMap<string, string>;
  /** 協作不含總管 / 同席不含總管 (last 30 days, chief already removed by the console); empty in older files. */
  galaxyActivity: { delegations: { from: string; to: string; count: number }[]; meetings: { nodeIds: string[]; count: number }[] };
}

export interface SidecarSnapshot {
  heat: ReadonlyMap<string, HeatRecall>;
  stats: VaultStatsSnapshot | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === 'string');
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isRate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function decodeHeat(value: unknown): ReadonlyMap<string, HeatRecall> | undefined {
  if (!isRecord(value)) return undefined;
  const heat = new Map<string, HeatRecall>();
  for (const [key, record] of Object.entries(value)) {
    const path = memoryPath(key);
    if (!path) continue;
    if (!isRecord(record) || !isCount(record.召回次數) ||
        (record.最後召回 != null && typeof record.最後召回 !== 'string')) continue;
    heat.set(path.toLowerCase(), {
      count: record.召回次數,
      lastRecalledAt: stringValue(record.最後召回),
    });
  }
  return heat;
}

function statsNodeStatus(value: unknown): VaultStatsNode['status'] | undefined {
  switch (value) {
    case '線上':
    case '現役':
    case '忙碌': return '線上';
    case '休眠': return '休眠';
    case '封存':
    case '終止':
    case '已終止': return '封存';
    default: return undefined;
  }
}

function decodeStatsNode(value: unknown): VaultStatsNode | undefined {
  if (!isRecord(value) || !isRecord(value.session)) return undefined;
  const {
    名稱: name, 任務數: tasks, 完成數: completed, 完成率: completionRate,
    驗收數: accepted, 退回數: rejected, 判例數: cases, 專案: projectNames,
  } = value;
  const status = statsNodeStatus(value.狀態);
  // 專案ID (console 2026-11-22) runs parallel to 專案; older files omit it, and a mismatched list is ignored.
  const projectIds = isStringList(value.專案ID) && isStringList(projectNames) && value.專案ID.length === projectNames.length
    ? value.專案ID : null;
  const recent = Array.isArray(value.專案任務數) && value.專案任務數.every(isCount) && isStringList(projectNames) &&
    value.專案任務數.length === projectNames.length ? value.專案任務數 as number[] : null;
  if (typeof name !== 'string' || !status ||
      !isCount(tasks) || !isCount(completed) || !(completionRate === null || isRate(completionRate)) ||
      !isCount(accepted) || !isCount(rejected) || !isCount(cases) || !isStringList(projectNames)) return undefined;
  return {
    name,
    role: stringValue(value.角色),
    status,
    stats: { tasks, completed, completionRate, accepted, rejected, cases },
    projectNames,
    projects: projectNames.map((name, index) => {
      const id = projectIds?.[index];
      return { key: opaqueKey('p', id || name), name, hasProjectId: Boolean(id?.trim()), recentTasks: recent?.[index] ?? null };
    }),
    avatarPath: stringValue(value.頭像路徑),
    portraitPath: stringValue(value.立繪路徑),
    backend: stringValue(value.session.後台),
    sessionId: stringValue(value.session.sessionId),
    canWake: status === '封存' && value.session.可接回 === true,
    chief: value.總管 === true,
    ...(typeof value.session.CLI有紀錄 === 'boolean' ? { cliRecordExists: value.session.CLI有紀錄 } : {}),
  };
}

function decodeActivity(dispatches: unknown[], meetings: unknown[]): ActivityLink[] {
  const activity: ActivityLink[] = [];
  for (const value of dispatches) {
    if (!isRecord(value) || typeof value.從 !== 'string' || typeof value.到 !== 'string' ||
        !isCount(value.次數) || typeof value.最後 !== 'string') continue;
    activity.push({ kind: 'delegate', from: value.從, to: value.到, count: value.次數, lastAt: value.最後 });
  }
  for (const value of meetings) {
    if (!isRecord(value) || !isStringList(value.節點) || !isCount(value.次數)) continue;
    activity.push({ kind: 'meeting', nodeIds: value.節點, count: value.次數 });
  }
  return activity;
}

function decodeStats(value: unknown): VaultStatsSnapshot | undefined {
  if (!isRecord(value) || typeof value.更新時間 !== 'string' || !Number.isFinite(Date.parse(value.更新時間)) ||
      typeof value.圖像目錄 !== 'string' || !isRecord(value.節點) ||
      !Array.isArray(value.協作) || !Array.isArray(value.同席)) return undefined;

  const nodes = new Map<string, VaultStatsNode>();
  for (const [id, rawNode] of Object.entries(value.節點)) {
    const node = decodeStatsNode(rawNode);
    if (id.trim() && node) nodes.set(id, node);
  }
  const activity = decodeActivity(value.協作, value.同席);
  let projectTypes: Map<string, ProjectType> | null = null;
  const tableNames = new Map<string, string>();
  if (isRecord(value.專案表)) {
    projectTypes = new Map();
    for (const [id, project] of Object.entries(value.專案表)) {
      if (!id.trim() || !isRecord(project) || (project.類型 !== 'git' && project.類型 !== '資料夾')) continue;
      const key = opaqueKey('p', id);
      projectTypes.set(key, project.類型);
      tableNames.set(key, stringValue(project.名稱) ?? '未命名專案');
    }
  }
  const noChief = decodeActivity(Array.isArray(value.協作不含總管) ? value.協作不含總管 : [],
    Array.isArray(value.同席不含總管) ? value.同席不含總管 : []);
  const galaxyActivity = {
    delegations: noChief.flatMap((link) => link.kind === 'delegate' ? [{ from: link.from, to: link.to, count: link.count }] : []),
    meetings: noChief.flatMap((link) => link.kind === 'meeting' ? [{ nodeIds: link.nodeIds, count: link.count }] : []),
  };
  return { updatedAt: value.更新時間, portraitsDir: value.圖像目錄, nodes, activity, projectTypes, projectNames: tableNames, galaxyActivity };
}

async function readSidecar<T>(path: string, decode: (value: unknown) => T | undefined, previous: T) {
  let text: string;
  try {
    if (!(await lstat(path)).isFile()) return { value: previous, cacheable: true };
    text = await readFile(path, 'utf8');
  } catch (error) {
    const missing = typeof error === 'object' && error !== null && 'code' in error &&
      (error.code === 'ENOENT' || error.code === 'ENOTDIR');
    // 暫時鎖定不會改變檔案版本，下次查詢仍要重試。
    return { value: previous, cacheable: missing };
  }
  try {
    const value: unknown = JSON.parse(text.replace(/^\uFEFF/, ''));
    return { value: decode(value) ?? previous, cacheable: true };
  } catch {
    return { value: previous, cacheable: true };
  }
}

export async function readSidecars(root: string, previous: SidecarSnapshot): Promise<{
  snapshot: SidecarSnapshot;
  cacheable: boolean;
}> {
  const [heat, stats] = await Promise.all([
    readSidecar(join(root, heatFilename), decodeHeat, previous.heat),
    readSidecar(join(root, statsFilename), decodeStats, previous.stats),
  ]);
  return { snapshot: { heat: heat.value, stats: stats.value }, cacheable: heat.cacheable && stats.cacheable };
}
