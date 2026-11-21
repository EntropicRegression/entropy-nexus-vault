import { createHash, randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';

/**
 * userData/glow-peaks.json (docs/架構.md §9.2): per vault, the highest 完成數 seen for each node and the 退回數 at
 * that moment. Peaks only rise. The file holds opaque vault keys, node IDs (hashed when they look like paths),
 * counts and times — never a path. It is never written into the vault.
 */
export interface GlowPeak { completed: number; rejected: number }
interface StoredPeak { 完成數: number; 退回數: number; 記錄時間: string }

const vaultKey = /^v_[a-f0-9]{24}$/;
const safeId = (id: string) => Boolean(id) && !/[/\\:\u0000-\u001f]/.test(id);
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

function storageId(id: string): string {
  return safeId(id) && !/^n_[a-f0-9]{64}$/.test(id) ? id : 'n_' + createHash('sha256').update(id).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decode(value: unknown): { vaults: Map<string, Map<string, StoredPeak>>; skipped: boolean } | null {
  if (!isRecord(value) || value.版本 !== 1 || !isRecord(value.記憶庫)) return null;
  const vaults = new Map<string, Map<string, StoredPeak>>();
  let skipped = false;
  for (const [key, nodes] of Object.entries(value.記憶庫)) {
    if (!vaultKey.test(key) || !isRecord(nodes)) { skipped = true; continue; }
    const peaks = new Map<string, StoredPeak>();
    for (const [id, peak] of Object.entries(nodes)) {
      if (!safeId(id) || !isRecord(peak) || !isCount(peak.完成數) || !isCount(peak.退回數) ||
          typeof peak.記錄時間 !== 'string' || !Number.isFinite(Date.parse(peak.記錄時間))) { skipped = true; continue; }
      peaks.set(id, { 完成數: peak.完成數, 退回數: peak.退回數, 記錄時間: peak.記錄時間 });
    }
    vaults.set(key, peaks);
  }
  return { vaults, skipped };
}

export class GlowPeakStore {
  private vaults = new Map<string, Map<string, StoredPeak>>();
  private loaded = false;
  private dirty = false;
  private pending: Promise<unknown> = Promise.resolve();

  constructor(private readonly file: string, private readonly now = () => Date.now()) {}

  /**
   * Records the current counts and returns each node's peak. A new peak is stored only when 完成數 exceeds the
   * stored one; a lower count (old tasks leaving the console's 180-day window) keeps the stored peak.
   */
  update(key: string, current: ReadonlyMap<string, GlowPeak>): Promise<ReadonlyMap<string, GlowPeak>> {
    const next = this.pending.then(() => this.apply(key, current));
    this.pending = next.catch(() => {});
    return next;
  }

  private async load() {
    if (this.loaded) return;
    let raw: string | null = null;
    try {
      raw = await readFile(this.file, 'utf8');
    } catch (error) {
      // A missing file starts empty; an unreadable one is retried on the next request without overwriting it.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return;
    }
    this.loaded = true;
    if (raw === null) return;
    let decoded: ReturnType<typeof decode> = null;
    try { decoded = decode(JSON.parse(raw)); } catch { /* Rebuilt from the current counts below. */ }
    if (!decoded || decoded.skipped) this.dirty = true;
    if (decoded) this.vaults = decoded.vaults;
  }

  private async apply(key: string, current: ReadonlyMap<string, GlowPeak>): Promise<ReadonlyMap<string, GlowPeak>> {
    await this.load();
    const result = new Map<string, GlowPeak>();
    if (!vaultKey.test(key)) {
      for (const [id, value] of current) result.set(id, value);
      return result;
    }
    const peaks = this.vaults.get(key) ?? new Map<string, StoredPeak>();
    for (const [id, value] of current) {
      const stored = peaks.get(storageId(id));
      if (!stored || value.completed > stored.完成數) {
        peaks.set(storageId(id), { 完成數: value.completed, 退回數: value.rejected, 記錄時間: new Date(this.now()).toISOString() });
        this.dirty = true;
        result.set(id, value);
      } else {
        result.set(id, { completed: stored.完成數, rejected: stored.退回數 });
      }
    }
    this.vaults.set(key, peaks);
    // When the file could not be read, peaks still apply for this process but nothing is written over it.
    if (this.loaded) await this.persist();
    return result;
  }

  private async persist() {
    if (!this.dirty) return;
    const temporary = this.file + '.' + randomUUID() + '.tmp';
    try {
      const vaults = Object.fromEntries([...this.vaults].map(([key, peaks]) => [key, Object.fromEntries(peaks)]));
      await writeFile(temporary, JSON.stringify({ 版本: 1, 記憶庫: vaults }, null, 2) + '\n', { flag: 'wx' });
      await rename(temporary, this.file);
      this.dirty = false;
    } catch {
      // Keep the peaks for this process and try again next time.
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
    }
  }
}
