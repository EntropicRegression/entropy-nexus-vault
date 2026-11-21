// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CrystalList, NodeCrystalDetail } from '../../shared/types';
import type { FrameClock } from './frame-clock';
import { Sky } from './Sky';

const data: CrystalList = {
  crystals: [
    { nodeId: 'iris', name: '稜鏡', role: '脈衝校準', status: '封存', canWake: true, projectNames: ['合成站'],
      portraitUrl: 'vault-image://node/iris/portrait', position: [-180, 90, 65] },
    { nodeId: 'quill', name: '銀筆', role: '索引整理', status: '線上', canWake: false, projectNames: [], position: [180, 115, 50] },
    { nodeId: 'flint', name: '燧石', role: null, status: '休眠', canWake: false, projectNames: [], position: [85, -65, -140] },
    { nodeId: 'dawn', name: '晨光', role: null, status: '封存', canWake: false, projectNames: [], position: [-15, -90, 160] },
  ],
  links: [
    { kind: 'lineage', from: 'iris', to: 'quill' },
    { kind: 'delegate', from: 'flint', to: 'dawn', count: 2, lastAt: '2026-11-22' },
    { kind: 'meeting', nodeIds: ['iris', 'quill', 'flint'], count: 3 },
    { kind: 'project', nodeIds: ['iris', 'quill'], projectName: '合成站' },
  ],
};

const detail: NodeCrystalDetail = {
  ...data.crystals[0],
  profile: null, archives: [{ path: 'nodes/封存/稜鏡.md', archivedAt: '2026-11-21 08:00' }],
  relatedEntries: [{ path: 'cases/合成站/2026-0001.md', caseId: '2026-0001', title: '對齊觀測時間', kind: 'case', shelf: 'case',
    summary: '', writable: false, scope: '專案', status: '已確認', subtype: '', projectName: '合成站', projectId: 'p_fixture',
    nodeId: 'iris', nodeLabel: '稜鏡', participantNodeIds: [], nodeIds: ['iris'], updatedAt: 0, mtime: 0, size: 0,
    heat: { level: 'ember', count: 0, lastRecalledAt: null }, previousCount: 0, superseded: false }],
  specialty: '核對合成脈衝。', workflow: '比對時間序列。', review: '對齊測試基準。', acceptanceRate: 0.75, consoleAppendixCount: 2,
  confirmedCaseCount: 1,
  stats: { tasks: 10, completed: 8, completionRate: 0.8, accepted: 6, rejected: 2, cases: 99 },
};

function manualClock() {
  let time = 0, next = 0;
  const tasks = new Map<number, () => void>();
  const clock: FrameClock = {
    now: () => time,
    schedule: (draw) => { tasks.set(++next, draw); return next; },
    cancel: (id) => { tasks.delete(id); },
  };
  return {
    clock, count: () => tasks.size,
    tick(ms: number) {
      time = ms;
      const frame = [...tasks.values()];
      tasks.clear();
      for (const draw of frame) draw();
    },
  };
}

function canvasStub() {
  const strokes: { alpha: number; color: string; width: number }[] = [];
  const ctx = {
    globalAlpha: 1, strokeStyle: '', fillStyle: '', font: '', textAlign: '', lineWidth: 0,
    setTransform: vi.fn(), clearRect: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), setLineDash: vi.fn(), fillText: vi.fn(), strokeText: vi.fn(),
    measureText: (text: string) => ({ width: 7 * text.length }),
    stroke: () => strokes.push({ alpha: ctx.globalAlpha, color: ctx.strokeStyle, width: ctx.lineWidth }),
  };
  return { ctx, strokes };
}

