import type { CrystalLink, CrystalStats, MemoryEntry, NodeCrystal } from '../../shared/types';
import { markdownHeadings, memoryTimestamp } from './entry';
import type { ParsedEntry } from './entry';
import { field } from './frontmatter';
import { lineageReference } from './links';
import type { VaultLinks } from './links';
import type { VaultStatsSnapshot } from './sidecars';

interface Archive {
  parsed: ParsedEntry;
  archivedAt: string;
  timestamp: number;
}

interface NodeFiles {
  profiles: ParsedEntry[];
  archives: Archive[];
}

export interface CrystalRecord {
  crystal: NodeCrystal;
  profile: ParsedEntry | undefined;
  stats: CrystalStats | null;
  archives: Array<{ path: string; archivedAt: string }>;
  relatedEntries: MemoryEntry[];
}

export function profileHighlights(profile: ParsedEntry | undefined, stats: CrystalStats | null) {
  const lines = profile?.markdown.split(/\r?\n/) ?? [];
  const sections = markdownHeadings(lines).filter(({ level }) => level <= 2);
  const isAppendix = (title: string) => /^主控台補充(?:\s*[（(].*[）)])?$/.test(title);
  const firstAppendix = sections.findIndex(({ level, title }) => level === 2 && isAppendix(title));
  function section(title: string) {
    const index = sections.findIndex((heading, offset) =>
      heading.level === 2 && heading.title === title && (firstAppendix === -1 || offset < firstAppendix));
    if (index < 0) return '';
    return lines.slice(sections[index].line + 1, sections[index + 1]?.line ?? lines.length).join('\n').trim();
  }
  const paragraph = section('特長').split(/\n[ \t]*\n/, 1)[0].replace(/^[-+*]\s+/, '').replace(/\s+/g, ' ').trim();
  const specialty = /^.+?(?:[。！？!?]|\.(?=\s|$)|$)/.exec(paragraph)?.[0] ?? '';
  const { completed, rejected } = stats ?? {};
  const notRejectedRate = completed != null && rejected != null && completed > 0
    ? Math.max(0, 1 - rejected / completed) : null;
  return {
    specialty, workflow: section('解決問題的流程'), review: section('回顧'),
    notRejectedRate,
    consoleAppendixCount: sections.filter(({ level, title }) => level === 2 && isAppendix(title)).length,
  };
}

function archiveInfo(parsed: ParsedEntry): Archive {
  const written = field(parsed.attributes, '封存時間', 'archivedAt');
  const fileDate = /-(\d{4}-\d{2}-\d{2})(?:-\d+)?\.md$/i.exec(parsed.entry.path)?.[1];
  const archivedAt = memoryTimestamp(written) === undefined ? fileDate ?? new Date(parsed.entry.updatedAt).toISOString() : written;
  return { parsed, archivedAt, timestamp: memoryTimestamp(archivedAt) ?? parsed.entry.updatedAt };
}

const countFields = {
  tasks: '任務數',
  completed: '完成數',
  accepted: '驗收數',
  rejected: '退回數',
  cases: '判例數',
} as const;

function archiveStats(archive: ParsedEntry | undefined): CrystalStats | null {
  const attributes = archive?.attributes;
  if (!attributes || !Object.values(countFields).some((key) => attributes.has(key))) return null;
  const count = (key: string): number | null => {
    const raw = field(attributes, key);
    const value = Number(raw);
    return raw && Number.isSafeInteger(value) && value >= 0 ? value : null;
  };
  const rawRate = field(attributes, '完成率');
  const rate = rawRate ? Number(rawRate) : NaN;
  return {
    tasks: count(countFields.tasks),
    completed: count(countFields.completed),
    accepted: count(countFields.accepted),
    rejected: count(countFields.rejected),
    cases: count(countFields.cases),
    completionRate: rate >= 0 && rate <= 1 ? rate : null,
  };
}

