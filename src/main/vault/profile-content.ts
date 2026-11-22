import { isUtf8 } from 'node:buffer';
import type { ConsoleAppendix, ProfilePlaceholderFailure } from '../../shared/types';
import { markdownHeadings, splitReview } from './entry';
import { field, parseFrontMatter } from './frontmatter';
import { replaceLocalPaths } from './privacy';
import { memoryPath } from './scan';

const consoleTitle = /^主控台補充[（(](\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2})[）)]$/;
const literalConsoleHeading = /^## 主控台補充\(\d{4}-\d{2}-\d{2} \d{2}:\d{2}\)$/;
const reservedToken = /⟦[^⟦⟧\r\n]*(?:⟧|(?=⟦)|$)|⟧/gm;

export function profilePath(input: unknown): string | null {
  const key = memoryPath(input);
  return key && /^nodes\/(?:封存\/)?[^/]+\.md$/i.test(key) ? key : null;
}

function appendixHeadings(lines: string[]) {
  return markdownHeadings(lines).flatMap(({ line, level, title }) => {
    const time = level === 2 && consoleTitle.exec(title)?.[1];
    return time ? [{ line, at: time }] : [];
  });
}

function ambiguousAppendix(lines: string[], headings: ReturnType<typeof appendixHeadings>): boolean {
  // The console appends independently of Markdown state. An exact, blank-delimited marker
  // hidden by a code fence may therefore be an actual appendix; keep the file read-only.
  const recognized = new Set(headings.map(({ line }) => line));
  return lines.some((text, i) => lines[i - 1] === '' && lines[i + 1] === '' &&
    literalConsoleHeading.test(text) && !recognized.has(i));
}

export function profileOutline(markdown: string) {
  const lines = markdown.split(/\r?\n/);
  const headings = appendixHeadings(lines);
  const userLines = lines.slice(0, headings[0]?.line ?? lines.length);
  return { lines, headings, userLines };
}

