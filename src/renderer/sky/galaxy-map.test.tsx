// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CrystalList, GalaxyMap, NodeCrystalDetail } from '../../shared/types';
import { manualClock } from '../test-support/manual-clock';
import { Sky } from './Sky';
import { resetGalaxyCamera } from './GalaxyView';
import { cameraMoveMs, fitZoom, worldLayout } from './galaxy-world';
import galaxyCss from './Galaxy.module.css?raw';

type EnabledMap = Extract<GalaxyMap, { enabled: true }>;
const crystal = (nodeId: string, name: string) =>
  ({ nodeId, name, role: null, status: '線上' as const, canWake: false, projectNames: [], glow: 'white' as const, position: [0, 0, 0] as [number, number, number] });
const groupKey = (index: number) => 'p_' + String(index).padStart(24, '0');
/** 12 projects in a 4 × 3 grid around the hub plus 6 belt nodes: wider than one window at zoom 1. */
const map: EnabledMap = {
  enabled: true,
  groups: Array.from({ length: 12 }, (_, index) => ({
    key: groupKey(index), name: '專案' + index, kind: 'galaxy' as const, projectType: 'git', promoted: false, members: ['m' + index],
    position: [((index % 4) - 1.5) * 200, (Math.floor(index / 4) - 1) * 200] as [number, number],
  })),
  hub: ['boss'], outer: ['o1', 'o2', 'o3', 'o4', 'o5', 'o6'],
  membership: Object.fromEntries(Array.from({ length: 12 }, (_, index) => ['m' + index, { group: groupKey(index), place: 'galaxy' as const, rule: 'recent-tasks' as const }])),
  bridges: [],
};
const data: CrystalList = {
  crystals: [...Array.from({ length: 12 }, (_, index) => crystal('m' + index, '成員' + index)), crystal('boss', '總管'),
    ...['o1', 'o2', 'o3', 'o4', 'o5', 'o6'].map((id) => crystal(id, '外環' + id))],
  links: [],
};
const detail = (id: string): NodeCrystalDetail => ({
  ...data.crystals.find((node) => node.nodeId === id)!, profile: null, stats: null, archives: [], relatedEntries: [],
  confirmedCaseCount: 0, specialty: '', workflow: '', review: '', notRejectedRate: null, consoleAppendixCount: 0,
});
const stage = { width: 1544, height: 792 };

