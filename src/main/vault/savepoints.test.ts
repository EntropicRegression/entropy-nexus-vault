import { describe, expect, it } from 'vitest';
import { decodeSavepoints, withRestoreTarget } from './savepoints';

const path = (time: string) => 'nodes/封存/_存點/n1/' + time;
const item = (overrides: Record<string, unknown> = {}) => ({
  路徑: path('20261123-200000'), 時間: '2026-11-23T20:00:00+08:00', 後台ID: 'claude', 大小: 2048, 原檔還在: false, 可還原: true,
  ...overrides,
});

describe('存點解析(docs/架構.md §15)', () => {
  it('舊格式或不是陣列時是空清單', () => {
    expect(decodeSavepoints(undefined)).toEqual([]);
    expect(decodeSavepoints({ 路徑: path('x') })).toEqual([]);
  });

  it('照統計檔順序讀出中繼資料,不帶路徑,不重排', () => {
    const older = item({ 路徑: path('20261120-080000'), 時間: '2026-11-20T08:00:00+08:00', 原檔還在: null, 可還原: false });
    const result = decodeSavepoints([older, item()]);
    expect(result).toEqual([
      { time: Date.parse('2026-11-20T00:00:00Z'), backend: 'claude', size: 2048, originalExists: null, restorable: false },
      { time: Date.parse('2026-11-23T12:00:00Z'), backend: 'claude', size: 2048, originalExists: false, restorable: true },
    ]);
    expect(Object.keys(result[0])).not.toContain('path');
  });

  it('壞筆略過、其他欄位容錯', () => {
    const result = decodeSavepoints([
      item({ 時間: '不是時間' }),
      item({ 路徑: 'nodes/封存/n1/x' }),
      item({ 路徑: 'nodes/封存/_存點/../../cases' }),
      item({ 路徑: 'nodes\\封存\\_存點\\n1\\x' }),
      null, 'x', [],
      item({ 後台ID: 'gemini', 大小: -1, 原檔還在: 'yes', 可還原: 'true', 多的欄位: 1 }),
      item({ 後台ID: 'antigravity', 大小: 1.5 }),
    ]);
    expect(result).toEqual([
      expect.objectContaining({ backend: 'other', size: null, originalExists: null, restorable: false }),
      expect.objectContaining({ backend: 'antigravity', size: null }),
    ]);
  });
});

describe('還原對象', () => {
  const decoded = (...items: Record<string, unknown>[]) => decodeSavepoints(items.map((overrides) => item(overrides)));
  const targets = (list: ReturnType<typeof withRestoreTarget>) => list.map(({ restoreTarget }) => restoreTarget);

  it('第一個可還原且原檔不在、可喚醒時才是還原對象,最多一筆', () => {
    expect(targets(withRestoreTarget(decoded({ 可還原: false, 原檔還在: null }), true))).toEqual([false]);
    expect(targets(withRestoreTarget(decoded({ 可還原: false, 原檔還在: null }, {}, {}), true))).toEqual([false, true, false]);
  });

  it('不可喚醒(例如主控台關閉還原支援時原檔沒了)、原檔還在或 null 時沒有還原對象', () => {
    expect(targets(withRestoreTarget(decoded({}), false))).toEqual([false]);
    expect(targets(withRestoreTarget(decoded({ 原檔還在: true }), true))).toEqual([false]);
    expect(targets(withRestoreTarget(decoded({ 原檔還在: null }), true))).toEqual([false]);
  });

  it('第一個可還原的不符合時,不往後找較舊的', () => {
    expect(targets(withRestoreTarget(decoded({ 原檔還在: true }, {}), true))).toEqual([false, false]);
  });
});
