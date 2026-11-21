// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeRichness } from '../../shared/glow';
import type { GlowTier } from '../../shared/glow';
import type { AwardWriteResult, CrystalList, NodeCrystalDetail } from '../../shared/types';
import { manualClock } from '../test-support/manual-clock';
import { Sky } from './Sky';
import skyCss from './Sky.module.css?raw';

const tiers: GlowTier[] = ['white', 'green', 'blue', 'violet', 'gold', 'red', 'rainbow'];
const version = { mtime: 1700000000000, size: 120 };

function crystals(): CrystalList {
  return {
    crystals: tiers.map((glow, index) => ({
      nodeId: 'n-' + glow, name: '晶' + index, role: null, status: '線上' as const, canWake: false, projectNames: [],
      glow, position: [index * 40 - 120, 0, index * 10] as [number, number, number],
    })),
    links: [],
    awards: { version, corrupt: false },
  };
}

const capped = computeRichness({ confirmedCases: 0, participatedCases: 3, completedPeak: 200, rejectedPeak: 0,
  completedNow: 40, rejectedNow: 2, projects: 6, projectScope: 'git' });

function detailFor(nodeId: string, award: NodeCrystalDetail['award'] = null): NodeCrystalDetail {
  const node = crystals().crystals.find((item) => item.nodeId === nodeId)!;
  return {
    ...node, profile: null, stats: null, archives: [], relatedEntries: [], confirmedCaseCount: 0,
    specialty: '', workflow: '', review: '', notRejectedRate: null, consoleAppendixCount: 0,
    richness: capped, award, glow: award ? 'rainbow' : node.glow,
  };
}

