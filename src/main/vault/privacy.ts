import { createHash } from 'node:crypto';
import { win32 } from 'node:path';
import type { FrontMatterValue } from '../../shared/types';

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
  'projectpath', 'projectdir', 'projectroot', 'rootpath', 'vaultpath', 'reporoot',
]);

// Consume the path to the next text delimiter, including spaces in folder names.
// URL and relative Markdown links keep their own classification.
const localPath = /(?<![a-z0-9_])(?:file:(?:[/\\]|%2f|%5c)+|[a-z]:[\\/]|\\\\)[^\r\n\x60"'<>()[\]]*|(?<![\p{L}\p{N}_.%/\\])(?:\.{1,2}\\|[\p{L}\p{N}_-]+\\)(?=[\p{L}\p{N}_.-])[^\r\n\x60"'<>()[\]]*|(?<![\p{L}\p{N}_.~:/\\])\/(?:\/)?[\p{L}\p{N}_.~-][^\r\n\x60"'<>()[\]]*/giu;

export function isPrivateVaultField(key: string): boolean {
  return sensitiveKeys.has(key.normalize('NFKC').toLowerCase().replace(/[\s_-]/g, ''));
}

function containsLocalPath(value: string): boolean {
  return value.search(localPath) !== -1;
}

export function publicAttributes(attributes: ReadonlyMap<string, FrontMatterValue>): [string, FrontMatterValue][] {
  return [...attributes].filter(([key, value]) => !isPrivateVaultField(key) && !containsLocalPath(key) &&
    !(Array.isArray(value) ? value.some(containsLocalPath) : containsLocalPath(value)));
}

/** Final IPC boundary for vault DTOs, including future profile or archive fields. */
export function redactForRenderer<T>(value: T): T {
  if (typeof value === 'string') return value.replace(localPath, '[本機路徑已隱藏]') as T;
  if (Array.isArray(value)) return value.map(redactForRenderer) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([key, item]) =>
      (key === 'projectId' && typeof item === 'string' && /^(?:p_[a-f0-9]{24})?$/.test(item)) ||
      (!isPrivateVaultField(key) && !containsLocalPath(key)))
      .map(([key, item]) => [key, redactForRenderer(item)])) as T;
  }
  return value;
}