describe('星圖總覽地圖化(DESIGN.md §6.10.2)', () => {
  let host: HTMLDivElement;
  let root: Root;
  let manual: ReturnType<typeof manualClock>;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    manual = manualClock();
    resetGalaxyCamera();
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(stage.width);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(stage.height);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    vi.stubGlobal('vault', {
      listCrystals: vi.fn(async () => data), readCrystal: vi.fn(async (id: string) => detail(id)),
      listGalaxies: vi.fn(async () => map), setGalaxyPromotion: vi.fn(), arrangeGalaxies: vi.fn(async () => map),
    });
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetGalaxyCamera();
  });

  async function render(reduced = false) {
    await act(async () => root.render(<Sky active reducedMotion={reduced} vaultExists refreshToken={0} clock={manual.clock} onReturn={() => {}} />));
  }
  const q = <T extends Element = HTMLElement>(selector: string) => host.querySelector<T>(selector);
  const overview = () => q('[data-galaxy-overview]')!;
  const world = () => q('[data-galaxy-world]')!;
  const readout = () => Number(q('[data-zoom-readout]')!.textContent!.replace('%', ''));
  /** Lets the 150ms settle timer run so React catches up with the live camera. */
  const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 200)); });
  const keyDown = async (name: string, init: KeyboardEventInit = {}, target: Element = overview()) => {
    await act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, ...init })); });
  };
  const moveDone = () => act(async () => manual.tick(manual.now() + cameraMoveMs + 1));
  const exactFit = fitZoom(worldLayout(map).bounds, stage);
  const fit = Math.round(exactFit * 100);

  it('開場是全覽:世界層一個 transform,倍率小字與 fitZoom 相同,全部看得到所以沒有小地圖', async () => {
    await render();
    expect(world().style.transform).toMatch(/^translate\(772px, 396px\) scale\([\d.]+\) translate\(/);
    expect(readout()).toBe(fit);
    expect(q('[data-minimap]')).toBeNull();
    expect(overview().dataset.detail).toBe(fit >= 80 ? 'full' : fit >= 55 ? 'mid' : 'far');
  });

  it('+ 放大、出現小地圖;0 回到全覽(350ms)並播報;小地圖隱藏', async () => {
    await render();
    await keyDown('+'); await keyDown('+'); await keyDown('+');
    await settle();
    expect(readout()).toBe(Math.round(exactFit * 1.2 ** 3 * 100));
    expect(q('[data-minimap]')).not.toBeNull();
    expect(q('[data-minimap-view]')).not.toBeNull();
    await keyDown('0');
    expect(q('[data-galaxy-announcement]')!.textContent).toBe('已移到〈全覽〉');
    await moveDone();
    await settle();
    expect(readout()).toBe(fit);
    expect(q('[data-minimap]')).toBeNull();
    // The animated move uses the measured stage, not the 0 × 0 size of the first render.
    expect(world().style.transform).toMatch(/^translate\(772px, 396px\)/);
  });

  it('方向鍵平移 80px(Shift 240px);Home 對準總管中樞並播報', async () => {
    await render();
    await keyDown('+'); await keyDown('+'); await keyDown('+'); await keyDown('+');
    const before = world().style.transform;
    await keyDown('ArrowRight');
    expect(world().style.transform).not.toBe(before);
    const x = (transform: string) => parseFloat(transform.slice(transform.lastIndexOf('translate(') + 10));
    const zoom = Number(/scale\(([\d.]+)\)/.exec(world().style.transform)![1]);
    expect(x(world().style.transform) - x(before)).toBeCloseTo(-80 / zoom, 0);
    await keyDown('ArrowLeft', { shiftKey: true });
    expect(x(world().style.transform) - x(before)).toBeCloseTo(160 / zoom, 0);
    await keyDown('Home');
    await moveDone();
    expect(x(world().style.transform)).toBeCloseTo(0, 0);
    expect(q('[data-galaxy-announcement]')!.textContent).toBe('已移到〈總管中樞〉');
  });

  it('滾輪以游標為中心縮放;搜尋框上的滾輪不攔截', async () => {
    await render();
    const wheel = new WheelEvent('wheel', { deltaY: -200, bubbles: true, cancelable: true });
    await act(async () => { overview().dispatchEvent(wheel); });
    expect(wheel.defaultPrevented).toBe(true);
    await settle();
    expect(readout()).toBeGreaterThan(fit);
    const input = q('[data-galaxy-finder] input')!;
    const ignored = new WheelEvent('wheel', { deltaY: -200, bubbles: true, cancelable: true });
    await act(async () => { input.dispatchEvent(ignored); });
    expect(ignored.defaultPrevented).toBe(false);
  });

  it('在空白處拖曳超過 4px 才平移,放開後那一下不算點擊;按在星系上不會拖曳', async () => {
    await render();
    await keyDown('+'); await keyDown('+');
    const press = (type: string, x: number, target: Element = overview()) =>
      act(async () => { target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: 100, button: 0, buttons: type === 'pointerup' ? 0 : 1 })); });
    const before = world().style.transform;
    await press('pointerdown', 100); await press('pointermove', 102);
    expect(world().style.transform).toBe(before);
    await press('pointermove', 150);
    expect(world().style.transform).not.toBe(before);
    await press('pointerup', 150);
    const group = q<HTMLButtonElement>('[data-group="' + key0 + '"]')!;
    await act(async () => group.click());
    expect(q('[data-galaxy-view]')!.dataset.moving).toBe('false');
    await act(async () => group.click());
    expect(q('[data-galaxy-view]')!.dataset.moving).toBe('true');
  });

  it('焦點落到畫面外的星系時,鏡頭平移讓它進入視野', async () => {
    await render();
    for (let i = 0; i < 5; i++) await keyDown('+');
    await settle();
    const before = world().style.transform;
    const far = q<HTMLButtonElement>('[data-group="' + groupKey(11) + '"]')!;
    await act(async () => { far.focus(); });
    await moveDone();
    expect(world().style.transform).not.toBe(before);
  });

  it('低動態:回到全覽直接到位,不需要時間', async () => {
    await render(true);
    await keyDown('+'); await keyDown('+'); await keyDown('+');
    await keyDown('0');
    await settle();
    expect(readout()).toBe(fit);
  });

  it('鏡頭在本次開啟期間記住(重新掛載仍是同一視野)', async () => {
    await render();
    await keyDown('+'); await keyDown('+');
    await settle();
    const zoom = readout();
    act(() => root.unmount());
    root = createRoot(host);
    await render();
    expect(readout()).toBe(zoom);
  });

  it('顏色篩選時才有「看亮著的星系」;減量規則寫在樣式裡', async () => {
    await render();
    expect(q('[data-fit-lit]')).toBeNull();
    await act(async () => q<HTMLButtonElement>('[data-glow-filter="white"]')!.click());
    expect(q('[data-fit-lit]')).not.toBeNull();
    const css = galaxyCss.replace(/\r\n/g, '\n');
    expect(css).toContain(".overview[data-detail='far'] .speck");
    expect(css).toContain(".dust[data-label='hidden']");
    expect(css).toContain('font-size: max(12px, calc(11px / var(--zoom)))');
    expect(css).not.toMatch(/blur\(/);
  });
});


