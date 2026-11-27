// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CrystalList, GalaxyMap, NodeCrystalDetail } from '../../shared/types';
import { manualClock } from '../test-support/manual-clock';
import { Sky } from './Sky';
import { arrangeText, interiorMaxZoom } from './GalaxyView';
import { flyTiming } from './galaxy-camera';
import galaxyCss from './Galaxy.module.css?raw';

type EnabledMap = Extract<GalaxyMap, { enabled: true }>;
const crystal = (nodeId: string, name: string, status: '線上' | '休眠' | '封存' = '線上', projectNames: string[] = []) =>
  ({ nodeId, name, role: null, status, canWake: false, projectNames, glow: 'white' as const, position: [0, 0, 0] as [number, number, number] });
const data: CrystalList = {
  crystals: [
    crystal('a1', '甲一', '線上', ['阿爾法', '貝塔']), crystal('a2', '甲二', '休眠'), crystal('b1', '乙一'),
    crystal('f1', '雲一'), crystal('boss', '總管'), crystal('lost', '流星'),
  ],
  links: [
    { kind: 'lineage', from: 'b1', to: 'a2' }, { kind: 'delegate', from: 'a1', to: 'b1', count: 2, lastAt: '' },
    { kind: 'project', nodeIds: ['a1', 'a2'], projectKey: 'p_' + 'a'.repeat(24), projectName: '阿爾法' },
    { kind: 'project', nodeIds: ['a1', 'b1'], projectKey: 'p_' + 'b'.repeat(24), projectName: '貝塔' },
    { kind: 'project', nodeIds: ['a1', 'a2'], projectKey: 'p_' + 'c'.repeat(24), projectName: '伽瑪' },
  ],
};
const key = (letter: string) => 'p_' + letter.repeat(24);
const A = key('a'), B = key('b'), F = key('f');
function galaxyMap(patch: Partial<EnabledMap> = {}): EnabledMap {
  return {
    enabled: true,
    groups: [
      { key: A, name: '阿爾法', kind: 'galaxy', projectType: 'git', promoted: false, members: ['a1', 'a2'], position: [-100, 0] },
      { key: B, name: '貝塔', kind: 'galaxy', projectType: 'git', promoted: false, members: ['b1'], position: [100, 0] },
      { key: F, name: '共用', kind: 'nebula', projectType: '資料夾', promoted: false, members: ['f1'], position: [0, 100] },
    ],
    hub: ['boss'], outer: ['lost'],
    membership: {
      a1: { group: A, place: 'galaxy', rule: 'recent-tasks' }, a2: { group: A, place: 'galaxy', rule: 'recent-tasks' },
      b1: { group: B, place: 'galaxy', rule: 'recent-tasks' }, f1: { group: F, place: 'nebula', rule: 'recent-tasks' },
      boss: { group: null, place: 'hub', rule: 'chief' }, lost: { group: null, place: 'outer', rule: 'none' },
    },
    bridges: [{ a: A, b: B, delegations: 4, meetings: 1, dual: 0, count: 5, weight: 2 }],
    ...patch,
  };
}
const detail = (id: string): NodeCrystalDetail => ({
  ...data.crystals.find((node) => node.nodeId === id)!, profile: null, stats: null, archives: [], relatedEntries: [],
  confirmedCaseCount: 0, specialty: '', workflow: '', review: '', notRejectedRate: null, consoleAppendixCount: 0,
});

