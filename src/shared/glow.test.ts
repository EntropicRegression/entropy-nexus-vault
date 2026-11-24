import { describe, expect, it } from 'vitest';
import { capText, computeRichness, glowOf, needText, nextTierNeeds, normaliseAwardReason } from './glow';
import type { RichnessInput } from './glow';

const base: RichnessInput = {
  confirmedCases: 0, participatedCases: 0, completedPeak: 0, rejectedPeak: 0, completedNow: 0, rejectedNow: 0, projects: 0,
};
const node = (patch: Partial<RichnessInput>) => computeRichness({ ...base, ...patch });

describe('經歷豐富度第 3 版(DESIGN.md §6.9,使用者 2026-11-24)', () => {
  it('分數 = 承辦 ×20 + 參與 ×10 + 專案 ×15 + 有效完成(每件 1 分),都沒有上限', () => {
    const result = node({ confirmedCases: 3, participatedCases: 99, projects: 40, completedPeak: 5000, rejectedPeak: 100 });
    expect(result.parts).toEqual({ confirmedCases: 60, participatedCases: 990, projects: 600, completed: 4900 });
    expect(result.score).toBe(6550);
  });

  it('有效完成 = 完成峰值 − 退回峰值;退回多於完成時為 0', () => {
    expect(node({ completedPeak: 59, rejectedPeak: 10 }).parts.completed).toBe(49);
    expect(node({ completedPeak: 3, rejectedPeak: 9 }).effectiveCompleted).toBe(0);
  });

  it.each([
    [9, 'white'], [10, 'green'], [99, 'green'], [100, 'blue'], [199, 'blue'],
  ] as const)('分數門檻:%s 分 → %s', (score, tier) => {
    expect(node({ completedPeak: score }).tier).toBe(tier);
  });

  it('紫:150 分且承辦或參與至少 1 份;只有參與也可以', () => {
    expect(node({ completedPeak: 200 }).tier).toBe('blue');
    expect(node({ completedPeak: 200 }).caps).toEqual([{ kind: 'involvement', tier: 'violet', need: 1, have: 0 }]);
    expect(node({ participatedCases: 1, completedPeak: 139 }).tier).toBe('blue');
    expect(node({ participatedCases: 1, completedPeak: 140 }).tier).toBe('violet');
    expect(node({ confirmedCases: 1, completedPeak: 130 }).tier).toBe('violet');
  });

  it('金:250 分、承辦+參與至少 2 份、專案至少 2 個', () => {
    expect(node({ confirmedCases: 1, participatedCases: 1, projects: 2, completedPeak: 190 }).tier).toBe('gold');
    expect(node({ confirmedCases: 1, projects: 2, completedPeak: 220 }).caps)
      .toEqual([{ kind: 'involvement', tier: 'gold', need: 2, have: 1 }]);
    expect(node({ confirmedCases: 1, participatedCases: 1, projects: 1, completedPeak: 230 }).tier).toBe('violet');
  });

  it('紅:320 分、承辦至少 3 份、(專案至少 3 個或參與至少 5 份)、有效完成至少 201 件', () => {
    const red = { confirmedCases: 3, projects: 3, completedPeak: 201 };
    expect(node(red).tier).toBe('gold');
    expect(node({ ...red, completedPeak: 400 }).tier).toBe('red');
    expect(node({ confirmedCases: 3, participatedCases: 5, projects: 2, completedPeak: 400 }).tier).toBe('red');
    expect(node({ confirmedCases: 2, participatedCases: 9, projects: 9, completedPeak: 900 }).caps)
      .toEqual([{ kind: 'cases', tier: 'red', need: 3, have: 2 }]);
    expect(node({ confirmedCases: 3, participatedCases: 4, projects: 2, completedPeak: 900 }).caps)
      .toEqual([{ kind: 'breadth', tier: 'red', needProjects: 3, needParticipated: 5, projects: 2, participated: 4 }]);
    expect(node({ confirmedCases: 20, projects: 3, completedPeak: 200 }).caps)
      .toEqual([{ kind: 'completed', tier: 'red', need: 201, have: 200 }]);
    // Rejections only lower the effective count: 300 done − 100 rejected = 200 is not enough for red.
    expect(node({ confirmedCases: 20, projects: 3, completedPeak: 300, rejectedPeak: 100 }).tier).toBe('gold');
  });

  it('沒有退回率閘門:退回率高也不會因此降級', () => {
    expect(node({ confirmedCases: 20, projects: 3, completedPeak: 300, completedNow: 50, rejectedNow: 40 }).tier).toBe('red');
  });

  it('跳過的每一級都列出缺什麼', () => {
    expect(node({ completedPeak: 600 }).caps.map(({ tier }) => tier)).toEqual(['red', 'red', 'gold', 'gold', 'violet']);
  });

  it('說明文字', () => {
    expect(capText({ kind: 'involvement', tier: 'violet', need: 1, have: 0 })).toBe('紫晶需要至少 1 份承辦或參與的已確認判例(目前 0 份)');
    expect(capText({ kind: 'cases', tier: 'red', need: 3, have: 2 })).toBe('紅晶需要至少 3 份承辦的已確認判例(目前 2 份)');
    expect(capText({ kind: 'projects', tier: 'gold', need: 2, have: 1 })).toBe('金晶需要至少 2 個專案(目前 1 個)');
    expect(capText({ kind: 'breadth', tier: 'red', needProjects: 3, needParticipated: 5, projects: 2, participated: 4 }))
      .toBe('紅晶需要至少 3 個專案或 5 份參與的已確認判例(目前 2 個專案、4 份參與)');
    expect(capText({ kind: 'completed', tier: 'red', need: 201, have: 200 })).toBe('紅晶需要有效完成至少 201 件(目前 200 件)');
  });

  it('下一級要求:還差的分數與尚未滿足的條件;紅晶時沒有下一級', () => {
    // claudia jr (2026-11-24): gold at 328; red needs 3 own cases and 3 projects or 5 participations.
    const jr = node({ confirmedCases: 1, participatedCases: 1, projects: 2, completedPeak: 268 });
    expect(jr.tier).toBe('gold');
    expect(nextTierNeeds(jr)).toEqual({ tier: 'red', scoreGap: 0, caps: [
      { kind: 'cases', tier: 'red', need: 3, have: 1 },
      { kind: 'breadth', tier: 'red', needProjects: 3, needParticipated: 5, projects: 2, participated: 1 },
    ] });
    expect(nextTierNeeds(node({ completedPeak: 40 }))).toEqual({ tier: 'blue', scoreGap: 60, caps: [] });
    expect(nextTierNeeds(node({ completedPeak: 120 }))).toEqual({ tier: 'violet', scoreGap: 30,
      caps: [{ kind: 'involvement', tier: 'violet', need: 1, have: 0 }] });
    expect(nextTierNeeds(node({ confirmedCases: 20, projects: 3, completedPeak: 300 }))).toBeNull();
    expect(needText({ kind: 'projects', tier: 'gold', need: 2, have: 1 })).toBe('需要至少 2 個專案(目前 1 個)');
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
