import { createHash, randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { placeNew } from '../../shared/crystal-layout';
import type { Point3 } from '../../shared/projection';

interface StoredPoint { 座標: Point3; 最後出現: string }
type VaultPoints = Map<string, StoredPoint>;
type Layouts = Map<string, VaultPoints>;

const retentionMs = 180 * 24 * 60 * 60 * 1000;
const vaultKey = /^v_[a-f0-9]{24}$/;
const safeId = (id: string) => Boolean(id) && !/[/\\:\u0000-\u001f]/.test(id);

function storageId(id: string): string {
  // Legacy IDs can contain the relative path of the node file.
  return safeId(id) && !/^n_[a-f0-9]{64}$/.test(id) ? id : 'n_' + createHash('sha256').update(id).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPoint(value: unknown): value is Point3 {
  return Array.isArray(value) && value.length === 3 &&
    value.every((axis: unknown) => typeof axis === 'number' && Number.isFinite(axis) && Math.abs(axis) <= 340);
}

function decode(value: unknown): Layouts | null {
  if (!isRecord(value) || value.版本 !== 1 || !isRecord(value.記憶庫)) return null;
  const layouts: Layouts = new Map();
  for (const [key, entries] of Object.entries(value.記憶庫)) {
    if (!vaultKey.test(key) || !isRecord(entries)) return null;
    const points: VaultPoints = new Map();
    for (const [id, entry] of Object.entries(entries)) {
      if (!safeId(id) || !isRecord(entry) || !isPoint(entry.座標) || typeof entry.最後出現 !== 'string' ||
        !Number.isFinite(Date.parse(entry.最後出現))) return null;
      points.set(id, { 座標: entry.座標, 最後出現: entry.最後出現 });
    }
    layouts.set(key, points);
  }
  return layouts;
}

export class CrystalLayoutStore {
  private layouts: Layouts = new Map();
  private loaded = false;
  private dirty = false;
  private pending: Promise<unknown> = Promise.resolve();

  constructor(private file: string, private now = () => Date.now()) {}

  positions(key: string, nodeIds: readonly string[]): Promise<ReadonlyMap<string, Point3>> {
    const next = this.pending.then(() => this.update(key, nodeIds));
    this.pending = next.catch(() => {});
    return next;
  }

  private async load() {
    if (this.loaded) return;
    let raw: string;
    try {
      raw = await readFile(this.file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') this.loaded = true;
      return;
    }
    this.loaded = true;
    let decoded: Layouts | null = null;
    try { decoded = decode(JSON.parse(raw)); } catch { /* Rebuild an invalid file. */ }
    if (!decoded) {
      this.dirty = true;
      return;
    }
    for (const [key, saved] of decoded) {
      this.layouts.set(key, new Map([...(this.layouts.get(key) ?? []), ...saved]));
    }
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

  private async update(key: string, nodeIds: readonly string[]): Promise<ReadonlyMap<string, Point3>> {
    if (!vaultKey.test(key)) throw new Error('Invalid vault layout key');
    await this.load();
    const now = this.now();
    const timestamp = new Date(now).toISOString();
    const ids = new Map(nodeIds.map((id) => [storageId(id), id]));
    for (const [vault, points] of this.layouts) {
      for (const [id, entry] of points) {
        if (now - Date.parse(entry.最後出現) > retentionMs && (vault !== key || !ids.has(id))) {
          points.delete(id);
          this.dirty = true;
        }
      }
      if (points.size === 0) this.layouts.delete(vault);
    }
    const points = this.layouts.get(key) ?? new Map<string, StoredPoint>();
    const live = new Set(nodeIds);
    const fixed = new Map<string, Point3>();
    for (const [stored, entry] of points) {
      let id = ids.get(stored) ?? stored;
      if (!ids.has(stored)) {
        while (live.has(id) || fixed.has(id)) id = '\0' + id;
      }
      fixed.set(id, entry.座標);
    }
    const missing = [...ids].filter(([stored]) => !points.has(stored)).map(([, id]) => id);
    const added = missing.length ? placeNew(fixed, missing) : new Map<string, Point3>();
    const result = new Map<string, Point3>();
    for (const [stored, id] of ids) {
      const current = points.get(stored);
      const position = current?.座標 ?? added.get(id)!;
      result.set(id, position);
      if (!current || current.最後出現 !== timestamp) {
        points.set(stored, { 座標: position, 最後出現: timestamp });
        this.dirty = true;
      }
    }
    if (points.size) this.layouts.set(key, points);
    await this.persist();
    return result;
  }
}
