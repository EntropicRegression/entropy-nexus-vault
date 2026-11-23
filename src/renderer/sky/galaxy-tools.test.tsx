// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GlowTier } from '../../shared/glow';
import type { CrystalList, GalaxyMap, MemoryEntry, NodeCrystalDetail } from '../../shared/types';
import { matchesTerms, searchTerms } from '../../shared/node-search';
import { manualClock } from '../test-support/manual-clock';
import { Sky } from './Sky';
import { flyTiming } from './galaxy-camera';
import { emptyGlowBrightness, glowFilterView, minimumLitBrightness } from './glow-filter';
import { rainbowEmptyText } from './RainbowShowcase';

type EnabledMap = Extract<GalaxyMap, { enabled: true }>;
const crystal = (nodeId: string, name: string, glow: GlowTier, status: '線上' | '休眠' | '封存' = '線上') =>
  ({ nodeId, name, role: null, status, canWake: false, projectNames: [], glow, position: [0, 0, 0] as [number, number, number] });
const key = (letter: string) => 'p_' + letter.repeat(24);
const A = key('a'), B = key('b'), C = key('c');
const data: CrystalList = {
  crystals: [
    crystal('a1', '金穗', 'gold'), crystal('a2', '金砂', 'gold'), crystal('a3', '金線', 'gold'), crystal('a4', '白霧', 'white'),
    crystal('b1', '金鈴', 'gold'), crystal('b2', '藍鯨', 'blue'),
    crystal('c1', '虹橋', 'rainbow'), crystal('c2', '青苔', 'green'),
    crystal('boss', '總管', 'gold'), crystal('lost', '流星', 'white'),
  ],
  links: [],
};
function galaxyMap(): EnabledMap {
  const member = (group: string | null, place: 'galaxy' | 'hub' | 'outer') => ({ group, place, rule: 'recent-tasks' }) as EnabledMap['membership'][string];
  return {
    enabled: true,
    groups: [
      { key: A, name: '阿爾法', kind: 'galaxy', projectType: 'git', promoted: false, members: ['a1', 'a2', 'a3', 'a4'], position: [-100, 0] },
      { key: B, name: '貝塔', kind: 'galaxy', projectType: 'git', promoted: false, members: ['b1', 'b2'], position: [100, 0] },
      { key: C, name: '伽瑪', kind: 'galaxy', projectType: 'git', promoted: false, members: ['c1', 'c2'], position: [0, 100] },
    ],
    hub: ['boss'], outer: ['lost'],
    membership: {
      a1: member(A, 'galaxy'), a2: member(A, 'galaxy'), a3: member(A, 'galaxy'), a4: member(A, 'galaxy'),
      b1: member(B, 'galaxy'), b2: member(B, 'galaxy'), c1: member(C, 'galaxy'), c2: member(C, 'galaxy'),
      boss: member(null, 'hub'), lost: member(null, 'outer'),
    },
    bridges: [],
  };
}
const chapter = (title: string, status: string, day: number) => ({
  path: 'memoirs/金穗-a1/' + title + '.md', title, nodeId: 'a1', nodeIds: ['a1'], kind: 'memoir', shelf: 'archive',
  subtype: '', status, summary: '', updatedAt: Date.UTC(2026, 10, day),
  memoir: { coverage: { start: Date.UTC(2026, 10, day), end: null }, coverageText: '' },
}) as MemoryEntry;
const detail = (id: string): NodeCrystalDetail => ({
  ...data.crystals.find((node) => node.nodeId === id)!, profile: null, stats: null, archives: [], relatedEntries: [],
  memoirEntries: id === 'a1' ? [chapter('採樣間隔', '已確認', 20), chapter('報表格式', '未確認', 21), chapter('完成交接', '退回', 22)] : [],
  confirmedCaseCount: 0, specialty: '', workflow: '', review: '', notRejectedRate: null, consoleAppendixCount: 0,
});

describe('星系亮度(顏色篩選,純函式)', () => {
  it('依「擁有該顏色的節點數」決定亮度:最多者 1、0 個幾乎全暗,其餘線性落在 0.4–1;彩虹不算在一般顏色', () => {
    const view = glowFilterView(galaxyMap(), data.crystals, 'gold');
    expect(view.groups.get(A)).toEqual({ count: 3, brightness: 1 });
    expect(view.groups.get(B)!.count).toBe(1);
    expect(view.groups.get(B)!.brightness).toBeCloseTo(minimumLitBrightness + (1 - minimumLitBrightness) / 3);
    expect(view.groups.get(C)).toEqual({ count: 0, brightness: emptyGlowBrightness });
    expect([...view.nodes].sort()).toEqual(['a1', 'a2', 'a3', 'b1', 'boss']);
    expect(view.total).toBe(5);
    const none = glowFilterView(galaxyMap(), data.crystals, 'red');
    expect([...none.groups.values()].every((group) => group.brightness === emptyGlowBrightness)).toBe(true);
    // The rainbow node keeps its rainbow; it is not counted under green or any other colour.
    expect(glowFilterView(galaxyMap(), data.crystals, 'green').groups.get(C)!.count).toBe(1);
  });

  it('搜尋比對與樓下共用:空白分詞、全部字詞都要出現、全形半形與大小寫不分', () => {
    expect(searchTerms('  金  穗 ')).toEqual(['金', '穗']);
    expect(matchesTerms('金穗', searchTerms('穗 金'))).toBe(true);
    expect(matchesTerms('Claude 分支', searchTerms('ＣＬＡＵＤＥ'))).toBe(true);
    expect(matchesTerms('金穗', searchTerms('金 藍'))).toBe(false);
    expect(matchesTerms('金穗', [])).toBe(false);
  });
});

