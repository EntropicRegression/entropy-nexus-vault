import { describe, expect, it } from 'vitest';
import { parseFrontMatter } from './frontmatter';

describe('主控台檔頭格式', () => {
  it('讀取 BOM、CRLF、引號、兩種清單及未加引號的 Wiki 連結', () => {
    const source = [
      '\uFEFF---',
      '自訂值： "a \\"b\\""',
      '關鍵字: [濕度, "風速, 溫度", "a \\"b\\""]',
      '清單:',
      '  - 一',
      "  - '專案''代號'",
      '取代: [[knowledge/demo/舊稿|舊稿]]',
      '---',
      '# 正文',
    ].join('\r\n');

    expect([...parseFrontMatter(source).attributes]).toEqual([
      ['自訂值', 'a "b"'],
      ['關鍵字', ['濕度', '風速, 溫度', 'a "b"']],
      ['清單', ['一', "專案'代號"]],
      ['取代', '[[knowledge/demo/舊稿|舊稿]]'],
    ]);
    expect(parseFrontMatter(source).body).toBe('# 正文');
  });

  it('缺少開頭或結尾分隔線時保留整份正文', () => {
    for (const source of ['# 舊標題\n舊記憶', '---\nkind: preference\n# 未閉合']) {
      expect(parseFrontMatter(source)).toEqual({ attributes: new Map(), body: source });
    }
  });
});
