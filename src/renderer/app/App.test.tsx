// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VaultApi } from '../../shared/ipc';
import type { CrystalList, MemoryEntry, MemoryEntryDetail, NodeCrystalDetail, NodeHit, VaultInfo, ViewSettings } from '../../shared/types';
import { manualClock } from '../test-support/manual-clock';
import { App } from './App';
import { resetBrandPortraits } from '../brand/brand-portrait';
import { floorTiming } from './floor-camera';

const vaultInfo: VaultInfo = { key: 'fixture-vault', path: 'fixtures/memory-vault', exists: true, wakeAvailable: false };
const baseEntry: MemoryEntry = {
  path: 'cases/試驗/2026-0001.md', title: '整理採樣記錄', summary: '採樣時間採用二十四小時制。', mtime: 100, size: 200, writable: true,
  kind: 'case', shelf: 'case', scope: '專案', subtype: '', status: '未確認', projectId: 'p', projectName: '溫室',
  nodeId: 'node-test', nodeLabel: '霧苔', participantNodeIds: [], nodeIds: ['node-test'],
  caseId: '2026-0001', updatedAt: Date.UTC(2026, 10, 22), superseded: false, previousCount: 1,
  heat: { level: 'tepid', count: 1, lastRecalledAt: null },
};
const archive: MemoryEntry = { ...baseEntry, path: 'preferences/排版.md', title: '直式頁碼', summary: '右下方排頁碼。',
  kind: 'preference', shelf: 'archive', scope: '全域', caseId: null, projectId: '', projectName: '', previousCount: 0 };
const bookmark: MemoryEntry = { ...baseEntry, path: 'knowledge/試驗/追蹤.md', title: '追蹤故障讀值', kind: 'knowledge',
  shelf: 'bookmark', subtype: '書籤', status: '未完', caseId: null, previousCount: 0 };
const previous: MemoryEntry = { ...baseEntry, path: 'cases/試驗/2025-0002.md', title: '舊採樣記錄',
  caseId: '2025-0002', superseded: true, previousCount: 0 };
const entries = [baseEntry, archive, bookmark, previous];
const crystal: CrystalList['crystals'][number] = {
  nodeId: 'node-test', name: '霧苔', role: null, status: '封存', canWake: false, projectNames: [], position: [20, 40, -180],
};

function detail(entry: MemoryEntry): MemoryEntryDetail {
  return {
    ...entry, attributes: [['2000', '先出現'], ['1900', '後出現']],
    body: '段落正文。', review: '回顧正文。',
    supersessionChain: entry.previousCount ? [{ path: previous.path, title: previous.title,
      updatedAt: previous.updatedAt, caseId: previous.caseId, status: 'available' }] : [],
    caseReferences: entry.path === baseEntry.path ? [previous.path] : [],
  };
}

const crystalDetail: NodeCrystalDetail = {
  ...crystal, profile: null, stats: null, archives: [], relatedEntries: [baseEntry], confirmedCaseCount: 0,
  specialty: '', workflow: '', review: '', notRejectedRate: null, consoleAppendixCount: 0,
};

function bridge(overrides: Partial<VaultApi> = {}, initial: Partial<ViewSettings> = {}): VaultApi {
  let settings: ViewSettings = { deskMode: 'A', reducedMotion: false, ...initial };
  return {
    getVaultInfo: vi.fn(async () => vaultInfo),
    chooseVault: vi.fn(async () => null),
    getSettings: vi.fn(async () => settings),
    setSettings: vi.fn(async (patch) => (settings = { ...settings, ...patch })),
    listEntries: vi.fn(async () => entries),
    search: vi.fn(async (term) => entries.filter(({ title }) => title.includes(term))),
    setAward: vi.fn<VaultApi['setAward']>(async () => ({ ok: false, reason: 'io' })),
    listGalaxies: vi.fn(async () => ({ enabled: false as const })),
    setGalaxyPromotion: vi.fn(async () => ({ enabled: false as const })),
    arrangeGalaxies: vi.fn(async () => ({ enabled: false as const })),
    readEntry: vi.fn(async (path) => {
      const entry = entries.find((item) => item.path === path);
      return entry ? detail(entry) : null;
    }),
    searchNodes: vi.fn(async (term) => term && crystal.name.includes(term)
      ? [{ nodeId: crystal.nodeId, name: crystal.name, role: null, status: crystal.status, matchedIn: '名稱' as const }] : []),
    listCrystals: vi.fn(async () => ({ crystals: [crystal], links: [] })),
    readCrystal: vi.fn(async () => null),
    setStatus: vi.fn<VaultApi['setStatus']>(async () => ({ ok: false, reason: 'io' })),
    saveEntry: vi.fn<VaultApi['saveEntry']>(async () => ({ ok: false, reason: 'io' })),
    moveToRecycle: vi.fn<VaultApi['moveToRecycle']>(async () => ({ ok: false, reason: 'io' })),
    restoreFromRecycle: vi.fn<VaultApi['restoreFromRecycle']>(async () => ({ ok: false, reason: 'io' })),
    readRecycledEntry: vi.fn(async () => null),
    wake: vi.fn(async () => ({ ok: false, nodeName: null, sessionId: null })),
    onVaultChanged: vi.fn(() => () => {}),
    ...overrides,
  };
}

