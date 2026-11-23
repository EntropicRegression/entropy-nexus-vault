import type { CrystalSavepoint, NodeCrystal } from '../../shared/types';
import { localDate } from './local-date';

const backendNames: Record<CrystalSavepoint['backend'], string> = {
  claude: 'Claude Code', codex: 'Codex', antigravity: 'Antigravity', other: '其他後台',
};

export function savepointBackend(savepoint: CrystalSavepoint): string {
  return backendNames[savepoint.backend];
}

export function savepointTime(savepoint: CrystalSavepoint): string {
  return localDate(new Date(savepoint.time).toISOString(), true);
}

/** B below 1 KB, then KB / MB / GB with one decimal (1 KB = 1024 B); — when the console gave no usable size. */
export function savepointSize(savepoint: CrystalSavepoint): string {
  const { size } = savepoint;
  if (size === null) return '—';
  if (size < 1024) return size + ' B';
  const units = ['KB', 'MB', 'GB'];
  let value = size / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return value.toFixed(1) + ' ' + units[unit];
}

/** Status text of DESIGN.md 6.6.5: restore target, then an original still present, otherwise only the record. */
export function savepointStatus(savepoint: CrystalSavepoint, node: Pick<NodeCrystal, 'status' | 'canWake'>): string {
  if (savepoint.restoreTarget) return '可從存點還原' + (savepoint.backend === 'antigravity' ? '(實驗性)' : '');
  if (savepoint.originalExists === true) return node.status === '封存' && node.canWake ? '可直接喚醒' : '原檔還在';
  return '只剩紀錄';
}
