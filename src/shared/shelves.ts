import type { MemoryEntry } from './types';

export const shelves = ['case', 'decision', 'bookmark', 'knowledge', 'meeting', 'archive'] as const;
export type Shelf = (typeof shelves)[number];

export function shelfOf(entry: Pick<MemoryEntry, 'kind' | 'subtype'>): Shelf | null {
  if (entry.kind === 'case') return 'case';
  if (entry.kind === 'meeting') return 'meeting';
  if (entry.kind === 'memoir') return 'archive';
  if (entry.kind === 'preference') return 'knowledge';
  if (entry.kind !== 'knowledge') return null;
  if (entry.subtype === '決策') return 'decision';
  if (entry.subtype === '書籤') return 'bookmark';
  return 'knowledge';
}

/** Chapters with unknown coverage stay at the end, ordered by their update time and path. */
export function compareMemoirChapters(a: MemoryEntry, b: MemoryEntry): number {
  const aStart = a.memoir?.coverage?.start ?? Infinity;
  const bStart = b.memoir?.coverage?.start ?? Infinity;
  return (aStart === bStart ? 0 : aStart - bStart) || a.updatedAt - b.updatedAt || a.path.localeCompare(b.path, 'zh-Hant', { numeric: true });
}
