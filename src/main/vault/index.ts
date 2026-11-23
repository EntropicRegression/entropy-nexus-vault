import { searchTerms } from '../../shared/node-search';
import { join } from 'node:path';
import { heatDecayAt } from '../../shared/heat';
import { compareMemoirChapters } from '../../shared/shelves';
import type { EntryFilter, MemoryEntry, MemoryEntryDetail, NodeCrystalDetail, NodeHit, ReadableNodeProfile } from '../../shared/types';
import type { GalaxyInput } from '../../shared/galaxies';
import { buildCrystals, profileHighlights } from './crystals';
import { entryFromFile } from './entry';
import type { ParsedEntry } from './entry';
import { field } from './frontmatter';
import { profileSections } from './profile-content';
import { inRecycle, VaultLinks } from './links';
import { memoryPath, sameVaultVersion, scanVault, vaultVersion } from './scan';
import type { VaultVersion } from './scan';
import { heatFilename, readSidecars, statsFilename } from './sidecars';
import type { SidecarSnapshot } from './sidecars';
import { publicAttributes } from './privacy';

function matches(entry: MemoryEntry, filter: EntryFilter): boolean {
  return (filter?.includeSuperseded === true || !entry.superseded) &&
    (!filter?.kind || entry.kind === filter.kind) &&
    (!filter?.shelf || entry.shelf === filter.shelf) &&
    (!filter?.subtype || entry.subtype === filter.subtype) &&
    (!filter?.status || (Array.isArray(filter.status) ? filter.status.includes(entry.status) : entry.status === filter.status)) &&
    (!filter?.projectId || entry.projectId === filter.projectId) &&
    (!filter?.nodeId || entry.nodeId === filter.nodeId || entry.participantNodeIds.includes(filter.nodeId)) &&
    (!filter?.nodeLabel || entry.nodeLabel === filter.nodeLabel);
}

export class VaultSnapshot {
  private readonly entries: Map<string, ParsedEntry>;
  private readonly links: VaultLinks;
  private readonly crystals: ReturnType<typeof buildCrystals>;
  private readonly searchText = new Map<string, string>();

  constructor(private readonly root: string, parsed: ParsedEntry[], readonly sidecars: SidecarSnapshot) {
    this.entries = new Map(parsed.map((entry) => [entry.entry.path.toLowerCase(), entry]));
    this.links = new VaultLinks(parsed);
    this.crystals = buildCrystals(parsed, this.links, sidecars.stats);
    for (const { entry, body, attributes } of parsed) {
      entry.previousCount = this.links.supersessionChain(entry.path).length;
      const { title, caseId, nodeLabel, nodeIds } = entry;
      this.searchText.set(entry.path, [
        title, caseId, body, nodeLabel, ...nodeIds,
        ...nodeIds.map((id) => this.crystals.records.get(id)?.crystal.name),
        field(attributes, '關鍵字', 'keywords'), field(attributes, '案由'),
      ].join('\n').toLowerCase());
    }
  }

  listEntries(filter: EntryFilter = {}): MemoryEntry[] {
    return [...this.entries.values()].map(({ entry }) => entry).filter((entry) => matches(entry, filter));
  }

  async readEntry(relative: string): Promise<MemoryEntryDetail | null> {
    const path = memoryPath(relative);
    const parsed = path ? this.entries.get(path.toLowerCase()) : undefined;
    return parsed ? this.entryDetail(parsed) : null;
  }

  search(query: string, filter: EntryFilter = {}): MemoryEntry[] {
    if (typeof query !== 'string') return [];
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return [...this.entries.values()].filter(({ entry }) => {
      if (!matches(entry, filter)) return false;
      const text = this.searchText.get(entry.path) ?? '';
      return terms.every((term) => text.includes(term));
    }).map(({ entry }) => entry);
  }

  /** Lower-cased search fields per node, built once per snapshot (a snapshot is one vault version). */
  private nodeSearchIndex: { hit: Omit<NodeHit, 'matchedIn'>; fields: [NodeHit['matchedIn'], string][] }[] | undefined;

  private searchIndex() {
    this.nodeSearchIndex ??= [...this.crystals.records.values()].map(({ crystal, profile }) => ({
      hit: { nodeId: crystal.nodeId, name: crystal.name, role: crystal.role, status: crystal.status, brand: crystal.brand },
      fields: ([
        ['名稱', crystal.name], ['立繪角色', crystal.role ?? ''],
        ['特長', crystal.specialty ?? ''], ['側寫', profile?.body ?? ''],
      ] as [NodeHit['matchedIn'], string][]).map(([label, text]) => [label, text.toLowerCase()]),
    }));
    return this.nodeSearchIndex;
  }

