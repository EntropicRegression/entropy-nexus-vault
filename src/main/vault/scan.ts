import { lstat, open, readdir } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { join } from 'node:path';
import type { FileVersion, MemoryKind } from '../../shared/types';

export const vaultFolders = {
  nodes: 'node',
  cases: 'case',
  knowledge: 'knowledge',
  preferences: 'preference',
  meetings: 'meeting',
  memoirs: 'memoir',
} as const satisfies Record<string, MemoryKind>;

export interface VaultFile extends FileVersion {
  path: string;
  text: string;
}

export type VaultVersion = Stats | null;

interface VaultScan {
  files: VaultFile[];
  versions: Map<string, VaultVersion>;
  cacheable: boolean;
}

/** 路徑只用於在索引中查詢，renderer 傳入的值不會直接開檔。 */
export function memoryPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const segments = value.replace(/\\/g, '/').split('/');
  if (segments.length < 2 || !Object.hasOwn(vaultFolders, segments[0].toLowerCase())) return null;
  if (segments.some((segment) => !segment || /[<>:"|?*\u0000-\u001f]|[. ]$/.test(segment))) return null;
  if (segments.slice(0, -1).some((segment) => segment.startsWith('_') || /\.tmp$/i.test(segment))) return null;
  return /\.md$/i.test(segments.at(-1) ?? '') ? segments.join('/') : null;
}

function unavailable(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR' || error.code === 'EACCES' || error.code === 'EPERM' || error.code === 'EBUSY');
}

export async function vaultVersion(path: string): Promise<VaultVersion> {
  try {
    return await lstat(path);
  } catch (error) {
    if (unavailable(error)) return null;
    throw error;
  }
}

export function sameVaultVersion(before: VaultVersion, after: VaultVersion): boolean {
  if (before === null || after === null) return before === after;
  return before.mtimeMs === after.mtimeMs && before.size === after.size &&
    before.ctimeMs === after.ctimeMs && before.ino === after.ino &&
    before.dev === after.dev && before.mode === after.mode;
}

async function readMemoryFile(absPath: string, path: string): Promise<{ file: VaultFile; version: Stats } | null> {
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!(await vaultVersion(absPath))?.isFile()) return null;
      const handle = await open(absPath, 'r');
      let text: string;
      let after: Stats;
      try {
        const before = await handle.stat();
        if (!before.isFile()) return null;
        text = await handle.readFile('utf8');
        after = await handle.stat();
        if (!sameVaultVersion(before, after)) continue;
      } finally {
        await handle.close();
      }
      // 原子改名可能換掉路徑指向的檔案，但舊 handle 上的版本仍然相同。
      if (sameVaultVersion(after, await vaultVersion(absPath))) {
        return { file: { path, text, mtime: after.mtimeMs, size: after.size }, version: after };
      }
    }
    return null;
  } catch (error) {
    if (unavailable(error)) return null;
    throw error;
  }
}

export async function scanVault(root: string): Promise<VaultScan> {
  const files: VaultFile[] = [];
  const versions = new Map<string, VaultVersion>();
  let cacheable = true;

  async function scanFolder(relativePath: string): Promise<void> {
    const path = join(root, relativePath);
    const version = await vaultVersion(path);
    versions.set(path, version);
    if (!version?.isDirectory()) return;
    try {
      const children = await readdir(path, { withFileTypes: true });
      for (const child of children) {
        const relative = relativePath + '/' + child.name;
        if (child.isDirectory() && !child.name.startsWith('_') && !/\.tmp$/i.test(child.name)) {
          await scanFolder(relative);
        } else if (child.isFile() && memoryPath(relative)) {
          const filePath = join(path, child.name);
          const result = await readMemoryFile(filePath, relative);
          if (result) {
            files.push(result.file);
            versions.set(filePath, result.version);
          } else {
            cacheable = false;
          }
        }
      }
    } catch (error) {
      if (!unavailable(error)) throw error;
      cacheable = false;
    }
  }

  for (const folder of Object.keys(vaultFolders)) await scanFolder(folder);
  files.sort((first, second) => first.path.localeCompare(second.path, 'zh-Hant', { numeric: true }));
  return { files, versions, cacheable };
}
