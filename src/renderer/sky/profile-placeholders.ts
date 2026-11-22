/**
 * Path placeholders in the editable profile body (docs/架構.md §10.4): the main process replaces each local path
 * with a numbered token ⟦路徑N⟧ and restores it on save. The renderer never sees the paths or the mapping; it only
 * checks the tokens so the user learns about a problem before saving (the main process checks again).
 */
export const placeholderPattern = /⟦路徑(\d+)⟧/g;

export interface PlaceholderCheck {
  /** Numbers in the original that are gone; saving asks the user to confirm their removal. */
  missing: number[];
  /** Numbers that now appear more than once; saving is refused. */
  duplicate: number[];
  /** Numbers that were not in the original (typed or altered); saving is refused. */
  unknown: number[];
  /**
   * A damaged path token such as ⟦路徑⟧, ⟦路徑2 (no closing bracket) or ⟦路徑x⟧; saving is refused. Only fragments that
   * start with ⟦路徑 count: other text in white brackets (⟦注意⟧, a lone ⟧) is ordinary text (docs/架構.md §10.4).
   */
  damaged: boolean;
}

/** Same fragments the main process reserves (profile-content.ts reservedToken): from ⟦路徑 to the nearest ⟧, the next ⟦ or the line end. */
const reservedFragment = /⟦路徑[^⟦⟧\r\n]*(?:⟧|(?=⟦)|$)/gm;
const wellFormed = /^⟦路徑\d+⟧$/;

export function placeholderNumbers(text: string): number[] {
  return [...text.matchAll(placeholderPattern)].map((match) => Number(match[1]));
}

export function checkPlaceholders(original: string, current: string): PlaceholderCheck {
  const known = new Set(placeholderNumbers(original));
  const seen = new Map<number, number>();
  for (const number of placeholderNumbers(current)) seen.set(number, (seen.get(number) ?? 0) + 1);
  const fragments = [...current.matchAll(reservedFragment)].map((match) => match[0]).filter((text) => !wellFormed.test(text));
  return {
    missing: [...known].filter((number) => !seen.has(number)).sort((a, b) => a - b),
    duplicate: [...seen].filter(([number, count]) => count > 1 && known.has(number)).map(([number]) => number).sort((a, b) => a - b),
    unknown: [...seen.keys()].filter((number) => !known.has(number)).sort((a, b) => a - b),
    damaged: fragments.length > 0,
  };
}

export function blocksSaving(check: PlaceholderCheck): boolean {
  return check.duplicate.length > 0 || check.unknown.length > 0 || check.damaged;
}

/** Splits text into plain parts and placeholder tokens (for the highlight layer behind the editor). */
export function splitPlaceholders(text: string): { text: string; number?: number }[] {
  const parts: { text: string; number?: number }[] = [];
  let last = 0;
  for (const match of text.matchAll(placeholderPattern)) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    parts.push({ text: match[0], number: Number(match[1]) });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}
