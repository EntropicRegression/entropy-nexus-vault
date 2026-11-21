import { describe, expect, it } from 'vitest';
import { capText, computeRichness, glowOf, normaliseAwardReason } from './glow';
import type { RichnessInput } from './glow';

const base: RichnessInput = {
  confirmedCases: 0, participatedCases: 0, completedPeak: 0, rejectedAtPeak: 0, completedNow: 0, rejectedNow: 0, projects: 0,
};
const node = (patch: Partial<RichnessInput>) => computeRichness({ ...base, ...patch });

describe('經歷豐富度第 2 版(DESIGN.md §6.9 試算表)', () => {
  it.each([
    ['claudia jr', { confirmedCases: 6, participatedCases: 1, projects: 2, completedPeak: 40, rejectedAtPeak: 3, completedNow: 40, rejectedNow: 3 }, 72, 'violet'],
    ['claudia(一代)', { confirmedCases: 4, projects: 1, completedPeak: 26, rejectedAtPeak: 3, completedNow: 26, rejectedNow: 3 }, 46, 'blue'],
    ['Hagemi', { confirmedCases: 3, projects: 2, completedPeak: 30, rejectedAtPeak: 2, completedNow: 30, rejectedNow: 2 }, 40, 'blue'],
    ['gpt', { confirmedCases: 2, projects: 1, completedPeak: 17, rejectedAtPeak: 2, completedNow: 17, rejectedNow: 2 }, 25, 'green'],
    ['新節點', { projects: 1, completedPeak: 5, completedNow: 5 }, 4, 'white'],
    ['灌水:200 件瑣碎任務、6 專案、0 判例', { projects: 6, completedPeak: 200, completedNow: 200 }, 44, 'blue'],
  ] as const)('%s', (_name, input, score, tier) => {
    const result = node(input);
    expect(result.score).toBe(score);
    expect(result.tier).toBe(tier);
  });

  it('灌水上限:參與 +10、專案最多 6 個(+24)、有效完成 +20,沒有承辦判例最高 54 分且停在藍', () => {
    const result = node({ participatedCases: 99, projects: 40, completedPeak: 5000, completedNow: 5000 });
    expect(result.parts).toEqual({ confirmedCases: 0, participatedCases: 10, projects: 24, completed: 20 });
    expect(result.score).toBe(54);
    expect(result.tier).toBe('blue');
  });

  it('有效完成 = 完成峰值 − 達峰時的退回數,每 10 件 1 分;退回多於完成時為 0', () => {
    expect(node({ completedPeak: 59, rejectedAtPeak: 10 }).parts.completed).toBe(4);
    expect(node({ completedPeak: 3, rejectedAtPeak: 9 }).effectiveCompleted).toBe(0);
  });

  it.each([
    [9, 'white'], [10, 'green'], [29, 'green'], [30, 'blue'], [59, 'blue'],
  ] as const)('門檻邊界(不需另外條件的等級):%s 分 → %s', (score, tier) => {
    // Only own cases (×10) plus participations (×1, at most 10) to hit an exact score.
    const confirmedCases = Math.floor(score / 10);
    expect(node({ confirmedCases, participatedCases: score - confirmedCases * 10 }).tier).toBe(tier);
  });

  it('紫:60 分且 ≥3 份承辦判例;金:120 分、≥8 份、≥2 個專案;紅:200 分、≥15 份、≥3 個專案', () => {
    expect(node({ confirmedCases: 6 }).tier).toBe('violet');
    expect(node({ confirmedCases: 5, participatedCases: 9 }).tier).toBe('blue');
    expect(node({ confirmedCases: 2, participatedCases: 10, projects: 6, completedPeak: 200 }).tier).toBe('blue');
    expect(node({ confirmedCases: 12 }).tier).toBe('violet');
    expect(node({ confirmedCases: 12 }).caps).toEqual([{ kind: 'projects', tier: 'gold', need: 2, have: 0 }]);
    expect(node({ confirmedCases: 11, projects: 2, participatedCases: 2 }).tier).toBe('gold');
    expect(node({ confirmedCases: 20, projects: 2 }).tier).toBe('gold');
    expect(node({ confirmedCases: 20, projects: 3 }).tier).toBe('red');
    // 14 own cases can score at most 140 + 54 = 194, so red's 15-case rule is never the binding one below 200.
    expect(node({ confirmedCases: 14, projects: 6, participatedCases: 10, completedPeak: 400 }).tier).toBe('gold');
    expect(node({ confirmedCases: 2, participatedCases: 10, projects: 6, completedPeak: 200 }).caps)
      .toEqual([{ kind: 'cases', tier: 'violet', need: 3, have: 2 }]);
  });

  it('退回率 >20% 最高到藍;紅要求 ≤10%;完成數 <10 件時不判斷', () => {
    const strong = { confirmedCases: 20, projects: 3 };
    expect(node({ ...strong, completedNow: 50, rejectedNow: 11 }).tier).toBe('blue');
    expect(node({ ...strong, completedNow: 50, rejectedNow: 11 }).caps).toEqual([{ kind: 'rejection', limit: 0.2, rate: 0.22 }]);
    expect(node({ ...strong, completedNow: 50, rejectedNow: 6 }).caps).toEqual([{ kind: 'rejection', limit: 0.1, rate: 0.12 }]);
    expect(node({ ...strong, completedNow: 50, rejectedNow: 10 }).tier).toBe('gold');
    expect(node({ ...strong, completedNow: 50, rejectedNow: 6 }).tier).toBe('gold');
    expect(node({ ...strong, completedNow: 50, rejectedNow: 5 }).tier).toBe('red');
    expect(node({ ...strong, completedNow: 9, rejectedNow: 9 }).tier).toBe('red');
    expect(node({ ...strong, completedNow: 9, rejectedNow: 9 }).rejectionRate).toBeNull();
  });

  it('退回率用目前窗口,有效完成用峰值:舊任務過期時分數不掉', () => {
    const before = node({ confirmedCases: 3, completedPeak: 120, rejectedAtPeak: 0, completedNow: 120 });
    const after = node({ confirmedCases: 3, completedPeak: 120, rejectedAtPeak: 0, completedNow: 12, rejectedNow: 0 });
    expect(after.score).toBe(before.score);
  });

  it('封頂說明文字', () => {
    expect(capText({ kind: 'no-cases' })).toBe('沒有自己承辦的已確認判例,最高到藍晶');
    expect(capText({ kind: 'rejection', limit: 0.2, rate: 0.25 })).toBe('退回率 25%,超過 20%,最高到藍晶');
    expect(capText({ kind: 'rejection', limit: 0.1, rate: 0.12 })).toBe('退回率 12%,超過 10%,不能到紅晶');
    expect(capText({ kind: 'cases', tier: 'gold', need: 8, have: 5 })).toBe('金晶需要 8 份承辦的已確認判例(目前 5 份)');
  });

  it('彩虹只來自手動頒發', () => {
    const top = node({ confirmedCases: 99, projects: 9, participatedCases: 99, completedPeak: 9999, completedNow: 9999 });
    expect(top.tier).toBe('red');
    expect(glowOf(top, null)).toBe('red');
    expect(glowOf(node({}), { awardedAt: '2026-11-22T10:00:00.000Z', reason: '' })).toBe('rainbow');
  });

  it('頒發理由:去頭尾空白、換行改空白,最多 80 字', () => {
    expect(normaliseAwardReason('  主導\n記憶庫\r\n安全  ')).toBe('主導 記憶庫 安全');
    expect(normaliseAwardReason('字'.repeat(80))).toBe('字'.repeat(80));
    expect(normaliseAwardReason('字'.repeat(81))).toBeNull();
    expect(normaliseAwardReason(42)).toBeNull();
  });
});
