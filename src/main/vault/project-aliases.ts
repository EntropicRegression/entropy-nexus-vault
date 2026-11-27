import { realpathSync } from 'node:fs';
import { win32 } from 'node:path';
import { opaqueKey } from './privacy';

const pathLike = /^(?:[a-z]:[\\/]|[\\/]{2})/i;
const canonical = (path: string) => win32.normalize(path).toLowerCase();

/** The folder's real path (links and junctions followed), or null when it cannot be resolved. */
export function realFolder(path: string): string | null {
  try {
    return realpathSync.native(path);
  } catch {
    return null;
  }
}

/**
 * Shared-folder projects whose IDs resolve to the same real folder (e.g. a renamed folder with a junction left at the
 * old path) are one project (user 2026-11-28, docs/架構.md §9.4). Returns opaque key → the key it merges into. Nothing
 * is remembered: the check runs on every stats read, so once the link is gone the projects are separate again, and a
 * new folder that merely reuses the old name is never merged. Git projects are left alone (the console already gives
 * a repository and its worktrees one ID). The target is the project whose own ID is the real folder; otherwise the
 * smallest key.
 */
export function folderAliases(folderIds: Iterable<string>, resolve: (path: string) => string | null = realFolder): Map<string, string> {
  const byReal = new Map<string, { key: string; own: boolean }[]>();
  for (const id of folderIds) {
    if (!pathLike.test(id)) continue;
    const real = resolve(id);
    if (!real) continue;
    const target = canonical(real);
    const group = byReal.get(target) ?? [];
    group.push({ key: opaqueKey('p', id), own: canonical(id) === target });
    byReal.set(target, group);
  }
  const aliases = new Map<string, string>();
  for (const group of byReal.values()) {
    const keys = [...new Set(group.map(({ key }) => key))];
    if (keys.length < 2) continue;
    const target = group.find(({ own }) => own)?.key ?? [...keys].sort()[0];
    for (const key of keys) if (key !== target) aliases.set(key, target);
  }
  return aliases;
}
