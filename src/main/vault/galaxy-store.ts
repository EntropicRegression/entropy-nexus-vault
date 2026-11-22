import { randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import type { GalaxyBridge } from '../../shared/galaxies';
import { arrangeGalaxies, placeGalaxies } from '../../shared/galaxy-layout';
import type { Point2 } from '../../shared/galaxy-layout';

/**
 * userData/galaxy-settings.json (folders promoted to galaxies) and userData/galaxy-layout.json (group positions),
 * DESIGN.md §6.10 / docs/架構.md §9.4. Both are kept per vault key, written atomically (temporary file + rename), and
 * hold only opaque v_/p_ keys, coordinates and times — never a path. A damaged file is rebuilt; damaged entries are
 * skipped; a file that stays locked is left untouched (positions still apply for this run).
 */

const vaultKey = /^v_[a-f0-9]{24}$/;
const projectKey = /^p_[a-f0-9]{24}$/;
const transient = new Set(['EBUSY', 'EPERM', 'EACCES', 'EAGAIN']);

export interface StoreOptions {
  readRetryDelays?: readonly number[];
  read?: (file: string) => Promise<string>;
  sleep?: (ms: number) => Promise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error.code === 'string' ? error.code : undefined;
}

/** Shared load / save of `{ 版本: 1, 記憶庫: { <v_key>: T } }`. */
abstract class VaultJsonStore<T> {
  protected vaults = new Map<string, T>();
  private loaded = false;
  protected dirty = false;
  private pending: Promise<unknown> = Promise.resolve();
  private readonly retryDelays: readonly number[];
  private readonly read: (file: string) => Promise<string>;
  private readonly sleep: (ms: number) => Promise<unknown>;

  constructor(private readonly file: string, options: StoreOptions = {}) {
    this.retryDelays = options.readRetryDelays ?? [50, 100, 200];
    this.read = options.read ?? ((path) => readFile(path, 'utf8'));
    this.sleep = options.sleep ?? delay;
  }

  /** Decodes one vault's entry; returns null for a damaged entry and reports skipped items through `skip`. */
  protected abstract decode(value: unknown, skip: () => void): T | null;
  protected abstract encode(value: T): unknown;

  /** Runs one operation at a time, after the file has been read once. */
  protected run<R>(task: (writable: boolean) => Promise<R> | R): Promise<R> {
    const next = this.pending.then(async () => task(await this.load()));
    this.pending = next.catch(() => {});
    return next;
  }

  private async readWithRetry(): Promise<string | null | undefined> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.read(this.file);
      } catch (error) {
        const code = errorCode(error);
        if (code === 'ENOENT') return null;
        if (!code || !transient.has(code) || attempt >= this.retryDelays.length) return undefined;
        await this.sleep(this.retryDelays[attempt]);
      }
    }
  }

  /** True when the file may be written (it was read, or does not exist). */
  private async load(): Promise<boolean> {
    if (this.loaded) return true;
    const raw = await this.readWithRetry();
    if (raw === undefined) return false;
    this.loaded = true;
    if (raw === null) return true;
    let root: unknown = null;
    try { root = JSON.parse(raw); } catch { /* rebuilt below */ }
    if (!isRecord(root) || root.版本 !== 1 || !isRecord(root.記憶庫)) {
      this.dirty = true;
      return true;
    }
    for (const [key, value] of Object.entries(root.記憶庫)) {
      const decoded = vaultKey.test(key) ? this.decode(value, () => { this.dirty = true; }) : null;
      if (decoded === null) this.dirty = true;
      else this.vaults.set(key, decoded);
    }
    return true;
  }

  protected async persist(writable: boolean) {
    if (!writable || !this.dirty) return;
    const temporary = this.file + '.' + randomUUID() + '.tmp';
    try {
      const vaults = Object.fromEntries([...this.vaults].map(([key, value]) => [key, this.encode(value)]));
      await writeFile(temporary, JSON.stringify({ 版本: 1, 記憶庫: vaults }, null, 2) + '\n', { flag: 'wx' });
      await rename(temporary, this.file);
      this.dirty = false;
    } catch {
      // Keep the values for this process and try the file again next time.
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
    }
  }
}

