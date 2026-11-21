import type { MemoryEntry, VaultStatusUpdate } from './types';

type StatusEntry = Pick<MemoryEntry, 'shelf' | 'status'>;

export function primaryStatus(entry: StatusEntry): VaultStatusUpdate | null {
  if (entry.shelf === 'bookmark') return entry.status === '未完' ? '已完成' : null;
  return entry.shelf && (entry.status === '未確認' || entry.status === '退回') ? '已確認' : null;
}

export function canSetStatus(entry: StatusEntry, next: VaultStatusUpdate): boolean {
  if (next === '退回') return Boolean(entry.shelf && entry.shelf !== 'bookmark' && entry.status !== '退回');
  return (next === '已確認' || next === '已完成') && primaryStatus(entry) === next;
}
