import type { MemoryEntry } from './types';

/** meeting: the fifth shelf, console meeting transcripts (DESIGN.md §5.13). */
export const shelves = ['case', 'decision', 'bookmark', 'archive', 'meeting'] as const;
export type Shelf = (typeof shelves)[number];

export function shelfOf(entry: Pick<MemoryEntry, 'kind' | 'subtype'>): Shelf | null {
  if (entry.kind === 'case') return 'case';
  if (entry.kind === 'meeting') return 'meeting';
  if (entry.kind === 'preference') return 'archive';
  if (entry.kind !== 'knowledge') return null;
  if (entry.subtype === '決策') return 'decision';
  if (entry.subtype === '書籤') return 'bookmark';
  return 'archive';
}
