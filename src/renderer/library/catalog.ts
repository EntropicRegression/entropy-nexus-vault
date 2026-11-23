import type { MemoryEntry } from '../../shared/types';
import type { Shelf } from '../../shared/shelves';

export const shelfNames: Record<Shelf, string> = {
  case: '判例', decision: '決策', bookmark: '書籤', knowledge: '知識', meeting: '會議', archive: '典藏',
};
export const tabs = ['all', 'case', 'decision', 'bookmark', 'knowledge', 'meeting', 'archive', 'pending'] as const;
export type CatalogTab = (typeof tabs)[number];
export const tabNames: Record<CatalogTab, string> = { ...shelfNames, all: '全部', pending: '待處理' };
export function projectDisplayName(entry: Pick<MemoryEntry, 'projectName' | 'projectId'>): string {
  const name = entry.projectName.trim();
  if (name && !/^(?:[a-z]:|[/\\]|file:)/i.test(name)) return name;
  return entry.projectId ? '未命名書閣' : '';
}

export function isProjectIdAttribute(key: string): boolean {
  return /^(?:專案id|project-?id)$/i.test(key.trim());
}

export function dateLabel(timestamp: number): string {
  const date = new Date(timestamp);
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}

export function categoryLabel(entry: MemoryEntry): string {
  if (entry.kind === 'memoir') return '回憶錄';
  if (entry.shelf === 'knowledge' && entry.kind === 'preference') return '偏好';
  return entry.shelf ? shelfNames[entry.shelf] : '';
}

const isoDate = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 10);

export function memoirPeriodLabel(entry: MemoryEntry): string {
  const coverage = entry.memoir?.coverage;
  if (!coverage) return dateLabel(entry.updatedAt);
  return coverage.end === null ? isoDate(coverage.start) : isoDate(coverage.start) + ' – ' + isoDate(coverage.end);
}

export function memoirReviewLabel(entry: MemoryEntry): string {
  return entry.status === '未確認' ? '待核閱' : entry.status === '退回' ? '已退回' : '';
}

export function entryIdentifier(entry: MemoryEntry): string {
  if (entry.shelf === 'case') return entry.caseId ?? categoryLabel(entry);
  if (entry.kind === 'memoir') {
    const coverage = entry.memoir?.coverage;
    return ['回憶錄', entry.nodeLabel, coverage ? isoDate(coverage.start) : dateLabel(entry.updatedAt)].filter(Boolean).join(' · ');
  }
  return categoryLabel(entry) + ' · ' + dateLabel(entry.updatedAt);
}

export function isOpenBookmark(entry: MemoryEntry): boolean {
  return entry.shelf === 'bookmark' && entry.status === '未完';
}

export function isPending(entry: MemoryEntry): boolean {
  return entry.shelf === 'bookmark' ? isOpenBookmark(entry) : entry.status === '未確認' || entry.status === '退回';
}

export function deskNoteLabel(entry: MemoryEntry): string {
  if (isOpenBookmark(entry)) return '未完書籤';
  return '待核閱' + categoryLabel(entry);
}
