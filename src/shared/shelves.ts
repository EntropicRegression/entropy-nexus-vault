import type { MemoryEntry } from './types';

export const shelves = ['case', 'decision', 'bookmark', 'archive'] as const;
export type Shelf = (typeof shelves)[number];

export function shelfOf(entry: Pick<MemoryEntry, 'kind' | 'subtype'>): Shelf | null {
  if (entry.kind === 'case') return 'case';
  if (entry.kind === 'preference') return 'archive';
  if (entry.kind !== 'knowledge') return null;
  if (entry.subtype === '決策') return 'decision';
  if (entry.subtype === '書籤') return 'bookmark';
  return 'archive';
}
