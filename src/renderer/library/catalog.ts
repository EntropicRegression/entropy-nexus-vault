import type { MemoryEntry } from '../../shared/types';
import type { Shelf } from '../../shared/shelves';

export const shelfNames: Record<Shelf, string> = { case: '判例', decision: '決策', bookmark: '書籤', archive: '典藏' };
export const tabs = ['all', 'case', 'decision', 'bookmark', 'archive', 'pending'] as const;
export type CatalogTab = (typeof tabs)[number];
export const tabNames: Record<CatalogTab, string> = { ...shelfNames, all: '全部', pending: '待處理' };
export const writeLater = '寫入功能將於 M4 開放';

export function dateLabel(timestamp: number): string {
  const date = new Date(timestamp);
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}

export function categoryLabel(entry: MemoryEntry): string {
  if (entry.shelf === 'archive') return entry.kind === 'preference' ? '典藏・偏好' : '典藏・知識';
  return entry.shelf ? shelfNames[entry.shelf] : '';
}

export function entryIdentifier(entry: MemoryEntry): string {
  if (entry.shelf === 'case') return entry.caseId ?? categoryLabel(entry);
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
  return '待核閱' + (entry.shelf === 'archive' ? (entry.kind === 'preference' ? '偏好' : '知識') : categoryLabel(entry));
}