describe('星系總覽:顏色篩選、彩虹展示、節點搜尋、典藏回憶(M5j)', () => {
  let host: HTMLDivElement;
  let root: Root;
  let manual: ReturnType<typeof manualClock>;
  let vault: Record<string, ReturnType<typeof vi.fn>>;
  let opened: MemoryEntry[];

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    manual = manualClock();
    opened = [];
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1544);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(792);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    vault = {
      listCrystals: vi.fn(async () => data),
      readCrystal: vi.fn(async (id: string) => detail(id)),
      listGalaxies: vi.fn(async () => galaxyMap()),
    };
    vi.stubGlobal('vault', vault);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function render(crystals = data) {
    vault.listCrystals.mockResolvedValue(crystals);
    await act(async () => root.render(<Sky active reducedMotion={false} vaultExists refreshToken={0} clock={manual.clock}
      onReturn={() => {}} onOpenEntry={(item) => opened.push(item)} />));
  }
  const q = <T extends Element = HTMLElement>(selector: string) => host.querySelector<T>(selector);
  const group = (k: string) => q(`[data-group="${k}"]`)!.parentElement as HTMLElement;
  async function fly() { await act(async () => manual.tick(manual.now() + flyTiming.duration)); }

  it('顏色篩選:單選切換、再按取消;亮度依數量、0 個幾乎全暗;沒有該色的總管與外環變暗;按鈕與星系都有文字提示', async () => {
    await render();
    const gold = q<HTMLButtonElement>('[data-glow-filter="gold"]')!;
    expect(gold.textContent).toBe('金5');
    expect(gold.getAttribute('aria-label')).toBe('篩選金晶,共 5 個節點');
    expect(host.querySelectorAll('[data-glow-filters] button, [role="group"] [data-glow-filter]')).toHaveLength(6);
    await act(async () => gold.click());
    expect(gold.getAttribute('aria-pressed')).toBe('true');
    expect(q('[data-galaxy-overview]')!.dataset.glowFilter).toBe('gold');
    expect(group(A).style.opacity).toBe('1');
    expect(Number(group(B).style.opacity)).toBeCloseTo(0.6);
    expect(group(C).style.opacity).toBe(String(emptyGlowBrightness));
    expect(group(A).querySelector('[data-glow-count]')!.textContent).toBe('金晶 × 3');
    expect(group(C).querySelector('[data-glow-count]')!.textContent).toBe('金晶 × 0');
    expect(q('[data-galaxy-hub]')!.hasAttribute('data-dimmed')).toBe(false);
    expect(q('[data-dust="lost"]')!.hasAttribute('data-dimmed')).toBe(true);
    expect(q('[data-galaxy-announcement]')!.textContent).toBe('篩選金晶:共 5 個節點,分布在 2 個星系或共用資料夾');
    const white = q<HTMLButtonElement>('[data-glow-filter="white"]')!;
    await act(async () => white.click());
    expect(gold.getAttribute('aria-pressed')).toBe('false');
    expect(q('[data-dust="lost"]')!.hasAttribute('data-dimmed')).toBe(false);
    expect(q('[data-galaxy-hub]')!.hasAttribute('data-dimmed')).toBe(true);
    await act(async () => white.click());
    expect(q('[data-galaxy-overview]')!.dataset.glowFilter).toBeUndefined();
    expect(group(A).style.opacity).toBe('');
    expect(group(A).querySelector('[data-glow-count]')).toBeNull();
  });

  it('彩虹專屬畫面:開啟、焦點、稜鏡彩虹水晶、Esc 關閉並還焦點;點節點飛入其星系並開履歷', async () => {
    await render();
    const open = q<HTMLButtonElement>('[data-rainbow-open]')!;
    expect(open.getAttribute('aria-label')).toBe('開啟彩虹節點展示,共 1 個');
    open.focus();
    await act(async () => open.click());
    const showcase = q('[data-rainbow-showcase]')!;
    expect(showcase.querySelector('[role="dialog"]')!.getAttribute('aria-label')).toBe('彩虹節點展示');
    const node = showcase.querySelector<HTMLButtonElement>('[data-rainbow-node="c1"]')!;
    expect(document.activeElement).toBe(node);
    expect(node.querySelector<HTMLElement>('[data-prism]')!.dataset.glow).toBe('rainbow');
    expect(showcase.querySelectorAll('[data-rainbow-node]')).toHaveLength(1);
    expect(q('[data-galaxy-overview]')!.hasAttribute('inert')).toBe(true);
    await act(async () => { node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    await act(async () => {});
    expect(q('[data-rainbow-showcase]')).toBeNull();
    expect(document.activeElement).toBe(open);
    expect(q('[data-galaxy-interior]')!.dataset.galaxyInterior).toBe('');
    await act(async () => open.click());
    await act(async () => q<HTMLButtonElement>('[data-rainbow-node="c1"]')!.click());
    expect(q('[data-rainbow-showcase]')).toBeNull();
    await fly();
    expect(q('[data-galaxy-interior]')!.dataset.galaxyInterior).toBe(C);
    expect(q('[data-galaxy-interior] [data-crystal="c1"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(vault.readCrystal).toHaveBeenLastCalledWith('c1');
  });

  it('彩虹專屬畫面:沒有彩虹節點時顯示安靜的空狀態', async () => {
    await render({ ...data, crystals: data.crystals.map((node) => ({ ...node, glow: node.glow === 'rainbow' ? 'violet' as const : node.glow })) });
    await act(async () => q<HTMLButtonElement>('[data-rainbow-open]')!.click());
    expect(q('[data-rainbow-empty]')!.textContent).toBe(rainbowEmptyText);
    expect(document.activeElement).toBe(q('[data-rainbow-close]'));
    await act(async () => q<HTMLButtonElement>('[data-rainbow-close]')!.click());
    expect(q('[data-rainbow-showcase]')).toBeNull();
  });

  it('節點搜尋:即時比對名稱、標出所在星系/總管/外環;方向鍵移動;Esc 清空;選取後飛入星系並開履歷', async () => {
    await render();
    const input = q<HTMLInputElement>('[data-galaxy-finder] input')!;
    const type = async (value: string) => act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await type('金');
    const results = () => [...host.querySelectorAll<HTMLButtonElement>('[data-finder-result]')];
    // Same-length names in Traditional Chinese collation order (strokes): 砂 9, 鈴 13, 線 15, 穗 17.
    expect(results().map((item) => item.textContent)).toEqual(['金砂星系 · 阿爾法', '金鈴星系 · 貝塔', '金線星系 · 阿爾法', '金穗星系 · 阿爾法']);
    await type('總管');
    expect(results()[0].textContent).toBe('總管總管中樞');
    await type('流星');
    expect(results()[0].textContent).toBe('流星外環星塵帶');
    await type('不存在');
    expect(q('[data-galaxy-finder]')!.textContent).toContain('沒有名稱相符的節點。');
    await type('金鈴');
    input.focus();
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });
    expect(document.activeElement).toBe(results()[0]);
    await act(async () => { results()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })); });
    expect(document.activeElement).toBe(input);
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(input.value).toBe('');
    expect(results()).toHaveLength(0);
    await type('鈴');
    await act(async () => results()[0].click());
    expect(input.value).toBe('');
    await fly();
    expect(q('[data-galaxy-interior]')!.dataset.galaxyInterior).toBe(B);
    expect(q('[data-galaxy-interior] [data-crystal="b1"]')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('搜尋外環節點:不飛入,直接在總覽開啟履歷', async () => {
    await render();
    const input = q<HTMLInputElement>('[data-galaxy-finder] input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '流星');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => q<HTMLButtonElement>('[data-finder-result="lost"]')!.click());
    expect(q('[data-galaxy-interior]')!.dataset.galaxyInterior).toBe('');
    expect(vault.readCrystal).toHaveBeenLastCalledWith('lost');
    expect(q('[data-dust="lost"]')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('履歷欄「典藏回憶」列回憶錄、狀態與開卷按鈕，無資料時顯示空狀態', async () => {
    await render();
    const input = q<HTMLInputElement>('[data-galaxy-finder] input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '金穗');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => q<HTMLButtonElement>('[data-finder-result="a1"]')!.click());
    await fly();
    const section = q('[data-memoir-entries]')!;
    const items = [...section.querySelectorAll<HTMLButtonElement>('[data-memoir-entry]')];
    expect(items.map((item) => item.querySelector('[data-memoir-status]')?.textContent)).toEqual([undefined, '待核閱', '已退回']);
    expect(items[0].textContent).toBe('回憶錄 · 2026-11-20 · 採樣間隔前往典藏書架 →');
    expect(items[1].textContent).toContain('回憶錄 · 2026-11-21 · 報表格式');
    expect(section.textContent).not.toMatch(/撰寫|參與/);
    await act(async () => items[1].click());
    expect(opened.map((item) => item.path)).toEqual(['memoirs/金穗-a1/報表格式.md']);
    expect(section.innerHTML).not.toMatch(/memoirs\/|\b[a-z]:[\\/]/i);

    await act(async () => q<HTMLButtonElement>('[aria-label="收起節點履歷"]')!.click());
    await act(async () => q<HTMLButtonElement>('[data-galaxy-interior] [data-crystal="a4"]')!.click());
    expect(q('[data-memoir-empty]')!.textContent).toBe('這個節點還沒有寫回憶錄。');
  });
});