export function buildCrystals(entries: ParsedEntry[], links: VaultLinks, snapshot: VaultStatsSnapshot | null) {
  const files = new Map<string, NodeFiles>();
  const idByPath = new Map<string, string>();
  const casesByNode = new Map<string, MemoryEntry[]>();
  for (const parsed of entries) {
    const { entry } = parsed;
    if (entry.kind === 'case') {
      for (const id of new Set([entry.nodeId, ...entry.participantNodeIds].filter(Boolean))) {
        const related = casesByNode.get(id) ?? [];
        related.push(entry);
        casesByNode.set(id, related);
      }
    } else if (entry.kind === 'node') {
      // 舊檔缺少節點 ID 時保留獨立水晶，避免把同名的不同節點合併。
      const id = entry.nodeId || 'legacy:' + entry.path;
      const node = files.get(id) ?? { profiles: [], archives: [] };
      if (entry.status === '封存' || /^nodes\/封存\//i.test(entry.path)) {
        node.archives.push(archiveInfo(parsed));
      } else {
        node.profiles.push(parsed);
      }
      files.set(id, node);
      idByPath.set(entry.path, id);
    }
  }

  const records = new Map<string, CrystalRecord>();
  const nodeIds = new Set([...files.keys(), ...(snapshot?.nodes.keys() ?? [])]);
  const projectMembers = new Map<string, { name: string; members: string[] }>();
  for (const nodeId of nodeIds) {
    const statsNode = snapshot?.nodes.get(nodeId);
    const node = files.get(nodeId);
    const archives = node?.archives.sort((a, b) => b.timestamp - a.timestamp ||
      b.parsed.entry.path.localeCompare(a.parsed.entry.path, 'zh-Hant', { numeric: true })) ?? [];
    const latestArchive = archives[0]?.parsed;
    const liveProfile = node?.profiles.sort((a, b) => b.entry.updatedAt - a.entry.updatedAt)[0];
    // Without console statistics a live profile could be on the board or long deleted; do not claim it is dormant.
    const status = statsNode?.status ?? (liveProfile ? '未知' : '封存');
    const profile = status === '封存' ? latestArchive ?? liveProfile : liveProfile ?? latestArchive;
    const relatedEntries = casesByNode.get(nodeId) ?? [];
    const projects = new Map<string, string>();
    for (const { key, name } of statsNode?.projects ?? []) if (key && !projects.has(key)) projects.set(key, name);
    for (const caseEntry of relatedEntries) {
      if (caseEntry.projectId && !projects.has(caseEntry.projectId)) projects.set(caseEntry.projectId, caseEntry.projectName);
    }
    const projectNames = [...new Set([...projects.values()].filter(Boolean))];
    const fileName = profile && field(profile.attributes, '節點', '名稱', 'name');
    const fileRole = profile && field(profile.attributes, '角色', 'role');
    const crystal: NodeCrystal = {
      nodeId,
      status,
      name: statsNode?.name || fileName || profile?.entry.title || nodeId,
      role: statsNode?.role ?? (fileRole && fileRole !== '(無)' ? fileRole : null),
      canWake: statsNode?.canWake ?? false,
      cliRecordExists: statsNode?.cliRecordExists,
      projectNames,
      glow: 'white',
    };

    records.set(nodeId, {
      crystal,
      profile,
      stats: statsNode?.stats ?? archiveStats(latestArchive),
      archives: archives.map(({ parsed, archivedAt }) => ({ path: parsed.entry.path, archivedAt })),
      relatedEntries,
    });
    for (const [key, name] of projects) {
      const project = projectMembers.get(key) ?? { name, members: [] };
      project.members.push(nodeId);
      projectMembers.set(key, project);
    }
  }

  const crystalLinks: CrystalLink[] = [];
  for (const [nodeId, record] of records) {
    if (!record.profile) continue;
    const reference = lineageReference(record.profile);
    const target = reference && links.resolve(reference, record.profile.entry.path);
    const from = target ? idByPath.get(target.entry.path) : undefined;
    if (from && from !== nodeId) crystalLinks.push({ kind: 'lineage', from, to: nodeId });
  }
  for (const link of snapshot?.activity ?? []) {
    if (link.kind === 'delegate') {
      if (link.from !== link.to && records.has(link.from) && records.has(link.to)) crystalLinks.push(link);
    } else {
      const participants = [...new Set(link.nodeIds)].filter((nodeId) => records.has(nodeId));
      if (participants.length > 1) crystalLinks.push({ ...link, nodeIds: participants });
    }
  }
  for (const [projectKey, { name, members }] of projectMembers) {
    if (members.length > 1) crystalLinks.push({ kind: 'project', projectKey, projectName: name, nodeIds: members });
  }

  return { records, links: crystalLinks };
}