  /**
   * Nodes whose name, portrait role, specialty or profile body (never 回顧) contain every term (DESIGN.md §6.6.3).
   * The console's 角色 is the name of the node's portrait folder, not a job title (M5b review S6).
   */
  searchNodes(query: string): NodeHit[] {
    const terms = searchTerms(query);
    if (!terms.length) return [];
    const hits: NodeHit[] = [];
    for (const { hit, fields } of this.searchIndex()) {
      if (!terms.every((term) => fields.some(([, text]) => text.includes(term)))) continue;
      hits.push({ ...hit, matchedIn: fields.find(([, text]) => text.includes(terms[0]))![0] });
    }
    const rank: NodeHit['matchedIn'][] = ['名稱', '立繪角色', '特長', '側寫'];
    return hits.sort((a, b) => rank.indexOf(a.matchedIn) - rank.indexOf(b.matchedIn) || a.name.localeCompare(b.name, 'zh-Hant'));
  }

  listCrystals() {
    return {
      crystals: [...this.crystals.records.values()].map(({ crystal }) => crystal),
      links: this.crystals.links,
    };
  }

  /**
   * Input for the project galaxies (DESIGN.md §6.10), or null when the stats have no 專案表 (the flat star map stays).
   * Every crystal of listCrystals() is a node here, so the two views always cover the same nodes.
   */
  galaxyInput(promoted: ReadonlySet<string>): GalaxyInput | null {
    const stats = this.sidecars.stats;
    if (!stats?.projectTypes) return null;
    const projects = new Map([...stats.projectTypes].map(([key, type]) =>
      [key, { key, type, name: stats.projectNames.get(key) ?? '未命名專案' }]));
    const nodes = [...this.crystals.records].map(([nodeId, record]) => {
      const statsNode = stats.nodes.get(nodeId);
      return {
        nodeId,
        chief: statsNode?.chief ?? false,
        projects: (statsNode?.projects ?? []).map(({ key, recentTasks }) => ({ key, recentTasks })),
        // Handled cases decide the home only as a fallback; unconfirmed ones count, rejected ones do not (a rejected
        // case may even name the wrong project; M5e-a review B1).
        handledCaseProjects: record.relatedEntries
          .filter((entry) => entry.kind === 'case' && entry.nodeId === nodeId && !entry.superseded && entry.projectId &&
            entry.status !== '退回')
          .map((entry) => entry.projectId),
      };
    });
    return { projects, promoted, nodes, ...stats.galaxyActivity };
  }

  /** Richness inputs per node, without the userData peaks (docs/架構.md §9.2). */
  richnessInputs() {
    return new Map([...this.crystals.records].map(([nodeId, record]) => [nodeId, record.richness]));
  }

  hasNode(nodeId: string): boolean {
    return typeof nodeId === 'string' && this.crystals.records.has(nodeId);
  }

  hasArchivedNode(nodeId: string): boolean {
    return Boolean(this.crystals.records.get(nodeId)?.archives.length);
  }

  nodeProfilePath(nodeId: string): string | undefined {
    return this.crystals.records.get(nodeId)?.profile?.entry.path;
  }

  readNodeProfile(nodeId: string): ReadableNodeProfile | null {
    const record = this.crystals.records.get(nodeId);
    if (!record?.profile) return null;
    const { path } = record.profile.entry;
    const archive = record.archives.find((item) => item.path === path);
    const { body, review, appendices } = profileSections(record.profile.markdown);
    return {
      nodeId, body, review, consoleAppendices: appendices, consoleAppendixCount: appendices.length,
      source: { path, kind: archive ? 'archived' : 'live', archivedAt: archive?.archivedAt ?? null },
    };
  }

  wakeNode(nodeId: string) {
    const crystal = this.crystals.records.get(nodeId)?.crystal;
    const sessionId = this.sidecars.stats?.nodes.get(nodeId)?.sessionId ?? null;
    return crystal ? { status: crystal.status, canWake: crystal.canWake, nodeName: crystal.name, sessionId } : null;
  }

