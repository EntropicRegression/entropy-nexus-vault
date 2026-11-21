import { describe, expect, it } from 'vitest';
import { publicAttributes, redactForRenderer } from './privacy';

const hidden = '[本機路徑已隱藏]';
const B = '\\';

describe('IPC 路徑遮罩(docs/架構.md §11)', () => {
  it.each([
    ['見 C:' + B + 'Users' + B + '王 小明' + B + '桌面' + B + 'a.md 說明', '見 ' + hidden],
    ['路徑D:/proj/x', '路徑' + hidden],
    [B + B + 'server' + B + 'share' + B + 'x', hidden],
    ['開啟 file:///C:/a', '開啟 ' + hidden],
    ['資料 /home/dad/x', '資料 ' + hidden],
    ['..' + B + '..' + B + 'Users' + B + 'dad' + B + 'x', hidden],
    ['Users' + B + 'dad' + B + 'Desktop', hidden],
    ['./users/dad/notes', hidden],
  ])('遮住含磁碟代號或使用者目錄的路徑:%s', (input, output) => {
    expect(redactForRenderer(input)).toBe(output);
  });

  it.each([
    '修改 src' + B + 'main' + B + 'core.ts 後重跑測試',
    '見 cases/月汐/x.md',
    '..' + B + 'shared' + B + 'types.ts',
    'https://example.com/a/b',
    '[[knowledge/a/b.md]]',
    '時間 10:30/11:00',
    '和/或',
    '%USERPROFILE%' + B + 'Desktop',
  ])('保留一般相對路徑與非路徑文字:%s', (input) => {
    expect(redactForRenderer(input)).toBe(input);
  });

  it('遮罩停在全形標點,後面的文字保留', () => {
    expect(redactForRenderer('（C:' + B + 'Program Files' + B + 'x）結尾')).toBe('（' + hidden + '）結尾');
  });

  it('屬性中的相對路徑保留;清單只移除含絕對路徑的那幾項,單值含絕對路徑則整欄移除', () => {
    const attributes = publicAttributes(new Map<string, string | string[]>([
      ['改過的檔案', ['src/a.ts', 'C:' + B + 'x' + B + 'secret.ts', 'src' + B + 'b.ts']],
      ['備註', 'C:' + B + 'x' + B + 'b.ts'],
      ['全是本機', ['D:/a', '/home/x']],
    ]));
    expect(attributes).toEqual([['改過的檔案', ['src/a.ts', 'src' + B + 'b.ts']]]);
  });
});
