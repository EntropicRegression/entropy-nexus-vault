import { describe, expect, it } from 'vitest';
import { calculateHeat, defaultHeatThresholds, heatLevelNames } from './heat';

const now = Date.parse('2026-11-21T08:00:00.000Z');

describe('熱度', () => {
  it.each([
    [0, '餘燼'], [1, '微溫'], [2, '微溫'], [3, '溫潤'], [4, '溫潤'], [5, '炙熱'], [6, '炙熱'],
  ])('召回 %i 次為 %s', (count, level) => {
    expect(calculateHeat({ count, lastRecalledAt: '2026-11-21T06:00:00.000Z' }, now).level).toBe(level);
  });

  it.each([
    [0, '餘燼', '餘燼'], [1, '微溫', '餘燼'], [2, '微溫', '餘燼'],
    [3, '溫潤', '微溫'], [4, '溫潤', '微溫'], [5, '炙熱', '溫潤'], [6, '炙熱', '溫潤'],
  ])('召回 %i 次滿 30 天仍是 %s，超過才變 %s', (count, initial, decayed) => {
    const edge = { count, lastRecalledAt: '2026-10-22T08:00:00.000Z' };
    expect(calculateHeat(edge, now - 1).level).toBe(initial);
    expect(calculateHeat(edge, now).level).toBe(initial);
    expect(calculateHeat(edge, now + 1)).toEqual({ ...edge, level: decayed });
  });

  it('英文識別鍵對應新的中文名稱', () => {
    expect(heatLevelNames).toEqual({ ember: '餘燼', tepid: '微溫', temperate: '溫潤', flaming: '炙熱' });
  });

  it('門檻可調，缺資料預設為餘燼', () => {
    expect(calculateHeat({ count: 5, lastRecalledAt: null }, now, { ...defaultHeatThresholds, flaming: 6 }).level).toBe('溫潤');
    expect(calculateHeat(undefined, now)).toEqual({ level: '餘燼', count: 0, lastRecalledAt: null });
  });
});