  async readCrystal(nodeId: string): Promise<NodeCrystalDetail | null> {
    const record = this.crystals.records.get(nodeId);
    if (!record) return null;
    return {
      ...record.crystal,
      profile: record.profile ? await this.entryDetail(record.profile) : null,
      stats: record.stats,
      archives: record.archives,
      relatedEntries: record.relatedEntries,
      memoirEntries: record.memoirEntries.filter((entry) => !entry.superseded).sort(compareMemoirChapters),
      meetingEntries: record.meetingEntries.filter((entry) => !entry.superseded)
        .sort((a, b) => b.updatedAt - a.updatedAt || a.path.localeCompare(b.path, 'zh-Hant')),
      confirmedCaseCount: record.relatedEntries.filter((entry) =>
          entry.path.startsWith('cases/') && entry.status === '已確認' && entry.nodeId === nodeId).length,
      ...profileHighlights(record.profile, record.stats),
    };
  }

  private async entryDetail(parsed: ParsedEntry): Promise<MemoryEntryDetail> {
    const supersessionChain = await Promise.all(this.links.supersessionChain(parsed.entry.path).map(async (link) =>
      link.status === 'missing' && await inRecycle(this.root, link.path) ? { ...link, status: 'recycled' as const } : link));
    return {
      ...parsed.entry,
      mtime: parsed.mtime,
      size: parsed.size,
      attributes: publicAttributes(parsed.attributes),
      body: parsed.body,
      review: parsed.review,
      ...(parsed.transcript ? { transcript: parsed.transcript } : {}),
      ...(parsed.memoirSections ? { memoirSections: parsed.memoirSections } : {}),
      supersessionChain,
      caseReferences: this.links.caseReferences(parsed),
    };
  }
}

interface CachedSnapshot {
  snapshot: VaultSnapshot;
  versions: Map<string, VaultVersion>;
  readAt: number;
  nextHeatDecay: number;
}

async function versionsStillMatch(versions: Map<string, VaultVersion>): Promise<boolean> {
  const tracked = [...versions];
  const batchSize = 64;
  for (let start = 0; start < tracked.length; start += batchSize) {
    const matches = await Promise.all(tracked.slice(start, start + batchSize).map(async ([path, version]) =>
      sameVaultVersion(version, await vaultVersion(path))));
    if (matches.includes(false)) return false;
  }
  return true;
}

/** 並發查詢共用同一次讀取；命中時只查已知路徑的中繼資料。 */
export class VaultReader {
  private sidecars: SidecarSnapshot = { heat: new Map(), stats: null };
  private cached: CachedSnapshot | undefined;
  private pending: Promise<VaultSnapshot> | undefined;
  private revision = 0;

  constructor(private readonly root: string, private readonly now: () => number = Date.now) {}

  invalidate(): void {
    this.cached = undefined;
    this.revision++;
  }

  read(): Promise<VaultSnapshot> {
    this.pending ??= this.currentSnapshot().finally(() => { this.pending = undefined; });
    return this.pending;
  }

  private async currentSnapshot(): Promise<VaultSnapshot> {
    while (true) {
      const revision = this.revision;
      const snapshot = await this.readSnapshot(revision);
      if (revision === this.revision) return snapshot;
    }
  }

  private async readSnapshot(revision: number): Promise<VaultSnapshot> {
    const cached = this.cached;
    if (cached && await versionsStillMatch(cached.versions)) {
      const now = this.now();
      if (cached.readAt <= now && now <= cached.nextHeatDecay) return cached.snapshot;
    }
    if (revision === this.revision) this.cached = undefined;

    // 先記錄附檔版本，讀取期間若被替換，下次查詢會重新確認。
    const sidecarVersions = await Promise.all([heatFilename, statsFilename].map(async (name) => {
      const path = join(this.root, name);
      return [path, await vaultVersion(path)] as const;
    }));
    const [scan, sidecarRead] = await Promise.all([scanVault(this.root), readSidecars(this.root, this.sidecars)]);
    const sidecars = sidecarRead.snapshot;
    this.sidecars = sidecars;
    const readAt = this.now();
    let nextHeatDecay = Infinity;
    const parsed = scan.files.map((file) => {
      const recall = sidecars.heat.get(file.path.toLowerCase());
      const decay = heatDecayAt(recall);
      if (decay >= readAt) nextHeatDecay = Math.min(nextHeatDecay, decay);
      return entryFromFile(file, recall, readAt);
    });
    const snapshot = new VaultSnapshot(this.root, parsed, sidecars);
    if (scan.cacheable && sidecarRead.cacheable && revision === this.revision) {
      for (const [path, version] of sidecarVersions) scan.versions.set(path, version);
      this.cached = { snapshot, versions: scan.versions, readAt, nextHeatDecay };
    }
    return snapshot;
  }
}