describe('專案星系畫面(M5e-b)', () => {
  let host: HTMLDivElement;
  let root: Root;
  let manual: ReturnType<typeof manualClock>;
  let vault: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    manual = manualClock();
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1544);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(792);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    vault = {
      listCrystals: vi.fn(async () => data),
      readCrystal: vi.fn(async (id: string) => detail(id)),
      listGalaxies: vi.fn(async () => galaxyMap()),
      setGalaxyPromotion: vi.fn(async (k: string, promoted: boolean) => galaxyMap({
        groups: galaxyMap().groups.map((group) => group.key === k ? { ...group, kind: promoted ? 'galaxy' : 'nebula', promoted } : group),
      })),
      arrangeGalaxies: vi.fn(async () => galaxyMap({ groups: galaxyMap().groups.map((group) => ({ ...group, position: [group.position[1], group.position[0]] as [number, number] })) })),
    };
    vi.stubGlobal('vault', vault);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function render(options: { reduced?: boolean; request?: { nodeId: string; requestId: number } } = {}) {
    await act(async () => root.render(<Sky active reducedMotion={options.reduced ?? false} vaultExists refreshToken={0}
      clock={manual.clock} selectionRequest={options.request} onReturn={() => {}} />));
  }
  const q = <T extends Element = HTMLElement>(selector: string) => host.querySelector<T>(selector);
  const button = (text: string) => [...host.querySelectorAll('[data-galaxy-dialog] button')].find((item) => item.textContent === text) as HTMLButtonElement;
  async function fly(start = manual.now()) {
    await act(async () => manual.tick(start + flyTiming.duration));
  }

  it('沒有專案表(enabled:false)或沒有星系 API:平面星圖完全照舊', async () => {
    vault.listGalaxies.mockResolvedValue({ enabled: false });
    await render();
    expect(q('[data-star-map]')).not.toBeNull();
    expect(q('[data-galaxy-view]')).toBeNull();
    expect(host.querySelectorAll('[data-crystal]')).toHaveLength(data.crystals.length);
    act(() => root.unmount());
    root = createRoot(host);
    delete (vault as Record<string, unknown>).listGalaxies;
    await render();
    expect(q('[data-star-map]')).not.toBeNull();
    expect(q('[data-galaxy-view]')).toBeNull();
  });

  it('總覽:星系、小星雲、中樞、外環、星橋(線寬依階、端點在外環);畫面沒有路徑或專案ID', async () => {
    await render();
    expect(q('[data-star-map]')).toBeNull();
    expect(q('[data-group="' + A + '"]')!.getAttribute('aria-label')).toBe('專案星系 阿爾法,2 節點(2 活躍 / 0 封存),按下飛入');
    expect(q('[data-group="' + F + '"]')!.dataset.kind).toBe('nebula');
    expect(q('[data-galaxy-hub]')!.textContent).toContain('總管中樞 · 總管');
    expect(q('[data-dust="lost"]')!.textContent).toBe('流星');
    const bridge = q('[data-bridge]')!;
    expect(bridge.dataset.weight).toBe('2');
    expect(bridge.querySelector('path')!.getAttribute('stroke-width')).toBe('3');
    expect(bridge.querySelectorAll('circle')).toHaveLength(2);
    // World coordinates (hub = origin, §6.10.2): centres at ∓260; rings 165 × 0.44 = 72.6 and 150 × 0.44 = 66.
    expect(bridge.querySelector('path')!.getAttribute('d')).toBe('M -187.4 0 Q 3.3 53.4 194 0');
    expect(host.textContent).not.toMatch(/[a-z]:[\\/]|p_[a-f0-9]{24}/i);
  });

  it('飛入:550ms、其他層淡出、內部只有該星系水晶、焦點到返回鈕;Esc 飛回並把焦點還給星系', async () => {
    await render();
    await act(async () => q<HTMLButtonElement>('[data-group="' + A + '"]')!.click());
    expect(q('[data-galaxy-announcement]')!.textContent).toBe('進入〈阿爾法〉星系');
    expect(q('[data-galaxy-view]')!.dataset.moving).toBe('true');
    const start = manual.now();
    await act(async () => manual.tick(start + flyTiming.duration / 2));
    expect(Number(q('[data-galaxy-interior]')!.style.opacity)).toBeCloseTo(0.875);
    expect(q('[data-galaxy-overview]')!.style.transform).toBe('scale(1.525)');
    await fly(start);
    expect(q('[data-galaxy-view]')!.dataset.moving).toBe('false');
    expect(q('[data-galaxy-overview]')!.hasAttribute('inert')).toBe(true);
    expect(q('[data-galaxy-overview]')!.style.visibility).toBe('hidden');
    expect([...host.querySelectorAll<HTMLElement>('[data-crystal]')].map((item) => item.dataset.crystal).sort()).toEqual(['a1', 'a2']);
    expect(document.activeElement).toBe(q('[data-galaxy-back]'));
    // Dormant crystals are dimmed inside a galaxy (CSS rule scoped to the interior).
    expect(q('[data-crystal="a2"]')!.dataset.status).toBe('休眠');
    expect(galaxyCss).toContain(".interior [data-crystal][data-status='休眠'] > :not([data-crystal-label]) { opacity: 0.55;");
    // The nameplate is not faded with the crystal, so its text stays ≥ 4.5:1 (M5f).
    expect(galaxyCss).toContain(".interior [data-crystal][data-status='休眠'] [data-crystal-label] strong { color: var(--text-night-muted); }");

    await act(async () => { q('[data-sky]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(q('[data-galaxy-announcement]')!.textContent).toBe('返回星系總覽');
    await fly();
    expect(q('[data-galaxy-interior]')!.dataset.galaxyInterior).toBe('');
    expect(document.activeElement).toBe(q('[data-group="' + A + '"]'));
  });

  it('S1:星系內部不畫這個星系自己的同專案連線,其他共同專案照畫;S2:內部可放大(上限 1.6)', async () => {
    const strokes: string[] = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      if (this.hasAttribute('data-star-field')) return null;
      return {
        setTransform() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, setLineDash() {}, strokeText() {},
        fillText: (text: string) => strokes.push(text), measureText: (text: string) => ({ width: 7 * text.length }),
        arc() {}, fill() {}, globalAlpha: 1, strokeStyle: '', fillStyle: '', font: '', textAlign: '', lineWidth: 0, lineJoin: '',
      } as unknown as CanvasRenderingContext2D;
    });
    await render();
    await act(async () => q<HTMLButtonElement>('[data-group="' + A + '"]')!.click());
    await fly();
    await act(async () => manual.tick(manual.now() + 20));
    expect(strokes).toContain('伽瑪');
    expect(strokes).not.toContain('阿爾法');
    expect(interiorMaxZoom).toBe(1.6);
  });

  it('S3:整理動畫進行中卸載,計時器被清掉', async () => {
    const clear = vi.spyOn(window, 'clearTimeout');
    await render();
    await act(async () => q<HTMLButtonElement>('[data-arrange]')!.click());
    await act(async () => button('整理').click());
    expect(q('[data-galaxy-view]')!.dataset.arranging).toBe('true');
    const calls = clear.mock.calls.length;
    act(() => root.unmount());
    expect(clear.mock.calls.length).toBeGreaterThan(calls);
    root = createRoot(host);
  });

  it('S6:整理一次確實換成新位置,有 650ms 的移動;確認前位置不動', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await render();
    const transform = (k: string) => q('[data-group="' + k + '"]')!.parentElement!.style.transform;
    const before = [A, B, F].map(transform);
    await act(async () => q<HTMLButtonElement>('[data-arrange]')!.click());
    expect([A, B, F].map(transform)).toEqual(before);
    await act(async () => button('整理').click());
    const after = [A, B, F].map(transform);
    expect(after).not.toEqual(before);
    expect(after[0]).not.toBe(before[0]);
    expect(q('[data-galaxy-view]')!.dataset.arranging).toBe('true');
    await act(async () => { vi.advanceTimersByTime(649); });
    expect(q('[data-galaxy-view]')!.dataset.arranging).toBe('true');
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(q('[data-galaxy-view]')!.dataset.arranging).toBe('false');
    vi.useRealTimers();
  });

  it('S7:讀取失敗時保留上一份並說明;沒有上一份才退回平面星圖', async () => {
    await render();
    vault.listGalaxies.mockRejectedValueOnce(new Error('locked'));
    await act(async () => root.render(<Sky active reducedMotion={false} vaultExists refreshToken={1} clock={manual.clock} onReturn={() => {}} />));
    expect(q('[data-galaxy-view]')).not.toBeNull();
    expect(q('[data-galaxy-error]')!.textContent).toBe('星系資料暫時讀不到,先顯示上次的內容。');
    await act(async () => root.render(<Sky active reducedMotion={false} vaultExists refreshToken={2} clock={manual.clock} onReturn={() => {}} />));
    expect(q('[data-galaxy-error]')).toBeNull();

    act(() => root.unmount());
    root = createRoot(host);
    vault.listGalaxies.mockRejectedValueOnce(new Error('locked'));
    await render();
    expect(q('[data-galaxy-view]')).toBeNull();
    expect(q('[data-star-map]')).not.toBeNull();
    expect(q('[data-galaxy-error]')!.textContent).toBe('無法讀取專案星系,暫時顯示平面星圖。');
  });

  it('連點:飛行中按返回直接落到總覽,不留排程', async () => {
    await render();
    await act(async () => q<HTMLButtonElement>('[data-group="' + A + '"]')!.click());
    const start = manual.now();
    await act(async () => manual.tick(start + 100));
    await act(async () => q<HTMLButtonElement>('[data-galaxy-back]')!.click());
    expect(q('[data-galaxy-overview]')!.style.opacity).toBe('1');
    expect(q('[data-galaxy-interior]')!.style.visibility).toBe('hidden');
    expect(q('[data-galaxy-view]')!.dataset.moving).toBe('false');
    // Later frames (the star field keeps ticking on the same clock) do not move the layers again.
    await act(async () => manual.tick(start + 2000));
    expect(q('[data-galaxy-overview]')!.style.opacity).toBe('1');
    expect(q('[data-galaxy-interior]')!.dataset.galaxyInterior).toBe('');
  });

  it('出口:合作出口飛往另一星系;傳承出口飛過去並選中那顆水晶', async () => {
    await render();
    await act(async () => q<HTMLButtonElement>('[data-group="' + A + '"]')!.click());
    await fly();
    const exits = [...host.querySelectorAll<HTMLButtonElement>('[data-exit]')].map((item) => item.textContent);
    expect(exits).toEqual(['→ 貝塔(5)', '傳承自 → 貝塔 的〈乙一〉']);
    await act(async () => host.querySelector<HTMLButtonElement>('[data-exit="lineage"]')!.click());
    await fly();
    expect(q('[data-galaxy-interior]')!.dataset.galaxyInterior).toBe(B);
    expect(q('[data-crystal="b1"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(q('[data-crystal="b1"]'));
  });

  it('跳轉:先飛進節點所屬星系再選中;飛行中使用者點了別的就不覆蓋', async () => {
    await render({ request: { nodeId: 'a2', requestId: 1 } });
    expect(q('[data-galaxy-view]')!.dataset.moving).toBe('true');
    expect(q('[data-crystal="a2"]')!.getAttribute('aria-pressed')).toBe('false');
    await fly();
    expect(q('[data-crystal="a2"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(q('[data-crystal="a2"]'));

    await act(async () => q<HTMLButtonElement>('[data-galaxy-back]')!.click());
    await fly();
    // a2 is still selected from the first jump; jump to it again and click a1 while flying.
    await render({ request: { nodeId: 'a2', requestId: 2 } });
    const start = manual.now();
    await act(async () => manual.tick(start + 200));
    await act(async () => q<HTMLButtonElement>('[data-crystal="a1"]')!.click());
    await fly(start);
    expect(q('[data-crystal="a1"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(q('[data-crystal="a2"]')!.getAttribute('aria-pressed')).toBe('false');
  });

  it('外環與總管:點了開履歷;懸停總管才出現指揮線並調暗星橋;星橋懸停顯示次數', async () => {
    await render();
    await act(async () => q<HTMLButtonElement>('[data-dust="lost"]')!.click());
    expect(q('[aria-label="節點履歷"]')!.getAttribute('aria-hidden')).toBe('false');
    expect(host.querySelectorAll('[data-command]')).toHaveLength(0);
    await act(async () => { q('[data-galaxy-hub]')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
    expect(host.querySelectorAll('[data-command]')).toHaveLength(2);
    expect(q('svg[data-chief-hover]')!.getAttribute('data-chief-hover')).toBe('true');
    const hit = q('[data-bridge]')!.querySelectorAll('path')[1];
    await act(async () => { hit.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 100, clientY: 100 })); });
    expect(q('[role="tooltip"]')!.textContent).toBe('跨專案協作 5 次');
  });

  it('履歷欄列出同時參與的其他專案', async () => {
    await render({ request: { nodeId: 'a1', requestId: 3 } });
    await fly();
    expect(q('[data-also-in]')!.textContent).toBe('同時參與的專案貝塔、伽瑪');
  });

  it('退役(§6.10.3):手動標為退役、移到外圍;它的星橋只在懸停或聚焦時出現;可以移回', async () => {
    vault.setGalaxyRetired = vi.fn(async (k: string, retired: boolean) => galaxyMap({
      groups: galaxyMap().groups.map((group) => group.key === k ? { ...group, retired } : group),
    }));
    await render();
    expect(q('[data-bridge]')).not.toBeNull();
    await act(async () => q<HTMLButtonElement>('[data-retire="' + B + '"]')!.click());
    expect(vault.setGalaxyRetired).toHaveBeenCalledWith(B, true);
    const group = q('[data-group="' + B + '"]')!;
    expect(group.parentElement!.hasAttribute('data-retired')).toBe(true);
    expect(group.getAttribute('aria-label')).toContain(',已退役');
    expect(q('[data-retire="' + B + '"]')!.textContent).toBe('移回星圖');
    expect(q('[data-bridge]')).toBeNull();
    await act(async () => group.focus());
    expect(q('[data-bridge]')).not.toBeNull();
    await act(async () => group.blur());
    expect(q('[data-bridge]')).toBeNull();
    expect(q('[data-galaxy-toast]')!.textContent).toContain('已將「貝塔」標為退役');
    await act(async () => q<HTMLButtonElement>('[data-galaxy-toast] button')!.click());
    expect(vault.setGalaxyRetired).toHaveBeenLastCalledWith(B, false);
    expect(q('[data-group="' + B + '"]')!.parentElement!.hasAttribute('data-retired')).toBe(false);
    expect(q('[data-bridge]')).not.toBeNull();
  });

  it('拖動總覽時不會選取文字(使用者 2026-11-28 回報藍色選取框)', () => {
    expect(galaxyCss).toContain('.overview { cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none; }');
  });

  it('退役:沒有退役 API 時不顯示按鈕', async () => {
    await render();
    expect(q('[data-retire]')).toBeNull();
  });

  it('升格:確認視窗 → 寫入 → 提示條含撤銷;寫入失敗顯示未儲存與重試', async () => {
    await render();
    await act(async () => q<HTMLButtonElement>('[data-promote="' + F + '"]')!.click());
    expect(q('[data-galaxy-dialog]')!.textContent).toContain('升格後它會成為正式星系');
    expect(document.activeElement?.textContent).toBe('取消');
    await act(async () => button('升格').click());
    expect(vault.setGalaxyPromotion).toHaveBeenCalledWith(F, true);
    expect(q('[data-galaxy-dialog]')).toBeNull();
    expect(q('[data-group="' + F + '"]')!.dataset.kind).toBe('galaxy');
    expect(q('[data-galaxy-toast]')!.textContent).toContain('已將「共用」升格為正式星系。');
    await act(async () => q('[data-galaxy-toast]')!.querySelector('button')!.click());
    expect(vault.setGalaxyPromotion).toHaveBeenLastCalledWith(F, false);
    expect(q('[data-group="' + F + '"]')!.dataset.kind).toBe('nebula');

    vault.setGalaxyPromotion.mockResolvedValueOnce(galaxyMap());
    await act(async () => q<HTMLButtonElement>('[data-promote="' + F + '"]')!.click());
    await act(async () => button('升格').click());
    expect(q('[data-galaxy-dialog]')!.querySelector('[role="alert"]')!.textContent).toBe('未儲存 · 升格沒有寫入,請重試。');
    expect(button('重試')).toBeTruthy();
  });

  it('整理一次:確認文案照規範、按鈕「整理」「取消」;確認後才重排並平滑移動;低動態直接到位', async () => {
    await render();
    await act(async () => q<HTMLButtonElement>('[data-arrange]')!.click());
    expect(q('[data-arrange-text]')!.textContent).toBe(arrangeText);
    expect(arrangeText).toBe('依目前的合作程度重新排列所有星系。目前不在星圖上的專案(暫時沒有成員)位置會一併清除,之後它們再出現時會重新放置。');
    expect([...q('[data-galaxy-dialog]')!.querySelectorAll('button')].map((item) => item.textContent)).toEqual(['取消', '整理']);
    expect(vault.arrangeGalaxies).not.toHaveBeenCalled();
    await act(async () => button('取消').click());
    expect(vault.arrangeGalaxies).not.toHaveBeenCalled();
    await act(async () => q<HTMLButtonElement>('[data-arrange]')!.click());
    await act(async () => button('整理').click());
    expect(vault.arrangeGalaxies).toHaveBeenCalledOnce();
    expect(q('[data-galaxy-view]')!.dataset.arranging).toBe('true');

    act(() => root.unmount());
    root = createRoot(host);
    await render({ reduced: true });
    await act(async () => q<HTMLButtonElement>('[data-arrange]')!.click());
    await act(async () => button('整理').click());
    expect(q('[data-galaxy-view]')!.dataset.arranging).toBe('false');
  });
});
