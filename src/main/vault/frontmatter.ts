import type { FrontMatterValue } from '../../shared/types';

export interface FrontMatter {
  attributes: ReadonlyMap<string, FrontMatterValue>;
  body: string;
}

function unquote(input: string): string {
  const value = input.trim();
  if (value.length < 2) return value;
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  if (value.startsWith('"') && value.endsWith('"')) {
    try { return JSON.parse(value) as string; } catch { return value.slice(1, -1); }
  }
  return value;
}

function inlineList(value: string): string[] {
  const items: string[] = [];
  let start = 1;
  let quote = '';
  for (let index = start; index < value.length - 1; index++) {
    const ch = value[index];
    if (quote) {
      if (quote === '"' && ch === '\\') index++;
      else if (ch === quote) quote = '';
    } else if ((ch === '"' || ch === "'") && !value.slice(start, index).trim()) {
      quote = ch;
    } else if (ch === ',' || ch === '，') {
      items.push(unquote(value.slice(start, index)));
      start = index + 1;
    }
  }
  items.push(unquote(value.slice(start, -1)));
  return items.filter(Boolean);
}

/** 主控台寫出的檔頭只用單行值、行內清單與逐行清單。保留其餘欄位的名稱及順序供詳情顯示。 */
export function parseFrontMatter(text: string): FrontMatter {
  const source = text.replace(/^\uFEFF/, '');
  const lines = source.split(/\r?\n/);
  const attributes = new Map<string, FrontMatterValue>();
  if (lines[0]?.trim() !== '---') return { attributes, body: source };
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end < 0) return { attributes, body: source };

  let list: string[] | undefined;
  for (const line of lines.slice(1, end)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const item = /^\s*-\s+(.+)$/.exec(line);
    if (item && list) {
      list.push(unquote(item[1]));
      continue;
    }
    if (/^\s/.test(line)) continue;

    list = undefined;
    const property = /^([^:：]+)[:：]\s*(.*)$/.exec(line);
    const key = property?.[1].trim();
    if (!property || !key) continue;
    const value = property[2].trim();
    if (!value) {
      list = [];
      attributes.set(key, list);
    } else if (value.startsWith('[') && !value.startsWith('[[') && value.endsWith(']')) {
      attributes.set(key, inlineList(value));
    } else {
      attributes.set(key, unquote(value));
    }
  }
  return { attributes, body: lines.slice(end + 1).join('\n') };
}

export function field(attributes: FrontMatter['attributes'], ...keys: string[]): string {
  for (const key of keys) {
    const value = attributes.get(key);
    const text = Array.isArray(value) ? value.join('、').trim() : value?.trim();
    if (text) return text;
  }
  return '';
}
