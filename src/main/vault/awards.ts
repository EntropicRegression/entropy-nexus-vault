import { createHash, randomUUID } from 'node:crypto';
import type { Stats } from 'node:fs';
import { lstat, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { normaliseAwardReason } from '../../shared/glow';
import type { GlowAward } from '../../shared/glow';
import type { AwardWriteResult, FileVersion } from '../../shared/types';

/**
 * .vault-awards.json in the vault root (DESIGN.md §6.9, docs/架構.md §9.3): manual rainbow awards. App-only; the
 * console never reads, writes or deletes it. A damaged file counts as "no awards" and is never overwritten.
 */
export const awardsFilename = '.vault-awards.json';

export interface AwardsState {
  awards: ReadonlyMap<string, GlowAward>;
  /** null when the file does not exist. */
  version: FileVersion | null;
  corrupt: boolean;
}

const renameDelays = [25, 50, 100, 200];
const safeId = (id: string) => Boolean(id) && !/[/\\:\u0000-\u001f]/.test(id);

/** Legacy node IDs can carry a relative path; the file stores a hash for those so it never holds a path. */
export function awardKey(nodeId: string): string {
  return safeId(nodeId) && !/^n_[a-f0-9]{64}$/.test(nodeId) ? nodeId : 'n_' + createHash('sha256').update(nodeId).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function code(error: unknown): string | undefined {
  return isRecord(error) && typeof error.code === 'string' ? error.code : undefined;
}

const versionOf = (stat: Stats): FileVersion => ({ mtime: stat.mtimeMs, size: stat.size });
const sameVersion = (a: FileVersion | null, b: FileVersion | null) =>
  a === null || b === null ? a === b : a.mtime === b.mtime && a.size === b.size;

function validExpected(value: unknown): value is FileVersion | null {
  return value === null || (isRecord(value) && Number.isFinite(value.mtime) && typeof value.size === 'number' &&
    Number.isSafeInteger(value.size) && value.size >= 0);
}

async function statFile(path: string): Promise<Stats | null> {
  try {
    return await lstat(path);
  } catch (error) {
    if (code(error) === 'ENOENT') return null;
    throw error;
  }
}

interface RawAwards { root: Record<string, unknown>; awards: Record<string, unknown> }

function parse(text: string): RawAwards | null {
  try {
    const root: unknown = JSON.parse(text);
    if (!isRecord(root) || root.版本 !== 1 || !isRecord(root.頒發)) return null;
    return { root, awards: root.頒發 };
  } catch {
    return null;
  }
}

function decodeAward(value: unknown): GlowAward | null {
  if (!isRecord(value) || value.等級 !== '彩虹' || typeof value.頒發時間 !== 'string' ||
      !Number.isFinite(Date.parse(value.頒發時間))) return null;
  const reason = value.理由 === undefined ? '' : normaliseAwardReason(value.理由);
  return reason === null ? null : { awardedAt: value.頒發時間, reason };
}

async function readRaw(path: string): Promise<{ stat: Stats | null; raw: RawAwards | null; text: string | null }> {
  const stat = await statFile(path);
  if (!stat) return { stat: null, raw: null, text: null };
  if (!stat.isFile()) return { stat, raw: null, text: '' };
  const text = await readFile(path, 'utf8');
  return { stat, raw: parse(text), text };
}

/** Reads the awards for these node IDs. Entries for unknown or malformed keys are ignored (and kept in the file). */
export async function readAwards(root: string, nodeIds: Iterable<string>): Promise<AwardsState> {
  const { stat, raw } = await readRaw(join(root, awardsFilename));
  if (!stat) return { awards: new Map(), version: null, corrupt: false };
  if (!raw) return { awards: new Map(), version: versionOf(stat), corrupt: true };
  const awards = new Map<string, GlowAward>();
  for (const nodeId of nodeIds) {
    const award = decodeAward(raw.awards[awardKey(nodeId)]);
    if (award) awards.set(nodeId, award);
  }
  return { awards, version: versionOf(stat), corrupt: false };
}

/**
 * Grants (award = { reason }) or withdraws (award = null) a rainbow. Writes a temporary file and renames it over the
 * original only if the file still has the version the caller read (expected; null = the file did not exist).
 */
export async function writeAward(root: string, nodeId: string, award: { reason: unknown } | null, expected: unknown,
  now = () => Date.now()): Promise<AwardWriteResult> {
  if (typeof nodeId !== 'string' || !nodeId || !validExpected(expected)) return { ok: false, reason: 'invalid' };
  const reason = award ? normaliseAwardReason(award.reason) : '';
  if (reason === null) return { ok: false, reason: 'invalid' };
  const path = join(root, awardsFilename);
  let current: Awaited<ReturnType<typeof readRaw>>;
  try {
    current = await readRaw(path);
  } catch {
    return { ok: false, reason: 'io' };
  }
  const currentVersion = current.stat ? versionOf(current.stat) : null;
  if (!sameVersion(currentVersion, expected)) return { ok: false, reason: 'conflict', current: currentVersion };
  if (current.stat && !current.raw) return { ok: false, reason: 'corrupt', current: currentVersion };

  const document = current.raw ? { ...current.raw.root, 頒發: { ...current.raw.awards } } : { 版本: 1, 頒發: {} };
  const table = document.頒發 as Record<string, unknown>;
  const key = awardKey(nodeId);
  const granted: GlowAward | null = award ? { awardedAt: new Date(now()).toISOString(), reason } : null;
  if (granted) table[key] = { 等級: '彩虹', 頒發時間: granted.awardedAt, 理由: granted.reason };
  else delete table[key];

  const temporary = join(root, '.vault-awards-' + randomUUID() + '.tmp');
  try {
    await writeFile(temporary, JSON.stringify(document, null, 2) + '\n', { flag: 'wx' });
    for (let attempt = 0; ; attempt++) {
      // Last check right before replacing: another writer (a second window, a sync client) may have changed it.
      const latest = await statFile(path);
      const latestVersion = latest ? versionOf(latest) : null;
      if (!sameVersion(latestVersion, expected)) return { ok: false, reason: 'conflict', current: latestVersion };
      try {
        await rename(temporary, path);
        break;
      } catch (error) {
        if (!['EPERM', 'EBUSY', 'EACCES'].includes(code(error) ?? '') || attempt >= renameDelays.length) {
          return { ok: false, reason: 'io' };
        }
        await delay(renameDelays[attempt]);
      }
    }
    const written = await statFile(path);
    if (!written) return { ok: false, reason: 'io' };
    return { ok: true, ...versionOf(written), award: granted };
  } catch {
    return { ok: false, reason: 'io' };
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}
