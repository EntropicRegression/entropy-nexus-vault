import { createHash } from 'node:crypto';
import { win32 } from 'node:path';
import type { FrontMatterValue } from '../../shared/types';
import { memoryPath } from './scan';

export function opaqueKey(namespace: 'p' | 'v', value: string): string {
  if (!value) return '';
  const canonical = /^(?:[a-z]:[\\/]|[\\/]{2})/i.test(value)
    ? win32.normalize(value).toLowerCase()
    : value;
  return namespace + '_' + createHash('sha256').update(canonical).digest('hex').slice(0, 24);
}

const sensitiveKeys = new Set([
  '專案id', 'projectid', '工作目錄', '工作資料夾', '工作路徑', 'cwd', 'workdir', 'workingdir', 'workingdirectory',
  '圖像目錄', '頭像', '立繪', '頭像路徑', '立繪路徑', '絕對路徑', 'portraitsdir', 'portraitpath', 'avatarpath',
  'projectpath', 'projectdir', 'projectroot', 'rootpath', 'vaultpath', 'reporoot', 'brandportraitpath',
]);

// Paths that reveal the machine or the user are hidden: drive paths, UNC shares, file: URLs, POSIX absolute paths,
// and relative paths that walk into a Users/home folder (they carry the account name). Ordinary relative paths
// such as src\main\core.ts or cases/x.md are kept (docs/架構.md §11). The match runs to the next text delimiter
// so folder names with spaces are covered.
const localPath = /(?<![a-z0-9_])(?:file:(?:[/\\]|%2f|%5c)+|[a-z]:[\\/]|\\\\)[^\r\n\x60"'<>()[\]（）「」『』【】、，。；：]*|(?<![\p{L}\p{N}_.%/\\])(?:\.{1,2}[\\/])*(?:users|home)[\\/](?=[^\\/\s])[^\r\n\x60"'<>()[\]（）「」『』【】、，。；：]*|(?<![\p{L}\p{N}_.~:/\\])\/(?:\/)?[\p{L}\p{N}_.~-][^\r\n\x60"'<>()[\]（）「」『』【】、，。；：]*/giu;

export function replaceLocalPaths(text: string, replacement: (path: string) => string): string {
  return text.replace(localPath, replacement);
}

export function isPrivateVaultField(key: string): boolean {
  return sensitiveKeys.has(key.normalize('NFKC').toLowerCase().replace(/[\s_-]/g, ''));
}

function containsLocalPath(value: string): boolean {
  return value.search(localPath) !== -1;
}

/** Drops private keys; list values lose only the items that contain a local path (a list left empty is dropped). */
export function publicAttributes(attributes: ReadonlyMap<string, FrontMatterValue>): [string, FrontMatterValue][] {
  const result: [string, FrontMatterValue][] = [];
  for (const [key, value] of attributes) {
    if (isPrivateVaultField(key) || containsLocalPath(key)) continue;
    if (Array.isArray(value)) {
      const kept = value.filter((item) => !containsLocalPath(item));
      if (kept.length || !value.length) result.push([key, kept]);
    } else if (!containsLocalPath(value)) result.push([key, value]);
  }
  return result;
}

function isVaultPathField(key: string, value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (key === 'path' || key === 'originalPath') return memoryPath(value) === value;
  const prefix = '_回收/';
  if (key !== 'recycledPath' || !value.startsWith(prefix)) return false;
  const path = value.slice(prefix.length);
  return memoryPath(path) === path;
}

/** Final IPC boundary for vault DTOs, including future profile or archive fields. */
export function redactForRenderer<T>(value: T): T {
  if (typeof value === 'string') return replaceLocalPaths(value, () => '[本機路徑已隱藏]') as T;
  if (Array.isArray(value)) return value.map(redactForRenderer) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([key, item]) =>
      (key === 'projectId' && typeof item === 'string' && /^(?:p_[a-f0-9]{24})?$/.test(item)) ||
      (!isPrivateVaultField(key) && !containsLocalPath(key)))
      .map(([key, item]) => [key, isVaultPathField(key, item) ? item : redactForRenderer(item)])) as T;
  }
  return value;
}