describe('典藏室', () => {
  let container: HTMLDivElement;
  let root: Root;
  let manual: ReturnType<typeof manualClock>;

  beforeEach(() => {
    manual = manualClock();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    resetBrandPortraits();
  });

  async function renderApp(vault = bridge()) {
    vi.stubGlobal('vault', vault);
    await act(async () => { root.render(<App clock={manual.clock} />); });
    return vault;
  }

  function button(text: string, scope: ParentNode = container) {
    const item = [...scope.querySelectorAll('button')].find((item) => item.textContent.includes(text));
    if (!item) throw new Error('找不到按鈕 ' + text);
    return item;
  }

  function card(entry: MemoryEntry) {
    const element = [...container.querySelectorAll<HTMLElement>('[data-entry]')].find((item) => item.dataset.entry === entry.path);
    if (!element) throw new Error('找不到卷宗 ' + entry.path);
    return element;
  }

  function press(element: HTMLElement, key: string) {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  }

  function typeSearch(value: string) {
    const input = container.querySelector<HTMLInputElement>('input[type=search]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  const world = () => container.querySelector<HTMLElement>('[data-floor-world]')!;
  const shell = () => container.firstElementChild as HTMLElement;
  const layer = (name: '樓上星象召喚盤' | '樓下典藏室') => container.querySelector<HTMLElement>('section[aria-label="' + name + '"]')!;
  const announcement = () => container.querySelector('[data-floor-announcement]')!.textContent;
  const sealOf = (entry: MemoryEntry) => card(entry).querySelector<HTMLElement>('[aria-label="承辦：霧苔"]')!;

  /** Advances the camera to progress t of a transition that started at `start`. */
  async function frame(start: number, t: number) {
    await act(async () => manual.tick(start + t * floorTiming.duration));
  }

  async function travel() {
    const start = manual.now();
    await frame(start, 0);
    await frame(start, 1);
  }

  it('廠牌立繪:頂列開設定面板,讀取設定狀態,Esc 關閉並把焦點還給按鈕', async () => {
    const vault = await renderApp(bridge({
      getBrandPortraitSettings: vi.fn(async () => ({ configured: true as const, label: '自訂立繪資料夾' })),
      chooseBrandPortraitFolder: vi.fn(async () => null),
      clearBrandPortraitFolder: vi.fn(async () => ({ configured: false as const, label: null })),
    }));
    expect(vault.getBrandPortraitSettings).toHaveBeenCalledTimes(1);
    const open = container.querySelector<HTMLButtonElement>('[data-library-bar] [data-brand-open]')!;
    open.focus();
    await act(async () => open.click());
    const panel = container.querySelector('[data-brand-panel]')!;
    expect(panel.querySelector('[data-brand-status]')!.textContent).toBe('已設定:自訂立繪資料夾');
    await act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(container.querySelector('[data-brand-panel]')).toBeNull();
    expect(container.querySelector('[data-floor]')!.getAttribute('data-floor')).toBe('library');
    expect(document.activeElement).toBe(open);
    expect(container.querySelector('[data-sky-hud] [data-brand-open]')).not.toBeNull();
  });

  it('上下樓:鏡頭平移、Y 軸模糊、45% 換頂列、結束移除濾鏡並移焦點與播報', async () => {
    await renderApp();
    expect(container.querySelector('h1')?.textContent).toBe('記憶寶庫');
    expect(shell().dataset.topbar).toBe('library');
    expect(world().style.transform).toBe('translateY(-50%)');
    expect(layer('樓上星象召喚盤').dataset.shown).toBe('false');
    await act(async () => button('樓上｜星象召喚盤').click());
    expect(announcement()).toBe('前往樓上星象台');
    expect(button('樓上｜星象召喚盤').getAttribute('aria-pressed')).toBe('true');
    expect(shell().dataset.moving).toBe('true');
    expect(layer('樓上星象召喚盤').dataset.shown).toBe('true');
    expect(layer('樓下典藏室').dataset.shown).toBe('true');
    expect(layer('樓下典藏室').hasAttribute('inert')).toBe(true);
    const start = manual.now();
    await frame(start, 0);
    await frame(start, 0.25);
    expect(world().style.transform).toMatch(/^translateY\(-46\.875%\) rotateX\(1\.697deg\)$/);
    expect(world().style.filter).toContain('#verticalMotionBlur');
    expect(container.querySelector('feGaussianBlur')!.getAttribute('stdDeviation')).toBe('0 9.90');
    expect(shell().dataset.topbar).toBe('library');
    await frame(start, 0.45);
    expect(shell().dataset.topbar).toBe('sky');
    expect(container.querySelector('[data-library-bar]')!.hasAttribute('inert')).toBe(true);
    expect(container.querySelector('[data-sky-hud]')!.hasAttribute('inert')).toBe(false);
    await frame(start, 0.5);
    expect(container.querySelector('feGaussianBlur')!.getAttribute('stdDeviation')).toBe('0 14.00');
    await frame(start, 0.75);
    expect(world().style.transform).toContain('rotateX');
    await frame(start, 1);
    expect(world().style.transform).toBe('translateY(0%)');
    expect(world().style.filter).toBe('');
    expect(shell().dataset.moving).toBe('false');
    expect(layer('樓下典藏室').dataset.shown).toBe('false');
    expect(document.activeElement?.matches('button[data-kind]')).toBe(true);
    expect(manual.count()).toBe(0);

    await act(async () => button('俯瞰圖書館').click());
    expect(announcement()).toBe('回到樓下典藏室');
    await travel();
    expect(world().style.transform).toBe('translateY(-50%)');
    expect(shell().dataset.topbar).toBe('library');
    expect(document.activeElement?.closest('[aria-labelledby="draft-board"]')).not.toBeNull();
    expect(document.activeElement?.tagName).toBe('BUTTON');
  });

  it('連點:動畫中再按直接到終態,沒有半途的濾鏡、傾斜或頂列', async () => {
    await renderApp();
    await act(async () => button('樓上｜星象召喚盤').click());
    const start = manual.now();
    await frame(start, 0);
    await frame(start, 0.3);
    expect(world().style.filter).not.toBe('');
    await act(async () => button('樓下｜典藏室').click());
    expect(world().style.transform).toBe('translateY(-50%)');
    expect(world().style.filter).toBe('');
    expect(shell().dataset.topbar).toBe('library');
    expect(shell().dataset.moving).toBe('false');
    expect(layer('樓上星象召喚盤').dataset.shown).toBe('false');
    expect(manual.count()).toBe(0);
    for (let index = 0; index < 5; index++) await act(async () => button('樓上｜星象召喚盤').click());
    expect(world().style.transform).toBe('translateY(0%)');
    expect(world().style.filter).toBe('');
    expect(shell().dataset.topbar).toBe('sky');
    expect(manual.count()).toBe(0);
  });

  it('切換前先關閉閱讀桌;回到樓下時搜尋字仍在', async () => {
    vi.useFakeTimers();
    await renderApp();
    act(() => typeSearch('採樣'));
    await act(async () => vi.advanceTimersByTimeAsync(120));
    await act(async () => button('整理採樣記錄', card(baseEntry)).click());
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => button('樓上｜星象召喚盤').click());
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await travel();
    await act(async () => button('俯瞰圖書館').click());
    await travel();
    expect(container.querySelector<HTMLInputElement>('input[type=search]')!.value).toBe('採樣');
    expect(container.querySelectorAll('[data-entry]')).toHaveLength(1);
  });

  it('低動態:不平移不模糊不排程,改為 120ms 淡入', async () => {
    await renderApp(bridge({}, { reducedMotion: true }));
    await act(async () => button('樓上｜星象召喚盤').click());
    expect(manual.count()).toBe(0);
    expect(world().style.transform).toBe('translateY(0%)');
    expect(world().style.filter).toBe('');
    expect(shell().dataset.quietFade).toBe('a');
    expect(shell().dataset.topbar).toBe('sky');
    expect(announcement()).toBe('前往樓上星象台');
    expect(document.activeElement?.matches('button[data-kind]')).toBe(true);
    await act(async () => button('俯瞰圖書館').click());
    expect(shell().dataset.quietFade).toBe('b');
    expect(world().style.transform).toBe('translateY(-50%)');
  });

  it('系統減少動態也走淡換', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), addEventListener() {}, removeEventListener() {} }));
    await renderApp();
    await act(async () => button('樓上｜星象召喚盤').click());
    expect(manual.count()).toBe(0);
    expect(world().style.filter).toBe('');
    expect(shell().dataset.quietFade).toBe('a');
  });

  it('跳轉一:點頭像章,動畫結束後才選中水晶並開履歷', async () => {
    const vault = await renderApp(bridge({ readCrystal: vi.fn(async () => crystalDetail) }));
    expect(sealOf(baseEntry).textContent).toBe('霧');
    expect(sealOf(baseEntry).tabIndex).toBe(-1);
    await act(async () => sealOf(baseEntry).click());
    const start = manual.now();
    await frame(start, 0);
    await frame(start, 0.75);
    expect(vault.readCrystal).not.toHaveBeenCalled();
    await frame(start, 1);
    expect(container.querySelector('[data-crystal="node-test"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(vault.readCrystal).toHaveBeenCalledWith('node-test');
    expect(container.querySelector('[aria-label="節點履歷"]')?.getAttribute('aria-hidden')).toBe('false');
    // S1: focus follows the jump's target, not the first link toggle.
    expect(document.activeElement).toBe(container.querySelector('[data-crystal="node-test"]'));
  });

  it('跳轉一(鍵盤):閱讀紙的節點名稱連結也上樓選中', async () => {
    const vault = await renderApp(bridge({ readCrystal: vi.fn(async () => crystalDetail) }));
    await act(async () => button('整理採樣記錄', card(baseEntry)).click());
    const desk = container.querySelector<HTMLElement>('[role="dialog"]')!;
    await act(async () => button('霧苔', desk).click());
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await travel();
    expect(vault.readCrystal).toHaveBeenCalledWith('node-test');
    expect(container.querySelector('[data-crystal="node-test"]')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('跳轉二:搜尋出「相符的節點」小籤,最多 6 枚加 +N,點擊上樓選中;無相符時不顯示', async () => {
    vi.useFakeTimers();
    const many: NodeHit[] = Array.from({ length: 8 }, (_, index) => ({
      nodeId: index ? 'n' + index : 'node-test', name: index ? '霧' + index : '霧苔', role: null, status: '休眠', matchedIn: '名稱' }));
    const vault = await renderApp(bridge({ searchNodes: vi.fn(async (term: string) => term === '霧' ? many : []),
      readCrystal: vi.fn(async () => crystalDetail) }));
    expect(container.querySelector('[aria-label="相符的節點"]')).toBeNull();
    act(() => typeSearch('霧'));
    await act(async () => vi.advanceTimersByTimeAsync(120));
    expect(vault.searchNodes).toHaveBeenCalledWith('霧');
    const row = container.querySelector<HTMLElement>('[aria-label="相符的節點"]')!;
    expect(row.textContent).toContain('相符的節點（8）');
    expect(row.querySelectorAll('[data-node-hit]')).toHaveLength(6);
    expect(row.querySelector('[data-node-hit]')!.textContent).toBe('霧霧苔休眠');
    act(() => button('+2', row).click());
    expect(row.querySelectorAll('[data-node-hit]')).toHaveLength(8);
    await act(async () => row.querySelector<HTMLButtonElement>('[data-node-hit="node-test"]')!.click());
    await travel();
    expect(container.querySelector('[data-crystal="node-test"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(container.querySelector('[data-crystal="node-test"]'));
    await act(async () => button('俯瞰圖書館').click());
    await travel();
    act(() => typeSearch('沒有'));
    await act(async () => vi.advanceTimersByTimeAsync(120));
    expect(container.querySelector('[aria-label="相符的節點"]')).toBeNull();
  });

  it('跳轉三:履歷欄的關聯卷宗「前往圖書館 →」回到樓下並開啟該卷', async () => {
    const vault = await renderApp(bridge({ readCrystal: vi.fn(async () => crystalDetail) }));
    await act(async () => sealOf(baseEntry).click());
    await travel();
    const related = container.querySelector<HTMLButtonElement>('[data-related-entry]')!;
    expect(related.textContent).toBe('2026-0001 · 整理採樣記錄前往圖書館 →');
    await act(async () => related.click());
    expect(announcement()).toBe('回到樓下典藏室');
    const start = manual.now();
    await frame(start, 0);
    await frame(start, 0.75);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await frame(start, 1);
    expect(vault.readEntry).toHaveBeenCalledWith(baseEntry.path);
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain('整理採樣記錄');
    // S1: the reading desk's title receives focus.
    expect(document.activeElement?.tagName).toBe('H2');
    expect(document.activeElement?.textContent).toBe('整理採樣記錄');
    expect(document.activeElement?.closest('[role="dialog"]')).not.toBeNull();
  });

  it('S2:平移中使用者在樓上點了別的水晶,抵達時不被跳轉請求蓋掉,焦點也留在使用者點的水晶', async () => {
    const other = { ...crystal, nodeId: 'node-b', name: '銀杏', position: [-120, 30, 90] as [number, number, number] };
    const vault = await renderApp(bridge({ listCrystals: vi.fn(async () => ({ crystals: [crystal, other], links: [] })),
      readCrystal: vi.fn(async (id: string) => id === 'node-b' ? { ...crystalDetail, ...other } : crystalDetail) }));
    await act(async () => sealOf(baseEntry).click());
    const start = manual.now();
    await frame(start, 0);
    await frame(start, 0.5);
    const b = container.querySelector<HTMLButtonElement>('[data-crystal="node-b"]')!;
    await act(async () => { b.focus(); b.click(); });
    expect(b.getAttribute('aria-pressed')).toBe('true');
    await frame(start, 1);
    expect(b.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('[data-crystal="node-test"]')?.getAttribute('aria-pressed')).toBe('false');
    expect(document.activeElement).toBe(b);
    expect(vault.readCrystal).not.toHaveBeenCalledWith('node-test');
  });

  it('S2:平移中使用者在樓下開了別的卷宗,抵達時不被關聯卷宗請求蓋掉', async () => {
    await renderApp(bridge({ readCrystal: vi.fn(async () => crystalDetail) }));
    await act(async () => sealOf(baseEntry).click());
    await travel();
    await act(async () => container.querySelector<HTMLButtonElement>('[data-related-entry]')!.click());
    const start = manual.now();
    await frame(start, 0);
    await frame(start, 0.6);
    await act(async () => button('直式頁碼', card(archive)).click());
    await frame(start, 1);
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain('直式頁碼');
    expect(container.querySelector('[role="dialog"]')?.textContent).not.toContain('整理採樣記錄');
  });

  it('S5:快速連打只在停手 120ms 後查一次節點', async () => {
    vi.useFakeTimers();
    const vault = await renderApp();
    for (const value of ['霧', '霧苔', '霧苔一', '霧苔']) {
      act(() => typeSearch(value));
      await act(async () => vi.advanceTimersByTimeAsync(60));
    }
    expect(vault.searchNodes).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(120));
    expect(vault.searchNodes).toHaveBeenCalledTimes(1);
    expect(vault.searchNodes).toHaveBeenCalledWith('霧苔');
  });

  it('S3:跳轉目標已不存在時,顯示一行提示並停在抵達的樓層', async () => {
    const removed: NodeHit[] = [{ nodeId: 'gone', name: '已移除', role: null, status: '休眠', matchedIn: '名稱' }];
    vi.useFakeTimers();
    await renderApp(bridge({ searchNodes: vi.fn(async () => removed), readCrystal: vi.fn(async () => crystalDetail) }));
    act(() => typeSearch('已移除'));
    await act(async () => vi.advanceTimersByTimeAsync(120));
    await act(async () => container.querySelector<HTMLButtonElement>('[data-node-hit="gone"]')!.click());
    await travel();
    const notice = container.querySelector('[data-jump-notice]')!;
    expect(notice.getAttribute('role')).toBe('status');
    expect(notice.textContent).toBe('找不到該節點，可能已被移除。');
    expect(shell().dataset.floor).toBe('sky');
    expect(world().style.transform).toBe('translateY(0%)');
    expect(container.querySelector('[data-crystal][aria-pressed="true"]')).toBeNull();
    expect(document.activeElement?.matches('button[data-kind]')).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(6000));
    expect(notice.textContent).toBe('');
  });

  it('S3:關聯卷宗在跳轉途中被移除時,提示找不到卷宗、不開閱讀桌', async () => {
    const ghost = { ...baseEntry, path: 'cases/試驗/2026-0099.md', caseId: '2026-0099', title: '已回收的卷' };
    await renderApp(bridge({ readCrystal: vi.fn(async () => ({ ...crystalDetail, relatedEntries: [ghost] })) }));
    await act(async () => sealOf(baseEntry).click());
    await travel();
    await act(async () => container.querySelector<HTMLButtonElement>('[data-related-entry]')!.click());
    await travel();
    expect(shell().dataset.floor).toBe('library');
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('[data-jump-notice]')!.textContent).toBe('找不到該卷宗，可能已被移除。');
  });

  it('S1:目標水晶本來就是選取狀態時,再跳一次焦點仍落在水晶', async () => {
    await renderApp(bridge({ readCrystal: vi.fn(async () => crystalDetail) }));
    await act(async () => sealOf(baseEntry).click());
    await travel();
    await act(async () => button('俯瞰圖書館').click());
    await travel();
    expect(container.querySelector('[data-crystal="node-test"]')?.getAttribute('aria-pressed')).toBe('true');
    await act(async () => sealOf(baseEntry).click());
    await travel();
    expect(document.activeElement).toBe(container.querySelector('[data-crystal="node-test"]'));
  });

  it('低動態下的跳轉:請求仍在抵達後執行,焦點落在水晶', async () => {
    await renderApp(bridge({ readCrystal: vi.fn(async () => crystalDetail) }, { reducedMotion: true }));
    await act(async () => sealOf(baseEntry).click());
    expect(manual.count()).toBe(0);
    expect(container.querySelector('[data-crystal="node-test"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(container.querySelector('[data-crystal="node-test"]'));
  });

  it('跳上樓時水晶資料尚未載入:等資料到了才選取', async () => {
    let resolve!: (value: CrystalList) => void;
    const pending = new Promise<CrystalList>((done) => { resolve = done; });
    const listCrystals = vi.fn()
      .mockResolvedValueOnce({ crystals: [crystal], links: [] })
      .mockReturnValueOnce(pending)
      .mockResolvedValue({ crystals: [crystal], links: [] });
    await renderApp(bridge({ listCrystals, readCrystal: vi.fn(async () => crystalDetail) }));
    await act(async () => sealOf(baseEntry).click());
    await travel();
    expect(container.querySelector('[data-crystal="node-test"]')).toBeNull();
    await act(async () => resolve({ crystals: [crystal], links: [] }));
    expect(container.querySelector('[data-crystal="node-test"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(container.querySelector('[data-crystal="node-test"]'));
  });

  it('跳轉四:樓上底部天窗回到樓下;選取請求只消耗一次', async () => {
    await renderApp(bridge({ readCrystal: vi.fn(async () => crystalDetail) }));
    await act(async () => sealOf(baseEntry).click());
    await travel();
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="收起節點履歷"]')!.click());
    expect(container.querySelector('[data-crystal="node-test"]')?.getAttribute('aria-pressed')).toBe('false');
    await act(async () => button('向下俯視，回到大圖書館判例卷宗室').click());
    await travel();
    expect(world().style.transform).toBe('translateY(-50%)');
    await act(async () => button('樓上｜星象召喚盤').click());
    await travel();
    expect(container.querySelector('[data-crystal="node-test"]')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('記憶庫不存在時可選擇其他資料夾；空藏書架有說明', async () => {
    const chooseVault = vi.fn(async () => ({ ...vaultInfo, key: 'new-vault', path: '自訂記憶庫' }));
    await renderApp(bridge({ getVaultInfo: async () => ({ ...vaultInfo, exists: false }), chooseVault, listEntries: async () => [] }));
    expect(container.textContent).toContain('找不到記憶庫資料夾');
    await act(async () => { button('選擇資料夾').click(); });
    expect(chooseVault).toHaveBeenCalledOnce();
    expect(button('記憶庫位置').title).toBe('自訂記憶庫');
    expect(container.textContent).toContain('這裡還沒有任何記憶');
  });

  it('案頭包含典藏草稿與未完書籤，開卷可閱讀摘要、回顧及演化線', async () => {
    const vault = await renderApp();
    const board = container.querySelector('[aria-labelledby="draft-board"]')!;
    expect(board.textContent).toContain('待核閱 2 · 未完書籤 1');
    expect(board.textContent).toContain('待核閱偏好');
    expect(button('確認', board).getAttribute('aria-disabled')).toBe('false');
    expect(button('標為完成', board).getAttribute('aria-disabled')).toBe('false');
    await act(async () => { button('看詳情', board).click(); });
    const paper = container.querySelector('[aria-label="閱讀桌"]')!;
    expect(paper.textContent).toContain('結論摘要');
    expect(paper.textContent).toContain('回顧正文');
    expect(paper.textContent).toContain('取代演化線');
    expect(paper.textContent).toContain('關聯卷宗');
    expect(button('移入回收', paper.querySelector('footer')!).getAttribute('aria-disabled')).toBe('false');
    expect(vault.setStatus).not.toHaveBeenCalled();
    expect([...paper.querySelectorAll('dt')].map((item) => item.textContent)).toEqual(['2000', '1900']);
  });

  it('頁籤、專案、搜尋與無結果交叉作用，排除被取代的卷宗', async () => {
    vi.useFakeTimers();
    const vault = await renderApp();
    expect(container.querySelectorAll('[data-entry]')).toHaveLength(3);
    act(() => button('典藏', container.querySelector('[aria-label="卷宗類別"]')!).click());
    expect(container.querySelectorAll('[data-entry]')).toHaveLength(1);
    expect(card(archive).textContent).toContain('典藏・偏好 · ');
    act(() => {
      const select = container.querySelector('select')!;
      select.value = select.options[1].value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(container.textContent).toContain('書架上暫無符合條件之卷宗。');
    act(() => button('全部', container.querySelector('[aria-label="卷宗類別"]')!).click());
    act(() => typeSearch('故障'));
    await act(async () => vi.advanceTimersByTimeAsync(120));
    expect(vault.search).toHaveBeenCalledWith('故障', { includeSuperseded: true });
    expect(container.querySelectorAll('[data-entry]')).toHaveLength(1);
    expect(card(bookmark).textContent).toContain('追蹤故障讀值');
  });

  it('前版浮層可換卷，開卷後焦點移入，Esc 恢復原焦點與捲動', async () => {
    await renderApp();
    const shelf = container.querySelector<HTMLElement>('[aria-label="藏書架"]')!;
    const source = button('整理採樣記錄', card(baseEntry));
    await act(async () => { button('前版 ×1', card(baseEntry)).click(); });
    const stack = container.querySelector('[aria-label="前版卷宗"]')!;
    expect(stack.textContent).toContain('舊採樣記錄');
    expect(container.querySelectorAll('[data-entry]')).toHaveLength(3);
    act(() => container.querySelector('header')!.dispatchEvent(new Event('pointerdown', { bubbles: true })));
    expect(container.querySelector('[aria-label="前版卷宗"]')).toBeNull();

    const previousButton = button('前版 ×1', card(baseEntry));
    await act(async () => previousButton.click());
    await act(async () => button(previous.title, container.querySelector('[aria-label="前版卷宗"]')!).click());
    expect(document.activeElement?.textContent).toBe(previous.title);
    act(() => press(document.activeElement as HTMLElement, 'Escape'));
    expect(document.activeElement).toBe(previousButton);

    await act(async () => {
      source.focus();
      shelf.scrollTop = 96;
      source.click();
    });
    expect(document.activeElement?.textContent).toBe(baseEntry.title);
    const paper = container.querySelector('[aria-label="閱讀桌"]')!;
    await act(async () => { button(previous.title, paper.querySelector('ol')!).click(); });
    expect(document.activeElement?.textContent).toBe(previous.title);
    act(() => press(document.activeElement as HTMLElement, 'Escape'));
    expect(container.querySelector('[aria-label="閱讀桌"]')).toBeNull();
    expect(document.activeElement).toBe(source);
    expect(shelf.scrollTop).toBe(96);
  });

  it('確認成功才更新案頭計數，保留按鈕焦點、捲動及其他卡片', async () => {
    let live = entries;
    let finish: (() => void) | undefined;
    const setStatus = vi.fn<VaultApi['setStatus']>((path, status) => new Promise((resolve) => {
      finish = () => {
        live = live.map((entry) => entry.path === path ? { ...entry, mtime: 101, size: 201, status } : entry);
        resolve({ ok: true, mtime: 101, size: 201 });
      };
    }));
    await renderApp(bridge({ setStatus, listEntries: async () => structuredClone(live) }));
    const board = container.querySelector('[aria-labelledby="draft-board"]')!;
    const untouched = card(bookmark);
    const shelf = container.querySelector<HTMLElement>('[aria-label="藏書架"]')!;
    const confirm = button('確認', board);
    act(() => { shelf.scrollTop = 60; confirm.focus(); confirm.click(); });
    expect(setStatus).toHaveBeenCalledWith(baseEntry.path, '已確認', { mtime: 100, size: 200 });
    expect(board.textContent).toContain('正在寫入…');
    expect(board.textContent).toContain('待核閱 2 · 未完書籤 1');
    expect(card(baseEntry).textContent).toContain('待核閱');
    await act(async () => finish?.());
    expect(board.textContent).toContain('待核閱 1 · 未完書籤 1');
    expect(card(baseEntry).textContent).toContain('已收錄');
    expect(card(bookmark)).toBe(untouched);
    expect(document.activeElement).toBe(confirm);
    expect(shelf.scrollTop).toBe(60);
  });

  it('暫時的寫入失敗不改狀態，使用同一份版本重試後才更新', async () => {
    let live = entries;
    const setStatus = vi.fn<VaultApi['setStatus']>(async (path, status) => {
      live = live.map((entry) => entry.path === path ? { ...entry, mtime: 102, status } : entry);
      return { ok: true, mtime: 102, size: 200 };
    }).mockResolvedValueOnce({ ok: false, reason: 'io' });
    await renderApp(bridge({ setStatus, listEntries: async () => structuredClone(live),
      readEntry: async (path) => {
        const entry = live.find((entry) => entry.path === path);
        return entry ? detail(entry) : null;
      } }));
    await act(async () => button(baseEntry.title, card(baseEntry)).click());
    const paper = container.querySelector<HTMLElement>('[aria-label="閱讀桌"]')!;
    paper.scrollTop = 40;
    await act(async () => button('退回', paper.querySelector('footer')!).click());
    expect(paper.textContent).toContain('未儲存');
    expect(paper.textContent).toContain('無法寫入記憶庫');
    expect(card(baseEntry).textContent).toContain('待核閱');
    await act(async () => button('重試', paper).click());
    expect(setStatus).toHaveBeenLastCalledWith(baseEntry.path, '退回', { mtime: 100, size: 200 });
    expect(paper.textContent).toContain('已儲存：已退回');
    expect(card(baseEntry).textContent).toContain('已退回');
    expect(paper.scrollTop).toBe(40);
  });

  it.each(['conflict', 'missing'] as const)('衝突或遺失改為重讀卷宗；需要使用者再次主動送出（%s）', async (reason) => {
    const updated = { ...baseEntry, mtime: 900, size: 300 };
    const setStatus = vi.fn<VaultApi['setStatus']>(async () => ({ ok: false, reason }));
    const readEntry = vi.fn(async () => reason === 'missing' ? null : { ...detail(updated), body: '重新讀到的新正文。' });
    await renderApp(bridge({ setStatus, readEntry }));
    const board = container.querySelector('[aria-labelledby="draft-board"]')!;
    await act(async () => button('確認', board).click());
    expect(board.textContent).toContain(reason === 'conflict' ? '檔案已被修改' : '找不到卷宗');
    expect([...board.querySelectorAll('button')].some((item) => item.textContent === '重試')).toBe(false);
    await act(async () => button('重新載入此卷宗', board).click());
    expect(readEntry).toHaveBeenCalledWith(baseEntry.path);
    expect(setStatus).toHaveBeenCalledTimes(1);
    const paper = container.querySelector('[aria-label="閱讀桌"]')!;
    if (reason === 'conflict') {
      expect(paper.textContent).toContain('重新讀到的新正文。');
      await act(async () => button('確認', paper).click());
      expect(setStatus).toHaveBeenLastCalledWith(baseEntry.path, '已確認', { mtime: 900, size: 300 });
    } else {
      expect(paper.textContent).toContain('無法讀取這卷記憶');
    }
    expect(board.textContent).toContain('待核閱 2 · 未完書籤 1');
  });

  it('舊格式卷宗的閱讀桌操作停用並解釋原因', async () => {
    const legacy = { ...baseEntry, writable: false };
    const vault = await renderApp(bridge({ listEntries: async () => [legacy], readEntry: async () => detail(legacy) }));
    await act(async () => button(legacy.title, card(legacy)).click());
    const footer = container.querySelector('[aria-label="閱讀桌"] footer')!;
    expect(footer.textContent).toContain('此檔為舊格式，尚不支援寫入');
    expect(button('確認', footer).getAttribute('aria-disabled')).toBe('true');
    expect(button('退回', footer).getAttribute('aria-disabled')).toBe('true');
    expect(button('移入回收', footer).getAttribute('aria-disabled')).toBe('false');
    act(() => button('確認', footer).click());
    expect(vault.setStatus).not.toHaveBeenCalled();
  });

  it('完成書籤後更新案頭；回收成功提供撤銷並用回收後版本還原', async () => {
    let live = entries;
    const recycledPath = '_回收/' + baseEntry.path;
    const restore = vi.fn<VaultApi['restoreFromRecycle']>(async () => {
      live = [...live, baseEntry];
      return { ok: true, mtime: 103, size: 200 };
    }).mockResolvedValueOnce({ ok: false, reason: 'occupied' });
    const move = vi.fn<VaultApi['moveToRecycle']>(async () => {
      live = live.filter((entry) => entry.path !== baseEntry.path);
      return { ok: true, recycledPath, originalPath: baseEntry.path, mtime: 103, size: 200 };
    });
    const setStatus = vi.fn<VaultApi['setStatus']>(async (path, status) => {
      live = live.map((entry) => entry.path === path ? { ...entry, mtime: 102, status } : entry);
      return { ok: true, mtime: 102, size: 200 };
    });
    await renderApp(bridge({ listEntries: async () => structuredClone(live), setStatus,
      moveToRecycle: move, restoreFromRecycle: restore }));
    const board = container.querySelector('[aria-labelledby="draft-board"]')!;
    await act(async () => button('標為完成', board).click());
    expect(setStatus).toHaveBeenCalledWith(bookmark.path, '已完成', { mtime: 100, size: 200 });
    expect(board.textContent).toContain('未完書籤 0');
    await act(async () => button(baseEntry.title, card(baseEntry)).click());
    const paper = container.querySelector('[aria-label="閱讀桌"]')!;
    await act(async () => button('移入回收', paper).click());
    expect(container.querySelector('[aria-label="閱讀桌"]')).toBeNull();
    expect(container.textContent).toContain('凡 2 卷');
    await act(async () => button('撤銷').click());
    expect(restore).toHaveBeenCalledWith(recycledPath, { mtime: 103, size: 200, originalPath: baseEntry.path });
    expect(container.textContent).toContain('原位置已有同名卷宗，未還原');
    expect(container.textContent).toContain('凡 2 卷');
    await act(async () => button('重試').click());
    expect(card(baseEntry).textContent).toContain(baseEntry.title);
    expect(container.textContent).toContain('凡 3 卷');
  });

  it('連續寫入只顯示最新提示，一併保留撤銷，提示在閱讀桌工作區之外', async () => {
    let live = entries;
    const recycledPath = '_回收/' + baseEntry.path.replace(/\.md$/, ' (2).md');
    const moveToRecycle = vi.fn<VaultApi['moveToRecycle']>(async () => {
      live = live.filter((entry) => entry.path !== baseEntry.path);
      return { ok: true, recycledPath, originalPath: baseEntry.path, mtime: 103, size: 200 };
    });
    const setStatus = vi.fn<VaultApi['setStatus']>(async (path, status) => {
      live = live.map((entry) => entry.path === path ? { ...entry, status, mtime: 111 } : entry);
      return { ok: true, mtime: 111, size: 200 };
    });
    const restore = vi.fn<VaultApi['restoreFromRecycle']>(async () => ({ ok: false, reason: 'conflict' }));
    const readRecycledEntry = vi.fn(async () => ({ title: baseEntry.title, body: '更新的回收內容', review: '', mtime: 150, size: 210 }));
    await renderApp(bridge({ listEntries: async () => live, moveToRecycle, setStatus, restoreFromRecycle: restore, readRecycledEntry }));
    await act(async () => button(baseEntry.title, card(baseEntry)).click());
    await act(async () => button('移入回收').click());
    await act(async () => button(archive.title, card(archive)).click());
    const footer = container.querySelector('[aria-label="閱讀桌"] footer')!;
    await act(async () => button('確認', footer).click());
    const notices = container.querySelectorAll('[data-write-notice]');
    expect(notices).toHaveLength(1);
    expect(notices[0].textContent).toContain('已收錄：' + archive.title);
    expect(notices[0].textContent).not.toContain('已移入回收區：');
    expect(notices[0].closest('[data-library-workspace]')).toBeNull();
    expect(footer.closest('[data-library-workspace]')).not.toBeNull();
    await act(async () => button('撤銷', notices[0]).click());
    await act(async () => button('重新載入此卷宗', notices[0]).click());
    expect(readRecycledEntry).toHaveBeenCalledWith(recycledPath, baseEntry.path);
    expect(restore).toHaveBeenCalledTimes(1);
    expect(notices[0].textContent).toContain('更新的回收內容');
    await act(async () => button('撤銷', notices[0]).click());
    expect(restore).toHaveBeenLastCalledWith(recycledPath, { mtime: 150, size: 210, originalPath: baseEntry.path });
  });

  it('取得焦點與手動整理會重讀，保持閱讀桌、捲動及焦點；專案路徑不呈現', async () => {
    const sensitive = 'C:/Users/synthetic-person/private-project';
    let version = 100;
    let failed = false;
    const project = { ...baseEntry, projectId: sensitive, projectName: sensitive };
    const listEntries = vi.fn(async () => [{ ...project, mtime: version }]);
    const readEntry = vi.fn(async () => {
      if (failed) throw new Error('模擬重讀失敗');
      return { ...detail(project), mtime: version, body: '版本 ' + version,
        attributes: [['專案ID', sensitive], ['project-id', sensitive], ['說明', '一般欄位']] as MemoryEntryDetail['attributes'] };
    });
    await renderApp(bridge({ listEntries, readEntry }));
    expect(container.querySelector('select')?.textContent).toContain('未命名書閣');
    await act(async () => button(baseEntry.title, card(baseEntry)).click());
    const paper = container.querySelector<HTMLElement>('[aria-label="閱讀桌"]')!;
    const focus = document.activeElement;
    paper.scrollTop = 48;
    version = 101;
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(paper.textContent).toContain('版本 101');
    expect(document.activeElement).toBe(focus);
    expect(paper.scrollTop).toBe(48);
    failed = true;
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(paper.textContent).toContain('以下是上次讀取的內容');
    expect(paper.textContent).toContain('版本 101');
    expect(button('確認', paper).getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(focus);
    failed = false;
    version = 102;
    await act(async () => button('重新整理').click());
    expect(paper.textContent).toContain('版本 102');
    expect(container.innerHTML).not.toContain(sensitive);
    expect(listEntries).toHaveBeenCalledTimes(4);
    expect(readEntry).toHaveBeenCalledTimes(4);
  });

  it('採用已存版式；B 可用方向鍵；切換版式與低動態送出設定', async () => {
    const vault = await renderApp(bridge({ getSettings: async () => ({ deskMode: 'B', reducedMotion: false }) }));
    const source = button(baseEntry.title, card(baseEntry));
    await act(async () => source.click());
    expect(container.querySelector('[aria-label="閱讀桌"]')?.getAttribute('role')).toBe('region');
    act(() => { source.focus(); press(source, 'ArrowRight'); });
    expect(document.activeElement?.textContent).toBe(bookmark.title);
    await act(async () => button('B 右側 420px 欄').click());
    expect(vault.setSettings).toHaveBeenCalledWith({ deskMode: 'A' });
    expect(container.querySelector('[aria-label="閱讀桌"]')?.getAttribute('role')).toBe('dialog');
    await act(async () => button('低動態：關').click());
    expect(vault.setSettings).toHaveBeenCalledWith({ reducedMotion: true });
    expect(container.querySelector('[data-reduced-motion="true"]')).not.toBeNull();
  });

  it('分批顯示大量卷宗，方向鍵可以跨過目前渲染範圍', async () => {
    const batch = Array.from({ length: 60 }, (_, index) => ({
      ...baseEntry, path: 'cases/試驗/' + index + '.md', title: '卷宗 ' + index,
      updatedAt: baseEntry.updatedAt - index, previousCount: 0,
    }));
    await renderApp(bridge({ listEntries: async () => batch }));
    expect(container.querySelectorAll('[data-entry]')).toHaveLength(24);
    expect(container.textContent).toContain('凡 60 卷');
    expect(container.textContent).toContain('顯示更多便箋（24／60）');
    const edge = card(batch[23]).querySelector<HTMLButtonElement>('[data-entry-title]')!;
    act(() => { edge.focus(); press(edge, 'ArrowRight'); });
    expect(document.activeElement?.textContent).toBe('卷宗 24');
    expect(container.querySelectorAll('[data-entry]').length).toBeGreaterThan(24);
  });

  it('300ms 才顯示載入，忽略較晚抵達的舊卷宗', async () => {
    vi.useFakeTimers();
    const resolvers = new Map<string, (entry: MemoryEntryDetail) => void>();
    const readEntry: VaultApi['readEntry'] = (path) => new Promise((resolve) => resolvers.set(path, resolve));
    await renderApp(bridge({ readEntry, getSettings: async () => ({ deskMode: 'B', reducedMotion: true }) }));
    act(() => button(baseEntry.title, card(baseEntry)).click());
    await act(async () => vi.advanceTimersByTimeAsync(299));
    expect(container.textContent).not.toContain('正在翻閱…');
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(container.textContent).toContain('正在翻閱…');
    act(() => button(archive.title, card(archive)).click());
    expect(container.textContent).not.toContain('正在翻閱…');
    await act(async () => resolvers.get(archive.path)!(detail(archive)));
    await act(async () => resolvers.get(baseEntry.path)!(detail(baseEntry)));
    expect(document.activeElement?.textContent).toBe(archive.title);
  });
});
