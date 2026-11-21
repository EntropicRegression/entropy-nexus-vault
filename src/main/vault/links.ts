import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import type { FrontMatterValue, SupersessionLink } from '../../shared/types';
import { markdownHeadings } from './entry';
import type { ParsedEntry } from './entry';
import { field } from './frontmatter';
import { memoryPath } from './scan';

function cleanReference(input: string): string {
  return input.split('|', 1)[0].trim().replace(/\\/g, '/').replace(/^\.?\//, '');
}

function referenceKey(input: string): string {
  return cleanReference(input).replace(/\.md$/i, '').toLowerCase();
}

function references(value: FrontMatterValue | undefined): string[] {
  const values = typeof value === 'string' ? [value] : value ?? [];
  return values.flatMap((text) => {
    const targets = [...text.matchAll(/\[\[([^\[\]\r\n]+)\]\]/g)].map((match) => match[1]);
    return (targets.length ? targets : text.split(/[,，、]/)).map(cleanReference).filter(Boolean);
  });
}

function addChoice(index: Map<string, ParsedEntry[]>, key: string, entry: ParsedEntry): void {
  const choices = index.get(key);
  if (choices) choices.push(entry);
  else index.set(key, [entry]);
}

function uniqueOrLocal(choices: ParsedEntry[] | undefined, from: string): ParsedEntry | undefined {
  if (choices?.length === 1) return choices[0];
  const parent = from.slice(0, from.lastIndexOf('/')).toLowerCase();
  const local = choices?.filter(({ entry }) => entry.path.slice(0, entry.path.lastIndexOf('/')).toLowerCase() === parent);
  return local?.length === 1 ? local[0] : undefined;
}

function isMarkdownPath(path: string): string | null {
  return memoryPath(/\.md$/i.test(path) ? path : path + '.md');
}

/** 查詢已解析的索引，模糊檔名只接受唯一結果或來源同目錄的唯一結果。 */
export class VaultLinks {
  private readonly byPath = new Map<string, ParsedEntry>();
  private readonly byName = new Map<string, ParsedEntry[]>();
  private readonly byCase = new Map<string, ParsedEntry[]>();
  private readonly previous = new Map<string, SupersessionLink[]>();

  constructor(entries: ParsedEntry[]) {
    for (const parsed of entries) {
      const { path, caseId } = parsed.entry;
      const key = referenceKey(path);
      this.byPath.set(key, parsed);
      addChoice(this.byName, key.slice(key.lastIndexOf('/') + 1), parsed);
      if (caseId) addChoice(this.byCase, caseId, parsed);
    }
    for (const parsed of entries) {
      const { path } = parsed.entry;
      const targets = references(parsed.attributes.get('取代') ?? parsed.attributes.get('supersedes'));
      const links: SupersessionLink[] = [];
      for (const target of targets) {
        const indexed = this.resolve(target, path);
        if (indexed?.entry.path === path) continue;
        if (indexed) {
          indexed.entry.superseded = true;
          links.push({ path: indexed.entry.path, title: indexed.entry.title, status: 'available' });
        } else {
          const candidate = target.includes('/') ? target : path.slice(0, path.lastIndexOf('/') + 1) + target;
          links.push({ path: isMarkdownPath(candidate) ?? target, title: null, status: 'missing' });
        }
      }
      if (links.length) this.previous.set(path, links);
    }
  }

  resolve(reference: string, from: string): ParsedEntry | undefined {
    const key = referenceKey(reference);
    if (key.includes('/')) return this.byPath.get(key);
    return uniqueOrLocal(this.byCase.get(key), from) ?? uniqueOrLocal(this.byName.get(key), from);
  }

  caseReferences(parsed: ParsedEntry): string[] {
    const paths = new Set<string>();
    for (const match of parsed.body.matchAll(/\[\[(\d{4}-\d{4})(?:\|[^\]]+)?\]\]/g)) {
      const target = uniqueOrLocal(this.byCase.get(match[1]), parsed.entry.path);
      if (target) paths.add(target.entry.path);
    }
    return [...paths];
  }

  supersessionChain(path: string): SupersessionLink[] {
    const chain: SupersessionLink[] = [];
    const visited = new Set([referenceKey(path)]);
    const pending = [...(this.previous.get(path) ?? [])].reverse();
    while (pending.length) {
      const link = pending.pop()!;
      const key = referenceKey(link.path);
      if (visited.has(key)) continue;
      visited.add(key);
      chain.push(link);
      pending.push(...[...(this.previous.get(link.path) ?? [])].reverse());
    }
    return chain;
  }
}

/** 只探查鏈上指到的具名檔案；回收區內容不進入掃描或搜尋。 */
export async function inRecycle(root: string, relative: string): Promise<boolean> {
  const path = isMarkdownPath(relative);
  if (!path) return false;
  const components = ['_回收', ...path.split('/')];
  let current = root;
  try {
    for (const [index, component] of components.entries()) {
      current = join(current, component);
      const info = await lstat(current);
      if (index === components.length - 1) return info.isFile();
      if (!info.isDirectory()) return false;
    }
  } catch {
    return false;
  }
  return false;
}

function lineageLine(line: string): string | undefined {
  return /^\s*接回自\s*[:：]\s*(.+)$/.exec(line)?.[1];
}

function lineagePath(value: string): string | undefined {
  return cleanReference(/^\[\[([^\]]+)\]\]$/.exec(value.trim())?.[1] ?? value) || undefined;
}

export function lineageReference(parsed: ParsedEntry): string | undefined {
  const lines = parsed.markdown.split(/\r?\n/);
  const headings = markdownHeadings(lines).filter((heading) => heading.level <= 2);
  for (let index = headings.length - 1; index >= 0; index--) {
    const heading = headings[index];
    if (heading.level !== 2 || !/^主控台補充(?:\s|[（(]|$)/.test(heading.title)) continue;
    const firstLine = lines.slice(heading.line + 1, headings[index + 1]?.line).find((line) => line.trim());
    const source = firstLine && lineageLine(firstLine);
    if (source) return lineagePath(source);
  }
  const metadata = field(parsed.attributes, '接回自', 'inheritedFrom');
  const firstLine = lines.find((line) => line.trim());
  return lineagePath(metadata || (firstLine && lineageLine(firstLine)) || '');
}
