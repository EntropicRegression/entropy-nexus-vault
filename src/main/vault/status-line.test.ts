import { describe, expect, it } from 'vitest';
import { hasWritableHeader } from './status-line';

describe('status-line header keys', () => {
  // 「因」= e5 9b a0:逐位元組處理時最後一個位元組是 U+00A0,String#trim 會把它當空白切掉。
  it('keeps keys whose last UTF-8 byte is 0xA0 (結束原因)', () => {
    expect(hasWritableHeader('---\n種類: 會議紀錄\n結束原因: 完成\n狀態: 未確認\n---\n正文\n')).toBe(true);
    expect(hasWritableHeader('---\r\n原因: 測試\r\n狀態: 未確認\r\n---\r\n')).toBe(true);
  });

  it('still trims spaces and tabs around keys', () => {
    expect(hasWritableHeader('---\n狀態 \t: 未確認\n---\n')).toBe(true);
  });
});
