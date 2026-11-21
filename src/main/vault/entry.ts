import { calculateHeat } from '../../shared/heat';
import type { HeatRecall } from '../../shared/heat';
import { shelfOf } from '../../shared/shelves';
import type { MemoryEntry, MemoryKind, MemoryScope } from '../../shared/types';
import { field, parseFrontMatter } from './frontmatter';
import type { FrontMatter } from './frontmatter';
import { vaultFolders } from './scan';
import type { VaultFile } from './scan';

const kinds = new Map<string, MemoryKind>([
  ['node', 'node'], ['節點側寫', 'node'], ['節點', 'node'],
  ['case', 'case'], ['判例', 'case'], ['解法紀錄', 'case'], ['解法', 'case'],
  ['knowledge', 'knowledge'], ['專案知識', 'knowledge'], ['知識', 'knowledge'],
  ['preference', 'preference'], ['使用者偏好', 'preference'], ['偏好', 'preference'],
]);

export interface ParsedEntry {
  entry: MemoryEntry;
  attributes: FrontMatter['attributes'];
  markdown: string;
  body: string;
  review: string;
  mtime: number;
  size: number;
}

interface MarkdownHeading {
  line: number;
  level: number;
  title: string;
}

export function markdownHeadings(lines: string[]): MarkdownHeading[] {
  const headings: MarkdownHeading[] = [];
  let fence: string | undefined;
  for (const [index, line] of lines.entries()) {
    const marker = /^ {0,3}(\x60{3,}|~{3,})(.*)$/.exec(line);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined;
      continue;
    }
    if (fence) continue;
    const heading = /^ {0,3}(#{1,6})[ \t]+(.*)$/.exec(line);
    if (heading) headings.push({
      line: index,
      level: heading[1].length,
      title: heading[2].replace(/[ \t]+#+[ \t]*$/, '').trim(),
    });
  }
  return headings;
}

function splitReview(lines: string[], headings: MarkdownHeading[]) {
  const body: string[] = [];
  const reviews: string[] = [];
  let start = 0;
  const sections = headings.filter(({ level }) => level <= 2);
  for (const [index, heading] of sections.entries()) {
    if (heading.level !== 2 || heading.title !== '回顧') continue;
    const end = sections[index + 1]?.line ?? lines.length;
    body.push(lines.slice(start, heading.line).join('\n'));
    reviews.push(lines.slice(heading.line + 1, end).join('\n').trim());
    start = end;
  }
  body.push(lines.slice(start).join('\n'));
  return { body: body.join('\n').trim(), review: reviews.filter(Boolean).join('\n\n') };
}

export function memoryTimestamp(text: string): number | undefined {
  const timestamp = Date.parse(text.replace(' ', 'T'));
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function entryScope(value: string, kind: MemoryKind, projectId: string): MemoryScope {
  if (/專案|project/i.test(value)) return '專案';
  if (/全域|global/i.test(value)) return '全域';
  return kind !== 'node' && kind !== 'preference' && projectId ? '專案' : '全域';
}

function firstBodyParagraph(body: string): string {
  const lines = body.split('\n');
  let fence = '';
  const paragraph: string[] = [];
  for (const line of lines) {
    const text = line.trim();
    if (paragraph.length && (!text || /^#{1,6}[\t ]/.test(text) || /^(?:\x60{3,}|~{3,})/.test(text))) break;
    const marker = /^(\x60{3,}|~{3,})(.*)$/.exec(text);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = '';
      continue;
    }
    if (!fence && text && !/^#{1,6}[\t ]/.test(text)) paragraph.push(text);
  }
  return Array.from(paragraph.join(' ')).slice(0, 80).join('');
}

export function entryFromFile(file: VaultFile, recall: HeatRecall | undefined, now: number): ParsedEntry {
  const { path, text, mtime, size } = file;
  const { attributes, body: markdown } = parseFrontMatter(text);
  const lines = markdown.split(/\r?\n/);
  const headings = markdownHeadings(lines);
  const { body, review } = splitReview(lines, headings);

  const parts = path.split('/');
  const folder = parts[0] as keyof typeof vaultFolders;
  const filename = (parts.at(-1) ?? '').replace(/\.md$/i, '');
  const kind = kinds.get(field(attributes, '種類', 'kind', 'type').toLowerCase()) ?? vaultFolders[folder];
  const folderProject = (folder === 'cases' || folder === 'knowledge') && parts.length > 2 ? parts[1] : '';
  const projectName = field(attributes, '專案', 'project', 'projectName') || folderProject;
  const projectId = field(attributes, '專案ID', '專案id', 'project-id', 'projectId') || projectName;
  const scope = entryScope(field(attributes, '範圍', 'scope'), kind, projectId);
  const subtypeText = field(attributes, '子類', 'subtype');
  const subtype = /^decision$/i.test(subtypeText) ? '決策' : /^bookmark$/i.test(subtypeText) ? '書籤' : subtypeText;
  const nodeId = field(attributes, '節點ID', '節點id', 'node-id', 'nodeId');
  const nodeLabel = field(attributes, '節點', '承辦節點', 'nodeLabel', 'nodeName', 'node');
  const participantNodeIds = field(attributes, '參與節點ID', 'participantNodeIds')
    .split(/[,，、]/).map((part) => part.trim()).filter(Boolean);
  const status = field(attributes, '狀態', 'status');

  return {
    entry: {
      path,
      title: field(attributes, '標題', '案由', 'title', 'name') || headings.find((heading) => heading.level === 1)?.title || filename,
      summary: /^摘要[:：][ \t]*(.+)$/m.exec(body)?.[1].trim() || (kind === 'case' ? '' : firstBodyParagraph(body)),
      kind,
      shelf: shelfOf({ kind, subtype }),
      scope,
      projectId: scope === '專案' ? projectId : '',
      projectName: scope === '專案' ? projectName : '',
      nodeId,
      nodeLabel,
      participantNodeIds,
      nodeIds: [...new Set([nodeId, ...participantNodeIds].filter(Boolean))],
      subtype,
      status,
      caseId: kind === 'case' ? /^(\d{4}-\d{4})(?!\d)/.exec(filename)?.[1] ??
        (field(attributes, '案號', 'caseId') || null) : null,
      updatedAt: memoryTimestamp(field(attributes, '更新時間', 'updated', 'updatedAt', '封存時間')) ?? mtime,
      heat: calculateHeat(recall, now),
      superseded: false,
      previousCount: 0,
    },
    attributes,
    markdown,
    body,
    review,
    mtime,
    size,
  };
}