describe('經歷等級光暈與彩虹頒發(介面)', () => {
  let host: HTMLDivElement;
  let root: Root;
  let manual: ReturnType<typeof manualClock>;
  let listCrystals: ReturnType<typeof vi.fn>;
  let readCrystal: ReturnType<typeof vi.fn>;
  let setAward: ReturnType<typeof vi.fn<(...args: unknown[]) => Promise<AwardWriteResult>>>;
  let awarded: NodeCrystalDetail['award'];

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    manual = manualClock();
    awarded = null;
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(940);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(670);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    listCrystals = vi.fn(async () => crystals());
    readCrystal = vi.fn(async (id: string) => detailFor(id, id === 'n-violet' ? awarded : null));
    setAward = vi.fn(async (_id: unknown, award: unknown) => {
      awarded = award ? { awardedAt: '2026-11-22T10:00:00.000Z', reason: (award as { reason: string }).reason } : null;
      return { ok: true as const, ...version, award: awarded, masked: 0 };
    });
    vi.stubGlobal('vault', { listCrystals, readCrystal, setAward });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function render(reduced = false) {
    await act(async () => root.render(<Sky active reducedMotion={reduced} vaultExists refreshToken={0} clock={manual.clock}
      onReturn={() => {}} />));
  }
  const crystal = (id: string) => host.querySelector<HTMLButtonElement>('[data-crystal="' + id + '"]')!;
  async function open(id: string) { await act(async () => crystal(id).click()); }
  const actionButton = () => host.querySelector<HTMLButtonElement>('[data-award-action]')!;
  const dialog = () => host.querySelector<HTMLElement>('[data-award-dialog]');
  const dialogButton = (text: string) => [...dialog()!.querySelectorAll('button')].find((button) => button.textContent === text)!;

  it('七級光暈各自掛在水晶上', async () => {
    await render();
    for (const tier of tiers) expect(crystal('n-' + tier).dataset.glow).toBe(tier);
  });

  it('履歷欄徽記顯示等級名;說明列出各項得分與封頂原因', async () => {
    await render();
    await open('n-blue');
    const badge = host.querySelector<HTMLElement>('[data-glow-badge]')!;
    expect(badge.dataset.glow).toBe('blue');
    expect(badge.textContent).toMatch(/^藍晶/);
    expect(badge.tabIndex).toBe(0);
    const tip = host.querySelector<HTMLElement>('#' + CSS.escape(badge.getAttribute('aria-describedby')!))!;
    expect(tip.getAttribute('role')).toBe('tooltip');
    const lines = [...tip.children].map((line) => line.textContent);
    expect(lines).toEqual([
      '經歷分數 47 分',
      '承辦的已確認判例 0 份 × 10 = 0',
      '參與的已確認判例 3 份 → +3(上限 10)',
      '跨專案 6 個(只算 git 專案) → +24(最多計 6 個)',
      '有效完成 200 件(完成峰值 200 − 退回峰值 0)→ +20(每 10 件 1 分,上限 20)',
      '退回率 5%(目前 5%=2/40、峰值 0%=0/200,取較高者)',
      '退回數含失敗或中斷任務上的退回,退回率可能偏高',
      '沒有自己承辦的已確認判例,最高只能到藍晶',
    ]);
  });

  it('頒發流程:確認視窗 → 理由(≤80 字)→ 寫入成功才改為虹晶 → 撤回', async () => {
    await render();
    await open('n-violet');
    expect(actionButton().textContent).toBe('頒發彩虹光暈');
    await act(async () => actionButton().click());
    expect(dialog()?.getAttribute('role')).toBe('dialog');
    expect(dialog()?.getAttribute('aria-modal')).toBe('true');
    const input = dialog()!.querySelector<HTMLInputElement>('input')!;
    expect(document.activeElement).toBe(input);
    expect(input.maxLength).toBe(80);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '主導記憶庫安全設計');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(dialog()!.textContent).toContain('還可輸入 71 字');
    expect(crystal('n-violet').dataset.glow).toBe('violet');
    const lists = listCrystals.mock.calls.length;
    await act(async () => dialogButton('頒發').click());
    expect(setAward).toHaveBeenCalledWith('n-violet', { reason: '主導記憶庫安全設計' }, version);
    expect(dialog()).toBeNull();
    expect(listCrystals.mock.calls.length).toBe(lists + 1);
    const badge = host.querySelector<HTMLElement>('[data-glow-badge]')!;
    expect(badge.textContent).toMatch(/^虹晶 · 手動頒發/);
    expect(host.querySelector('[data-award-meta]')!.textContent).toBe('頒發於 2026-11-22理由:主導記憶庫安全設計');
    expect(actionButton().textContent).toBe('撤回彩虹光暈');
    expect(document.activeElement).toBe(actionButton());

    await act(async () => actionButton().click());
    expect(dialog()!.textContent).toContain('撤回〈晶3〉的彩虹光暈?等級將回到自動計算的結果。');
    await act(async () => dialogButton('撤回').click());
    expect(setAward).toHaveBeenLastCalledWith('n-violet', null, version);
    expect(actionButton().textContent).toBe('頒發彩虹光暈');
  });

  it('B5:頒發後在清單重讀之前立刻撤回、再頒發,都帶上一次寫入回傳的版本,不誤報衝突', async () => {
    let version = 1;
    setAward.mockImplementation(async (_id: unknown, award: unknown) => {
      awarded = award ? { awardedAt: '2026-11-22T10:00:00.000Z', reason: '' } : null;
      return { ok: true as const, mtime: 1700000000000 + ++version, size: 100 + version, award: awarded, masked: 0 };
    });
    await render();
    await open('n-violet');
    // From now on the crystal list never comes back, so only the write's own result can update the version.
    listCrystals.mockImplementation(() => new Promise(() => {}));
    await act(async () => actionButton().click());
    await act(async () => dialogButton('頒發').click());
    expect(setAward).toHaveBeenLastCalledWith('n-violet', { reason: '' }, { mtime: 1700000000000, size: 120 });
    await act(async () => actionButton().click());
    await act(async () => dialogButton('撤回').click());
    expect(setAward).toHaveBeenLastCalledWith('n-violet', null, { mtime: 1700000000002, size: 102 });
    await act(async () => actionButton().click());
    await act(async () => dialogButton('頒發').click());
    expect(setAward).toHaveBeenLastCalledWith('n-violet', { reason: '' }, { mtime: 1700000000003, size: 103 });
    expect(dialog()).toBeNull();
  });

  it('頒發視窗提示金鑰會被遮罩', async () => {
    await render();
    await open('n-violet');
    await act(async () => actionButton().click());
    expect(dialog()!.textContent).toContain('看起來像金鑰、權杖或密碼的內容會自動遮罩為「[已遮罩]」。');
  });

  it('寫入失敗留在視窗:衝突顯示未儲存與重新載入;取消或 Esc 關閉', async () => {
    setAward.mockResolvedValueOnce({ ok: false, reason: 'conflict', current: { mtime: 1, size: 2 } });
    await render();
    await open('n-violet');
    await act(async () => actionButton().click());
    await act(async () => dialogButton('頒發').click());
    expect(dialog()!.querySelector('[role="alert"]')!.textContent).toMatch(/^未儲存 · 頒發紀錄剛被其他程式修改/);
    const lists = listCrystals.mock.calls.length;
    await act(async () => dialogButton('重新載入').click());
    expect(listCrystals.mock.calls.length).toBe(lists + 1);
    expect(dialog()!.querySelector('[role="alert"]')).toBeNull();
    setAward.mockResolvedValueOnce({ ok: false, reason: 'io' });
    await act(async () => dialogButton('頒發').click());
    expect(dialogButton('重試')).toBeTruthy();
    await act(async () => { dialog()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(dialog()).toBeNull();
    // Escape closed only the dialog, not the detail panel.
    expect(crystal('n-violet').getAttribute('aria-pressed')).toBe('true');
  });

  it('頒發檔損毀:提示視為沒有頒發,按鈕停用', async () => {
    listCrystals.mockImplementation(async () => ({ ...crystals(), awards: { version, corrupt: true } }));
    await render();
    await open('n-gold');
    expect(actionButton().disabled).toBe(true);
    expect(host.textContent).toContain('頒發檔已損毀,目前視為沒有頒發');
  });

  it('低動態:場景標記 quiet,彩虹水晶的旋轉規則在 quiet 與系統減少動態時停用', async () => {
    await render(true);
    expect(host.querySelector<HTMLElement>('[data-sky]')!.dataset.quiet).toBe('true');
    expect(crystal('n-rainbow').dataset.glow).toBe('rainbow');
    const css = skyCss;
    // The oval aura itself never rotates; only its inner conic layer does (M5c review, visual item).
    expect(css).toContain(".skyScene .crystal[data-glow='rainbow'] .crystalAura { background: none; overflow: hidden; }");
    expect(css).toMatch(/\.crystalAura::before \{[^}]*animation: rainbowSpin 10s linear infinite;/);
    expect(css).not.toMatch(/\.crystalAura \{[^}]*animation: rainbowSpin/);
    expect(css).toContain(".skyScene[data-quiet='true'] .crystal[data-glow='rainbow'] .crystalAura::before { animation: none; }");
    expect(css).toContain("@media (prefers-reduced-motion: reduce) { .skyScene .crystal[data-glow='rainbow'] .crystalAura::before { animation: none; } }");
  });
});