describe('星象召喚盤', () => {
  let host: HTMLDivElement;
  let root: Root;
  let manual: ReturnType<typeof manualClock>;
  let stars: ReturnType<typeof canvasStub>;
  let links: ReturnType<typeof canvasStub>;
  let readCrystal: ReturnType<typeof vi.fn>;
  const back = () => {};
  const motion = () => {};

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    manual = manualClock();
    stars = canvasStub();
    links = canvasStub();
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(940);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(670);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      return (this.hasAttribute('data-star-field') ? stars.ctx : links.ctx) as unknown as CanvasRenderingContext2D;
    });
    readCrystal = vi.fn(async (id: string) => id === 'iris' ? detail : { ...detail, ...data.crystals.find((node) => node.nodeId === id),
      stats: null, specialty: '', workflow: '', review: '', acceptanceRate: null, consoleAppendixCount: 0, archives: [],
      relatedEntries: [], confirmedCaseCount: 0 });
    vi.stubGlobal('vault', { listCrystals: async () => data, readCrystal });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  async function render(active = true, reduced = false, selectionRequest?: { nodeId: string; requestId: number }, refreshToken = 0) {
    await act(async () => root.render(<Sky active={active} reducedMotion={reduced} vaultExists refreshToken={refreshToken} selectionRequest={selectionRequest}
      clock={manual.clock} onReturn={back} onToggleMotion={motion} />));
  }

  const crystal = (id: string) => host.querySelector<HTMLButtonElement>('[data-crystal="' + id + '"]')!;
  const panel = () => host.querySelector<HTMLElement>('[aria-label="節點履歷"]')!;
  function pointer(target: HTMLElement, type: string, x: number, y = 80) {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
    Object.defineProperty(event, 'pointerId', { value: 4 });
    target.dispatchEvent(event);
  }

  it('手動推幀定位水晶與繪圖，過濾及選中只在需要時更新星圖', async () => {
    await render(true, true);
    expect(manual.count()).toBe(2);
    act(() => manual.tick(100));
    expect(stars.ctx.arc).toHaveBeenCalledTimes(130);
    expect(links.ctx.lineTo).toHaveBeenCalledTimes(6);
    expect(links.ctx.fillText).toHaveBeenCalledWith('接回自', expect.any(Number), expect.any(Number));
    const anchor = host.querySelector<HTMLElement>('[data-crystal-anchor="iris"]')!;
    expect(anchor.style.left).toMatch(/px$/);
    expect(anchor.style.visibility).toBe('visible');
    expect(host.querySelector<HTMLElement>('[data-armillary]')?.style.transform).toContain('rotateY(');
    expect(manual.count()).toBe(0);

    const filter = [...host.querySelectorAll('button')].find((button) => button.textContent.includes('會議同席'))!;
    act(() => filter.click());
    expect(filter.getAttribute('aria-pressed')).toBe('false');
    links.ctx.lineTo.mockClear();
    act(() => manual.tick(116));
    expect(links.ctx.lineTo).toHaveBeenCalledTimes(3);

    await act(async () => crystal('iris').click());
    links.strokes.length = 0;
    act(() => manual.tick(132));
    expect(links.strokes).toContainEqual({ alpha: 1, color: 'rgba(245,185,99,.85)', width: 3.3 });
    expect(links.strokes).toContainEqual({ alpha: 0.42, color: 'rgba(56,189,248,.65)', width: 1.8 });
  });

  it('呈現有依據的履歷資料與封存、立繪退路及狀態徽記，並可點選收起', async () => {
    await render(true, true);
    const avatar = crystal('iris').querySelector('img')!;
    expect(avatar.getAttribute('src')).toBe('vault-image://node/iris/portrait');
    expect(crystal('iris').dataset.archived).toBe('true');
    expect(crystal('quill').querySelector('img')?.dataset.portrait).toBe('constellation');
    expect(crystal('quill').textContent).toContain('● 現役');
    expect(crystal('flint').textContent).toContain('● 休眠');
    expect(crystal('dawn').textContent).toContain('◇ 封存 · 純紀念');
    expect(crystal('iris').textContent).toContain('✦ 封存 · 可喚醒');
    act(() => avatar.dispatchEvent(new Event('error')));
    expect(crystal('iris').querySelector('img')?.dataset.portrait).toBe('constellation');

    await act(async () => crystal('iris').click());
    expect(readCrystal).toHaveBeenCalledWith('iris');
    expect(panel().querySelector('[aria-label="任務完成率"]')?.getAttribute('aria-valuenow')).toBe('80');
    expect(panel().querySelector('[aria-label="一次驗收率"]')?.getAttribute('aria-valuenow')).toBe('75');
    expect(panel().textContent).toContain('核對合成脈衝。');
    expect(panel().textContent).toContain('比對時間序列。');
    expect(panel().textContent).toContain('對齊測試基準。');
    expect(panel().textContent).toContain('另有主控台補充 2 段');
    expect(panel().textContent).toContain('對齊觀測時間');
    expect(panel().textContent).toContain('2026-11-21 08:00');
    expect(panel().textContent).toContain('經手判例 1');
    expect(panel().textContent).not.toContain('經手判例 99');
    expect(panel().textContent).not.toMatch(/[a-z]:[\\/]|\/Users\/|\.{2}\\/i);
    await act(async () => crystal('iris').click());
    expect(panel().dataset.collapsed).toBe('true');
    await act(async () => crystal('dawn').click());
    expect(panel().textContent).toContain('僅留存濃縮水晶履歷');
    expect(panel().textContent).toContain('統計：無資料');
    expect(panel().textContent).not.toContain('累計完成任務 0');
  });

  it('拖曳超過 3px 不會選取，滾輪命令式調整畫面，點空白收起', async () => {
    await render(true, true);
    act(() => manual.tick(100));
    const stage = host.querySelector<HTMLElement>('[data-star-map]')!;
    const anchor = host.querySelector<HTMLElement>('[data-crystal-anchor="iris"]')!;
    const left = anchor.style.left;
    act(() => {
      pointer(crystal('iris'), 'pointerdown', 100);
      pointer(stage, 'pointermove', 130);
      pointer(stage, 'pointerup', 130);
      crystal('iris').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
      manual.tick(116);
    });
    expect(anchor.style.left).not.toBe(left);
    expect(crystal('iris').getAttribute('aria-pressed')).toBe('false');
    const second = anchor.style.left;
    act(() => {
      stage.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -180 }));
      manual.tick(132);
    });
    expect(anchor.style.left).not.toBe(second);
    await act(async () => {
      pointer(crystal('iris'), 'pointerdown', 100);
      pointer(crystal('iris'), 'pointermove', 103);
      pointer(crystal('iris'), 'pointerup', 103);
      crystal('iris').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    });
    expect(crystal('iris').getAttribute('aria-pressed')).toBe('true');
    act(() => stage.click());
    expect(panel().dataset.collapsed).toBe('true');
  });

  it('拖曳中的每一幀不再讀取版面尺寸；選取或尺寸改變時才重新量測', async () => {
    const offsetWidth = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(120);
    const clientWidth = vi.mocked(Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')!.get!);
    await render(true, true);
    act(() => manual.tick(100));
    const stage = host.querySelector<HTMLElement>('[data-star-map]')!;
    const anchor = host.querySelector<HTMLElement>('[data-crystal-anchor="iris"]')!;
    const reads = () => offsetWidth.mock.calls.length + clientWidth.mock.calls.length;
    const settled = reads();
    const positions: string[] = [];
    act(() => pointer(stage, 'pointerdown', 100));
    for (let frame = 1; frame <= 5; frame++) {
      act(() => {
        pointer(stage, 'pointermove', 100 + frame * 12);
        manual.tick(100 + frame * 16);
      });
      positions.push(anchor.style.left);
    }
    act(() => pointer(stage, 'pointerup', 160));
    expect(new Set(positions).size).toBe(5);
    expect(reads()).toBe(settled);

    await act(async () => crystal('quill').click());
    act(() => manual.tick(300));
    expect(reads()).toBeGreaterThan(settled);
    const afterSelect = reads();
    act(() => { window.dispatchEvent(new Event('resize')); manual.tick(320); });
    expect(reads()).toBeGreaterThan(afterSelect);
  });

  it('一般模式可連續推進星點，低動態只繪一幀，離開樓上取消所有排程', async () => {
    await render(true, false);
    act(() => manual.tick(10));
    expect(stars.ctx.arc).toHaveBeenCalledTimes(130);
    expect(manual.count()).toBe(1);
    act(() => manual.tick(50));
    expect(stars.ctx.arc).toHaveBeenCalledTimes(260);
    await render(true, true);
    expect(host.querySelector('[data-sky]')?.getAttribute('data-quiet')).toBe('true');
    act(() => manual.tick(70));
    expect(stars.ctx.arc).toHaveBeenCalledTimes(390);
    expect(manual.count()).toBe(0);
    await render(true, false);
    expect(manual.count()).toBe(1);
    await render(false, false);
    expect(manual.count()).toBe(0);
    act(() => manual.tick(100));
    expect(stars.ctx.arc).toHaveBeenCalledTimes(390);
  });

  it('系統減少動態的變更會切換星點的排程', async () => {
    const media = Object.assign(new EventTarget(), { matches: true });
    const matchMedia = vi.fn(() => media);
    vi.stubGlobal('matchMedia', matchMedia);
    await render();
    expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
    expect(host.querySelector('[data-sky]')?.getAttribute('data-quiet')).toBe('true');
    act(() => manual.tick(100));
    expect(manual.count()).toBe(0);

    act(() => {
      media.matches = false;
      media.dispatchEvent(new Event('change'));
    });
    expect(host.querySelector('[data-sky]')?.getAttribute('data-quiet')).toBe('false');
    act(() => manual.tick(110));
    expect(manual.count()).toBe(1);
  });

  it('舞台使用方向鍵、加減與 0 操作視角，卸載後不再攔截滾輪', async () => {
    await render(true, true);
    const stage = host.querySelector<HTMLElement>('[data-star-map]')!;
    const armillary = host.querySelector<HTMLElement>('[data-armillary]')!;
    act(() => manual.tick(100));
    const original = armillary.style.transform;
    function key(value: string) {
      act(() => {
        stage.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
        manual.tick(120);
      });
    }
    stage.focus();
    key('ArrowRight');
    expect(armillary.style.transform).not.toBe(original);
    key('+');
    expect(armillary.style.transform).toContain('scale(1.1)');
    key('-');
    expect(armillary.style.transform).toContain('scale(1)');
    key('0');
    expect(armillary.style.transform).toBe(original);
    const wheel = () => new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100 });
    const before = wheel();
    stage.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(true);
    act(() => root.render(null));
    const after = wheel();
    stage.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
    expect(manual.count()).toBe(0);
  });

  it('按收起或 Esc，焦點回到原水晶，已消耗的選取請求不會重播', async () => {
    const request = { nodeId: 'iris', requestId: 1 };
    await render(true, true, request);
    act(() => manual.tick(100));
    expect(crystal('iris').getAttribute('aria-pressed')).toBe('true');
    const close = () => panel().querySelector<HTMLButtonElement>('button[aria-label="收起節點履歷"]')!;
    close().focus();
    act(() => close().click());
    expect(document.activeElement).toBe(crystal('iris'));
    await render(true, true, { ...request }, 1);
    expect(panel().dataset.collapsed).toBe('true');
    await render(true, true, { nodeId: 'missing', requestId: 2 });
    expect(panel().dataset.collapsed).toBe('true');
    await render(true, true, { nodeId: 'quill', requestId: 3 });
    close().focus();
    act(() => close().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.activeElement).toBe(crystal('quill'));
    await render(true, true, { ...request });
    expect(panel().dataset.collapsed).toBe('true');
  });

  it('立繪失敗後更換節點，履歷欄會重新嘗試載入新立繪', async () => {
    const nextPortrait = 'vault-image://node/quill/portrait';
    readCrystal.mockImplementation(async (id: string) => id === 'iris' ? detail : {
      ...detail, ...data.crystals[1], portraitUrl: nextPortrait, acceptanceRate: null,
    });
    await render(true, true);
    await act(async () => crystal('iris').click());
    const portrait = () => panel().querySelector<HTMLImageElement>('img')!;
    act(() => portrait().dispatchEvent(new Event('error')));
    expect(portrait().dataset.portrait).toBe('constellation');
    await act(async () => crystal('quill').click());
    expect(portrait().src).toBe(nextPortrait);
    expect(panel().textContent).toContain('一次驗收率—');
    await act(async () => crystal('iris').click());
    expect(portrait().src).toBe('vault-image://node/iris/portrait');
  });

  it('拖曳至重疊位置時近者可點選，選中較遠的水晶後改為它置頂', async () => {
    vi.stubGlobal('vault', { listCrystals: async () => ({ crystals: [
      { ...data.crystals[0], position: [0, 0, 130] },
      { ...data.crystals[1], position: [0, 0, -130] },
    ], links: [] }), readCrystal });
    await render(true, true);
    const stage = host.querySelector<HTMLElement>('[data-star-map]')!;
    act(() => {
      pointer(stage, 'pointerdown', 200, 180);
      pointer(stage, 'pointermove', 164, 160);
      pointer(stage, 'pointerup', 164, 160);
      manual.tick(116);
    });
    // jsdom has no compositor. Use the rendered bounds/depth to dispatch at the overlap point.
    const topLayer = () => [crystal('iris'), crystal('quill')]
      .filter((button) => Math.abs(Number.parseFloat(button.parentElement!.style.left) - 470) < 35 &&
        Math.abs(Number.parseFloat(button.parentElement!.style.top) - 348.4) < 35)
      .sort((a, b) => Number(b.parentElement!.style.zIndex) - Number(a.parentElement!.style.zIndex))[0];
    expect(topLayer()).toBe(crystal('quill'));
    await act(async () => {
      pointer(stage, 'pointerdown', 470, 348);
      pointer(stage, 'pointerup', 470, 348);
      topLayer().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    });
    expect(crystal('quill').getAttribute('aria-pressed')).toBe('true');
    await act(async () => crystal('iris').click());
    act(() => manual.tick(132));
    expect(topLayer()).toBe(crystal('iris'));
  });
});