export function formatLocalAppendixTime(at: string, timeZone?: string): string | null {
  const isoMinute = at.replace(' ', 'T');
  const date = new Date(isoMinute + ':00Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 16) !== isoMinute) return null;
  const format = new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const parts = Object.fromEntries(format.formatToParts(date).map(({ type, value }) => [type, value]));
  return parts.year.padStart(4, '0') + '-' + parts.month + '-' + parts.day + ' ' + parts.hour + ':' + parts.minute + '（本機時間）';
}

export function profileSections(markdown: string) {
  const { lines, headings, userLines } = profileOutline(markdown);
  const appendices: ConsoleAppendix[] = headings.map(({ line, at }, i) => {
    const { body, review } = splitReview(lines.slice(line + 1, headings[i + 1]?.line ?? lines.length));
    return { at, localTime: formatLocalAppendixTime(at), text: body, review };
  });
  return { userLines, ...splitReview(userLines), appendices };
}

function profileHeader(bytes: Buffer) {
  const byteText = bytes.toString('latin1');
  const opening = /^(?:\xef\xbb\xbf)?[\t ]*---[\t ]*\r?\n/.exec(byteText);
  if (!opening) return null;
  const closing = /^[\t ]*---[\t ]*(?:\r?\n|$)/gm;
  closing.lastIndex = opening[0].length;
  const match = closing.exec(byteText);
  if (!match) return null;
  const end = match.index + match[0].length;
  const { attributes } = parseFrontMatter(bytes.subarray(0, end).toString('utf8'));
  return attributes.size ? { end, nodeId: field(attributes, '節點ID', '節點id', 'node-id', 'nodeId') } : null;
}

export function splitProfileBytes(bytes: Buffer, savedAppendixSize?: number) {
  const layout = profileHeader(bytes);
  if (!layout) return null;
  const { end: bodyStart, nodeId } = layout;
  const markdown = bytes.subarray(bodyStart);
  const lines = markdown.toString('utf8').split(/\r?\n/);
  const headings = appendixHeadings(lines);
  const first = headings[0];
  let appendixStart = markdown.length;
  if (first) {
    let heading = 0;
    for (let line = 0; line < first.line; line++) heading = markdown.indexOf(0x0a, heading) + 1;
    const boundary = /(?:\r?\n[\t ]*)+$/.exec(markdown.subarray(0, heading).toString('latin1'));
    appendixStart = boundary?.index ?? heading;
    // A continuing edit may have added blank lines just before the untouched separator.
    // Keep those lines on the editable side for as long as this draft is active.
    if (savedAppendixSize !== undefined) {
      const savedStart = markdown.length - savedAppendixSize;
      if (savedStart >= appendixStart && savedStart <= heading) appendixStart = savedStart;
    }
  }
  const header = bytes.subarray(0, bodyStart);
  const user = markdown.subarray(0, appendixStart);
  const appendix = markdown.subarray(appendixStart);
  const newline = /\r?\n/.exec(header.toString('latin1'))?.[0] === '\r\n' ? '\r\n' : '\n';
  return { header, user, appendix, newline, nodeId, utf8: isUtf8(user), ambiguous: ambiguousAppendix(lines, headings) };
}

export function editPlaceholders(body: string) {
  const paths = new Map<string, string>();
  function keep(original: string) {
    const token = '⟦路徑' + (paths.size + 1) + '⟧';
    paths.set(token, original);
    return token;
  }
  // Reserve literal markers found in the original so a no-op save preserves them too.
  const parts: string[] = [];
  let offset = 0;
  for (const marker of body.matchAll(reservedToken)) {
    parts.push(replaceLocalPaths(body.slice(offset, marker.index), keep), keep(marker[0]));
    offset = marker.index + marker[0].length;
  }
  parts.push(replaceLocalPaths(body.slice(offset), keep));
  return { body: parts.join(''), paths };
}

export function restorePlaceholders(body: string, paths: ReadonlyMap<string, string>, acknowledgedRemovals: readonly number[]):
  { ok: true; body: string; removedTokens: string[] } | ProfilePlaceholderFailure | { ok: false; reason: 'invalid-input' } {
  const seen = new Set<string>();
  for (const [token] of body.matchAll(reservedToken)) {
    if (!paths.has(token)) return { ok: false, reason: 'invalid-placeholders', issue: 'modified-or-unknown' };
    if (seen.has(token)) return { ok: false, reason: 'invalid-placeholders', issue: 'duplicate' };
    seen.add(token);
  }
  const removedTokens = [...paths.keys()].filter((token) => !seen.has(token));
  const missingPlaceholders = removedTokens.map((token) => Number(token.slice('⟦路徑'.length, -1)));
  const missing = new Set(missingPlaceholders);
  if (acknowledgedRemovals.some((number) => !missing.has(number))) return { ok: false, reason: 'invalid-input' };
  if (acknowledgedRemovals.length !== missingPlaceholders.length) {
    const list = missingPlaceholders.map((number) => '#' + number).join('、');
    return { ok: false, reason: 'invalid-placeholders', issue: 'missing', missingPlaceholders,
      message: '這些佔位符已被刪除：' + list + '。確認刪除後，對應的路徑原文會從側寫永久移除。' };
  }
  return { ok: true, body: body.replace(reservedToken, (token) => paths.get(token)!), removedTokens };
}

export function buildProfileBytes(parts: NonNullable<ReturnType<typeof splitProfileBytes>>, edit: string): Buffer | null {
  const { header, user, appendix, newline } = parts;
  const normalize = (text: string) => text.replace(/\r\n|\r/g, '\n');
  const normalized = normalize(edit);
  const lines = normalized.split('\n');
  const headings = appendixHeadings(lines);
  if (headings.length || ambiguousAppendix(lines, headings)) return null;
  const body = normalized === normalize(user.toString('utf8')) ? user : Buffer.from(normalized.replace(/\n/g, newline));
  const prefix = body.length && header.at(-1) !== 0x0a ? Buffer.from(newline) : Buffer.alloc(0);
  const separator = body.length && appendix.length && appendix[0] !== 0x0d && appendix[0] !== 0x0a
    ? Buffer.from(newline + newline) : Buffer.alloc(0);
  const bytes = Buffer.concat([header, prefix, body, separator, appendix]);
  if (appendix.length && !splitProfileBytes(bytes)?.appendix.subarray(-appendix.length).equals(appendix)) return null;
  return bytes;
}