describe('M6c 審查修正', () => {
  let host: HTMLDivElement;
  let root: Root;
  let manual: ReturnType<typeof manualClock>;
  let listGalaxies: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    manual = manualClock();
    resetGalaxyCamera();
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(stage.width);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(stage.height);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    listGalaxies = vi.fn(async () => ({ ...map }));
    vi.stubGlobal('vault', {
      listCrystals: vi.fn(async () => data), readCrystal: vi.fn(async (id: string) => detail(id)),
      listGalaxies, setGalaxyPromotion: vi.fn(), arrangeGalaxies: vi.fn(async () => map),
    });
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); resetGalaxyCamera(); });
  const q = <T extends Element = HTMLElement>(selector: string) => host.querySelector<T>(selector);
  const render = (refreshToken = 0) => act(async () => root.render(<Sky active reducedMotion={false} vaultExists refreshToken={refreshToken}
    clock={manual.clock} onReturn={() => {}} />));
  const keyDown = (name: string) => act(async () => { q('[data-galaxy-overview]')!.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true })); });
  const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 200)); });

  it('先平移再飛入時地圖重新整理:飛入照樣開始,不會卡住', async () => {
    await render();
    for (let i = 0; i < 5; i++) await keyDown('+');
    await settle();
    await act(async () => q<HTMLButtonElement>('[data-group="' + groupKey(11) + '"]')!.click());
    expect(q('[data-galaxy-view]')!.dataset.moving).toBe('true');
    // The map is fetched again mid-pan (a new object, same content), as App does on window focus.
    await render(1);
    await act(async () => manual.tick(manual.now() + 2000));
    await act(async () => manual.tick(manual.now() + 2000));
    expect(q('[data-galaxy-view]')!.dataset.moving).toBe('false');
    expect(q('[data-galaxy-interior]')!.dataset.galaxyInterior).toBe(groupKey(11));
  });

  it('記住的鏡頭只屬於同一張地圖;只是全覽時不記', async () => {
    await render();
    await keyDown('+'); await keyDown('+');
    await settle();
    const zoomed = q('[data-zoom-readout]')!.textContent;
    act(() => root.unmount());
    root = createRoot(host);
    listGalaxies.mockResolvedValue({ ...map, groups: map.groups.slice(0, 6) });
    await render();
    expect(q('[data-zoom-readout]')!.textContent).not.toBe(zoomed);
  });

  it('取消的拖曳不吞掉下一次點擊', async () => {
    await render();
    await keyDown('+'); await keyDown('+');
    const fire = (type: string, x: number) => act(async () => {
      q('[data-galaxy-overview]')!.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: 100, button: 0, buttons: 1 }));
    });
    await fire('pointerdown', 100); await fire('pointermove', 160); await fire('pointercancel', 160);
    await act(async () => q<HTMLButtonElement>('[data-group="' + key0 + '"]')!.click());
    expect(q('[data-galaxy-view]')!.dataset.moving).toBe('true');
  });
});

const key0 = groupKey(0);
