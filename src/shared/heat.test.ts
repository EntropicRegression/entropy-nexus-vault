import { describe, expect, it } from 'vitest';
import { calculateHeat, defaultHeatThresholds } from './heat';

const now = Date.parse('2026-11-21T08:00:00.000Z');

describe('熱度', () => {
  it.each([
    [0, '沉睡'], [1, '餘溫'], [2, '餘溫'], [3, '微溫'], [6, '微溫'], [7, '熾熱'],
  ])('召回 %i 次為 %s', (count, level) => {
    expect(calculateHeat({ count, lastRecalledAt: '2026-11-21T06:00:00.000Z' }, now).level).toBe(level);
  });

  it('超過 30 天才降一級，且最低仍為沉睡', () => {
    const edge = { count: 7, lastRecalledAt: '2026-10-22T08:00:00.000Z' };
    expect(calculateHeat(edge, now).level).toBe('熾熱');
    expect(calculateHeat(edge, now + 1).level).toBe('微溫');
    expect(calculateHeat({ ...edge, count: 1 }, now + 1).level).toBe('沉睡');
    expect(calculateHeat({ ...edge, count: 0 }, now + 1).level).toBe('沉睡');
  });

  it('門檻可調，缺資料預設為沉睡', () => {
    expect(calculateHeat({ count: 7, lastRecalledAt: null }, now, { ...defaultHeatThresholds, hot: 8 }).level).toBe('微溫');
    expect(calculateHeat(undefined, now)).toEqual({ level: '沉睡', count: 0, lastRecalledAt: null });
  });
});