/** Folder projects the user promoted to galaxies, per vault. */
export class GalaxySettingsStore extends VaultJsonStore<Set<string>> {
  protected decode(value: unknown, skip: () => void): Set<string> | null {
    if (!isRecord(value) || !Array.isArray(value.升格)) return null;
    const keys = new Set<string>();
    for (const item of value.升格) {
      if (typeof item === 'string' && projectKey.test(item)) keys.add(item);
      else skip();
    }
    return keys;
  }

  protected encode(value: Set<string>) {
    return { 升格: [...value].sort() };
  }

  promoted(key: string): Promise<ReadonlySet<string>> {
    return this.run(() => new Set(this.vaults.get(key) ?? []));
  }

  setPromoted(key: string, project: string, promoted: boolean): Promise<ReadonlySet<string> | null> {
    return this.run(async (writable) => {
      if (!vaultKey.test(key) || !projectKey.test(project)) return null;
      const keys = new Set(this.vaults.get(key) ?? []);
      if (promoted ? !keys.has(project) : keys.has(project)) {
        if (promoted) keys.add(project);
        else keys.delete(project);
        this.vaults.set(key, keys);
        this.dirty = true;
        await this.persist(writable);
      }
      return new Set(keys);
    });
  }
}

interface StoredPosition { 座標: Point2; 放置時間: string }

function isPoint(value: unknown): value is Point2 {
  return Array.isArray(value) && value.length === 2 && value.every((item) => typeof item === 'number' && Number.isFinite(item) &&
    Math.abs(item) <= 1e6);
}

/** Group positions per vault; placed groups never move except through arrange(). */
export class GalaxyLayoutStore extends VaultJsonStore<Map<string, StoredPosition>> {
  constructor(file: string, private readonly now = () => Date.now(), options: StoreOptions = {}) {
    super(file, options);
  }

  protected decode(value: unknown, skip: () => void): Map<string, StoredPosition> | null {
    if (!isRecord(value)) return null;
    const positions = new Map<string, StoredPosition>();
    for (const [key, entry] of Object.entries(value)) {
      if (projectKey.test(key) && isRecord(entry) && isPoint(entry.座標) && typeof entry.放置時間 === 'string' &&
          Number.isFinite(Date.parse(entry.放置時間))) {
        positions.set(key, { 座標: [entry.座標[0], entry.座標[1]], 放置時間: entry.放置時間 });
      } else skip();
    }
    return positions;
  }

  protected encode(value: Map<string, StoredPosition>) {
    return Object.fromEntries([...value].sort(([a], [b]) => (a < b ? -1 : 1)));
  }

  /** Positions for these groups: stored ones as they are, new ones placed next to their strongest partner. */
  positions(key: string, groups: readonly string[], bridges: readonly GalaxyBridge[]): Promise<ReadonlyMap<string, Point2>> {
    return this.run(async (writable) => {
      const stored = vaultKey.test(key) ? this.vaults.get(key) ?? new Map<string, StoredPosition>() : new Map<string, StoredPosition>();
      const existing = new Map([...stored].map(([group, { 座標 }]) => [group, 座標] as const));
      const placed = placeGalaxies(existing, groups, bridges);
      if (vaultKey.test(key)) {
        const time = new Date(this.now()).toISOString();
        for (const group of groups) {
          // Only opaque project keys are stored, so the file can never hold a path.
          if (projectKey.test(group) && !stored.has(group)) {
            stored.set(group, { 座標: placed.get(group)!, 放置時間: time });
            this.dirty = true;
          }
        }
        this.vaults.set(key, stored);
        await this.persist(writable);
      }
      return new Map(groups.map((group) => [group, placed.get(group)!]));
    });
  }

  /** "Arrange once" (only when the user asks): replaces this vault's positions with a fresh arrangement. */
  arrange(key: string, groups: readonly string[], bridges: readonly GalaxyBridge[]): Promise<ReadonlyMap<string, Point2>> {
    return this.run(async (writable) => {
      const arranged = arrangeGalaxies(groups, bridges);
      if (vaultKey.test(key)) {
        const time = new Date(this.now()).toISOString();
        this.vaults.set(key, new Map([...arranged].filter(([group]) => projectKey.test(group))
          .map(([group, point]) => [group, { 座標: point, 放置時間: time }])));
        this.dirty = true;
        await this.persist(writable);
      }
      return arranged;
    });
  }
}
