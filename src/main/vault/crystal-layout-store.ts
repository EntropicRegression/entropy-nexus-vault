import { createHash, randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { defaultLayoutParams, placeNew } from '../../shared/crystal-layout';
import type { LayoutParams } from '../../shared/crystal-layout';
import type { Point3 } from '../../shared/projection';

interface StoredPoint { 座標: Point3; 最後出現: string }
type VaultPoints = Map<string, StoredPoint>;
type Layouts = Map<string, VaultPoints>;

export interface LayoutStoreOptions {
  params?: LayoutParams;
  /** Waits before retrying a temporarily locked layout file (antivirus, sync clients). */
  readRetryDelays?: readonly number[];
  read?: (file: string) => Promise<string>;
  sleep?: (ms: number) => Promise<unknown>;
}

const retentionMs = 180 * 24 * 60 * 60 * 1000;
const seenRefreshMs = 24 * 60 * 60 * 1000;
const vaultKey = /^v_[a-f0-9]{24}$/;
const transientRead = new Set(['EBUSY', 'EPERM', 'EACCES', 'EAGAIN']);
const safeId = (id: string) => Boolean(id) && !/[/\\:\u0000-\u001f]/.test(id);

function storageId(id: string): string {
  // Legacy IDs can contain the relative path of the node file.
  return safeId(id) && !/^n_[a-f0-9]{64}$/.test(id) ? id : 'n_' + createHash('sha256').update(id).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error.code === 'string' ? error.code : undefined;
}

/** Coordinates may sit anywhere on the largest shell; y is flattened to 0.6 but x and z are not. */
function pointLimit(params: LayoutParams): number {
  return Math.max(...params.radii) * 1.001;
}

function isPoint(value: unknown, limit: number): value is Point3 {
  return Array.isArray(value) && value.length === 3 &&
    value.every((axis: unknown) => typeof axis === 'number' && Number.isFinite(axis) && Math.abs(axis) <= limit);
}

interface Decoded { layouts: Layouts; skipped: boolean }

/** Only a broken outer structure discards the file; bad vaults or entries are skipped one by one. */
function decode(value: unknown, limit: number): Decoded | null {
  if (!isRecord(value) || value.版本 !== 1 || !isRecord(value.記憶庫)) return null;
  const layouts: Layouts = new Map();
  let skipped = false;
  for (const [key, entries] of Object.entries(value.記憶庫)) {
    if (!vaultKey.test(key) || !isRecord(entries)) {
      skipped = true;
      continue;
    }
    const points: VaultPoints = new Map();
    for (const [id, entry] of Object.entries(entries)) {
      if (!safeId(id) || !isRecord(entry) || !isPoint(entry.座標, limit) || typeof entry.最後出現 !== 'string' ||
        !Number.isFinite(Date.parse(entry.最後出現))) {
        skipped = true;
        continue;
      }
      points.set(id, { 座標: entry.座標, 最後出現: entry.最後出現 });
    }
    if (points.size) layouts.set(key, points);
  }
  return { layouts, skipped };
}

type LoadState = 'loaded' | 'unavailable';

export class CrystalLayoutStore {
  private layouts: Layouts = new Map();
  private loaded = false;
  private dirty = false;
  private pending: Promise<unknown> = Promise.resolve();
  private readonly params: LayoutParams;
  private readonly retryDelays: readonly number[];
  private readonly read: (file: string) => Promise<string>;
  private readonly sleep: (ms: number) => Promise<unknown>;

  constructor(private file: string, private now = () => Date.now(), options: LayoutStoreOptions = {}) {
    this.params = options.params ?? defaultLayoutParams;
    this.retryDelays = options.readRetryDelays ?? [50, 100, 200];
    this.read = options.read ?? ((path) => readFile(path, 'utf8'));
    this.sleep = options.sleep ?? delay;
  }

  positions(key: string, nodeIds: readonly string[]): Promise<ReadonlyMap<string, Point3>> {
    const next = this.pending.then(() => this.update(key, nodeIds));
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
        if (!code || !transientRead.has(code) || attempt >= this.retryDelays.length) return undefined;
        await this.sleep(this.retryDelays[attempt]);
      }
    }
  }

  private async load(): Promise<LoadState> {
    if (this.loaded) return 'loaded';
    const raw = await this.readWithRetry();
    // A file that stays locked is left untouched; the next request tries again.
    if (raw === undefined) return 'unavailable';
    this.loaded = true;
    if (raw === null) return 'loaded';
    let decoded: Decoded | null = null;
    try { decoded = decode(JSON.parse(raw), pointLimit(this.params)); } catch { /* Rebuild an unreadable file. */ }
    if (!decoded || decoded.skipped) this.dirty = true;
    for (const [key, saved] of decoded?.layouts ?? []) {
      this.layouts.set(key, new Map([...(this.layouts.get(key) ?? []), ...saved]));
    }
    return 'loaded';
  }

  private async persist() {
    if (!this.loaded || !this.dirty) return;
    const temporary = this.file + '.' + randomUUID() + '.tmp';
    try {
      const vaults = Object.fromEntries([...this.layouts].map(([key, points]) => [key, Object.fromEntries(points)]));
      await writeFile(temporary, JSON.stringify({ 版本: 1, 記憶庫: vaults }, null, 2) + '\n', { flag: 'wx' });
      await rename(temporary, this.file);
      this.dirty = false;
    } catch {
      // Keep the positions for this process and try the file again on the next request.
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
    }
  }

  private fixedPositions(points: VaultPoints, ids: ReadonlyMap<string, string>) {
    const live = new Set(ids.values());
    const fixed = new Map<string, Point3>();
    for (const [stored, entry] of points) {
      let id = ids.get(stored) ?? stored;
      if (!ids.has(stored)) {
        while (live.has(id) || fixed.has(id)) id = '\0' + id;
      }
      fixed.set(id, entry.座標);
    }
    return fixed;
  }

  private async update(key: string, nodeIds: readonly string[]): Promise<ReadonlyMap<string, Point3>> {
    if (!vaultKey.test(key)) throw new Error('Invalid vault layout key');
    const state = await this.load();
    const ids = new Map(nodeIds.map((id) => [storageId(id), id]));

    if (state === 'unavailable') {
      // Show a usable map for this session without storing or writing anything derived from a partial view.
      const points = this.layouts.get(key) ?? new Map<string, StoredPoint>();
      const missing = [...ids].filter(([stored]) => !points.has(stored)).map(([, id]) => id);
      const added = placeNew(this.fixedPositions(points, ids), missing, this.params);
      return new Map([...ids].map(([stored, id]) => [id, points.get(stored)?.座標 ?? added.get(id)!]));
    }

    const now = this.now();
    const timestamp = new Date(now).toISOString();
    const points = this.layouts.get(key) ?? new Map<string, StoredPoint>();
    // Expire only within the vault being read; other vaults keep their positions until they are opened again.
    for (const [id, entry] of points) {
      if (!ids.has(id) && now - Date.parse(entry.最後出現) > retentionMs) {
        points.delete(id);
        this.dirty = true;
      }
    }
    const missing = [...ids].filter(([stored]) => !points.has(stored)).map(([, id]) => id);
    const added = missing.length ? placeNew(this.fixedPositions(points, ids), missing, this.params) : new Map<string, Point3>();
    const result = new Map<string, Point3>();
    for (const [stored, id] of ids) {
      const current = points.get(stored);
      const position = current?.座標 ?? added.get(id)!;
      result.set(id, position);
      // Refresh "last seen" at most daily so routine re-reads do not rewrite the file every time.
      if (!current || now - Date.parse(current.最後出現) > seenRefreshMs) {
        points.set(stored, { 座標: position, 最後出現: timestamp });
        this.dirty = true;
      }
    }
    if (points.size) this.layouts.set(key, points);
    else if (this.layouts.delete(key)) this.dirty = true;
    await this.persist();
    return result;
  }
}
