import { join } from 'node:path';
import { heatDecayAt } from '../../shared/heat';
import type { CrystalList, EntryFilter, MemoryEntry, MemoryEntryDetail, NodeCrystalDetail } from '../../shared/types';
import { buildCrystals } from './crystals';
import { entryFromFile } from './entry';
import type { ParsedEntry } from './entry';
import { inRecycle, VaultLinks } from './links';
import { memoryPath, sameVaultVersion, scanVault, vaultVersion } from './scan';
import type { VaultVersion } from './scan';
import { heatFilename, readSidecars, statsFilename } from './sidecars';
import type { SidecarSnapshot } from './sidecars';

function matches(entry: MemoryEntry, filter: EntryFilter): boolean {
  return (filter?.includeSuperseded === true || !entry.superseded) &&
    (!filter?.kind || entry.kind === filter.kind) &&
    (!filter?.subtype || entry.subtype === filter.subtype) &&
    (!filter?.status || entry.status === filter.status) &&
    (!filter?.projectId || entry.projectId === filter.projectId) &&
    (!filter?.nodeId || entry.nodeId === filter.nodeId || entry.participantNodeIds.includes(filter.nodeId)) &&
    (!filter?.nodeLabel || entry.nodeLabel === filter.nodeLabel);
}

export class VaultSnapshot {
  private readonly entries: Map<string, ParsedEntry>;
  private readonly links: VaultLinks;
  private readonly crystals: ReturnType<typeof buildCrystals>;

  constructor(private readonly root: string, parsed: ParsedEntry[], readonly sidecars: SidecarSnapshot) {
    this.entries = new Map(parsed.map((entry) => [entry.entry.path.toLowerCase(), entry]));
    this.links = new VaultLinks(parsed);
    this.crystals = buildCrystals(parsed, this.links, sidecars.stats);
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
    return [...this.entries.values()].filter(({ entry, body }) => {
      if (!matches(entry, filter)) return false;
      const text = [entry.title, entry.caseId, body].join('\n').toLowerCase();
      return terms.every((term) => text.includes(term));
    }).map(({ entry }) => entry);
  }

  listCrystals(): CrystalList {
    return {
      crystals: [...this.crystals.records.values()].map(({ crystal }) => crystal),
      links: this.crystals.links,
    };
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
    };
  }

  private async entryDetail(parsed: ParsedEntry): Promise<MemoryEntryDetail> {
    const supersessionChain = await Promise.all(this.links.supersessionChain(parsed.entry.path).map(async (link) =>
      link.status === 'missing' && await inRecycle(this.root, link.path) ? { ...link, status: 'recycled' as const } : link));
    return {
      ...parsed.entry,
      mtime: parsed.mtime,
      size: parsed.size,
      attributes: Object.fromEntries(parsed.attributes),
      body: parsed.body,
      review: parsed.review,
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
