/**
 * Shared node-name matching (DESIGN.md §6.10.1): the downstairs search (main process, searchNodes) and the galaxy
 * finder (renderer) use the same rule — the query is split on spaces into lowercase terms, and every term must appear.
 */
export function searchTerms(query: unknown): string[] {
  if (typeof query !== 'string') return [];
  return query.normalize('NFKC').trim().toLowerCase().split(/\s+/).filter(Boolean);
}

export function matchesTerms(text: string, terms: readonly string[]): boolean {
  const haystack = text.normalize('NFKC').toLowerCase();
  return terms.length > 0 && terms.every((term) => haystack.includes(term));
}
