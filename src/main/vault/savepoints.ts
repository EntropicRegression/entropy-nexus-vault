import type { CrystalSavepoint } from '../../shared/types';

/** One `存點` item of `.nexus-stats.json` (docs/架構.md §15); the path is checked here and never sent to the renderer. */
export type StatsSavepoint = Omit<CrystalSavepoint, 'restoreTarget'>;

const backends = new Set<CrystalSavepoint['backend']>(['claude', 'codex', 'antigravity']);

function savepointPath(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith('nodes/封存/_存點/') && value.length > 'nodes/封存/_存點/'.length &&
    !value.includes('\\') && !value.split('/').includes('..');
}

/**
 * `存點` as written by the console, in its order (newest first). Old files without it, or a value that is not a list,
 * give []; a malformed item is skipped without dropping the node. 存點.json and files/ are never read.
 */
export function decodeSavepoints(value: unknown): StatsSavepoint[] {
  if (!Array.isArray(value)) return [];
  const savepoints: StatsSavepoint[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const time = typeof record.時間 === 'string' ? Date.parse(record.時間) : NaN;
    if (!Number.isFinite(time) || !savepointPath(record.路徑)) continue;
    const size = record.大小;
    const original = record.原檔還在;
    savepoints.push({
      time,
      backend: backends.has(record.後台ID as CrystalSavepoint['backend']) ? record.後台ID as CrystalSavepoint['backend'] : 'other',
      size: typeof size === 'number' && Number.isSafeInteger(size) && size >= 0 ? size : null,
      originalExists: typeof original === 'boolean' ? original : null,
      restorable: record.可還原 === true,
    });
  }
  return savepoints;
}

/**
 * Marks the restore target: the first restorable savepoint, when waking can succeed (canWake = 封存 && 可接回) and that
 * copy's original is gone. The console always restores its newest restorable savepoint, so both sides pick the same one.
 */
export function withRestoreTarget(savepoints: readonly StatsSavepoint[], canWake: boolean): CrystalSavepoint[] {
  const first = savepoints.findIndex((savepoint) => savepoint.restorable);
  const target = canWake && first >= 0 && savepoints[first].originalExists === false ? first : -1;
  return savepoints.map((savepoint, index) => ({ ...savepoint, restoreTarget: index === target }));
}
