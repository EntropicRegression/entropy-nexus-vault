import type { VaultStatusUpdate } from '../../shared/types';
import { beforeYamlComment } from './frontmatter';

const byteString = (value: string) => Buffer.from(value, 'utf8').toString('latin1');
const chineseStatus = byteString('狀態');
const bom = byteString('\uFEFF');
const separator = new RegExp('^(.+?)(:|' + byteString('：') + ')([\\t ]*)(.*)$');
const knownKeys = new Set([
  '種類', 'kind', 'type', '標題', 'title', 'name', '案由', '案號', 'caseId', '狀態', 'status',
  '節點', '節點ID', '節點id', 'nodeId', 'node-id', 'nodeLabel', 'nodeName', '承辦節點',
  '專案', 'project', 'projectName', '專案ID', '專案id', 'projectId', 'project-id',
  '範圍', 'scope', '子類', 'subtype', '更新時間', 'updated', 'updatedAt', '封存時間', '關鍵字', 'keywords',
  '取代', 'supersedes', '接回自', '工作目錄',
]);

interface HeaderLine {
  offset: number;
  next: number;
  ending: string;
  match: RegExpMatchArray;
}

function statusHeader(bytes: string) {
  const start = bytes.startsWith(bom) ? bom.length : 0;
  const opening = /^[ \t]*---[ \t]*\r?\n/.exec(bytes.slice(start));
  if (!opening) return null;
  let offset = start + opening[0].length;
  let ending = opening[0].endsWith('\r\n') ? '\r\n' : '\n';
  let preferred: HeaderLine | undefined;
  let alias: HeaderLine | undefined;
  let hasProperty = false;
  let hasKnownValue = false;
  const lines = /[^\n]*\n|[^\n]+$/g;
  lines.lastIndex = offset;
  for (let line = lines.exec(bytes); line; line = lines.exec(bytes)) {
    const [row] = line;
    const newline = row.match(/\r?\n$/)?.[0] ?? '';
    const raw = row.slice(0, row.length - newline.length);
    if (raw.trim() === '---') {
      return hasKnownValue ? { end: offset, ending, target: preferred ?? alias } : null;
    }
    if (raw.trim() && !raw.trimStart().startsWith('#')) {
      if (/^[ \t]/.test(raw)) {
        if (!hasProperty) return null;
      } else {
        const match = raw.match(separator);
        if (!match) return null;
        const key = Buffer.from(match[1].trim(), 'latin1').toString('utf8');
        if (!/^(?:[\p{L}\p{N}_][\p{L}\p{N}_. -]*|"[^"]+"|'[^']+')$/u.test(key)) return null;
        const property = { match, offset, next: offset + row.length, ending: newline };
        hasProperty = true;
        if (knownKeys.has(key) && beforeYamlComment(match[4]).trim()) hasKnownValue = true;
        if (match[1].trim() === chineseStatus) preferred = property;
        if (key === 'status') alias = property;
      }
    }
    if (newline) ending = newline;
    offset += row.length;
  }
  return null;
}

export function hasWritableHeader(text: string): boolean {
  const bytes = byteString(text);
  const header = statusHeader(bytes);
  return Boolean(header && (!header.target || statusValue(bytes, header.target, header.end) !== null));
}

function statusValue(bytes: string, target: HeaderLine, end: number): string | null {
  const value = beforeYamlComment(target.match[4]).trimEnd();
  const continuation = bytes.slice(target.next, end).match(/^(?:[ \t]*(?:#[^\r\n]*)?\r?\n)*[ \t]+(?![ \t]*#)\S/);
  return /^(?:[|>{]|\[)/.test(value) || continuation ? null : value;
}

/** Work in a one-character-per-byte string so an edit also preserves bytes outside valid UTF-8. */
export function editStatusLine(bytes: Buffer, status: VaultStatusUpdate): Buffer | null {
  const text = bytes.toString('latin1');
  const header = statusHeader(text);
  if (!header) return null;
  const updated = byteString(status);
  const { target, end, ending } = header;
  if (!target) return Buffer.from(text.slice(0, end) + chineseStatus + ': ' + updated + ending + text.slice(end), 'latin1');

  const [, key, delimiter, space, rawValue] = target.match;
  const value = statusValue(text, target, end);
  if (value === null) return null;
  const quote = value.match(/^(['"]).*\1$/)?.[1] ?? '';
  const suffix = rawValue.slice(value.length);
  const prefix = key + delimiter + (space || (suffix.startsWith('#') ? ' ' : ''));
  const replacement = prefix + quote + updated + quote + (suffix.startsWith('#') ? ' ' : '') + suffix;
  return Buffer.from(text.slice(0, target.offset) + replacement + target.ending + text.slice(target.next), 'latin1');
}
