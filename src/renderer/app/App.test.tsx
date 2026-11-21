// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VaultApi } from '../../shared/ipc';
import type { MemoryEntry, MemoryEntryDetail, NodeCrystal, VaultInfo, ViewSettings } from '../../shared/types';
import { App } from './App';

const vaultInfo: VaultInfo = { path: 'C:/fixture/vault', exists: true, wakeAvailable: false };
const baseEntry: MemoryEntry = {
  path: 'cases/試驗/2026-0001.md', title: '整理採樣記錄', summary: '採樣時間採用二十四小時制。',
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
const crystal: NodeCrystal = { nodeId: 'node-test', name: '霧苔', role: null, status: '封存', canWake: false, projectNames: [] };

function detail(entry: MemoryEntry): MemoryEntryDetail {
  return {
    ...entry, size: 200, mtime: 100, attributes: [['2000', '先出現'], ['1900', '後出現']],
    body: '段落正文。', review: '回顧正文。',
    supersessionChain: entry.previousCount ? [{ path: previous.path, title: previous.title,
      updatedAt: previous.updatedAt, caseId: previous.caseId, status: 'available' }] : [],
    caseReferences: entry.path === baseEntry.path ? [previous.path] : [],
  };
}

function bridge(overrides: Partial<VaultApi> = {}): VaultApi {
  let settings: ViewSettings = { deskMode: 'A', reducedMotion: false };
  return {
    getVaultInfo: vi.fn(async () => vaultInfo),
    chooseVault: vi.fn(async () => null),
    getSettings: vi.fn(async () => settings),
    setSettings: vi.fn(async (patch) => (settings = { ...settings, ...patch })),
    listEntries: vi.fn(async () => entries),
    search: vi.fn(async (term) => entries.filter(({ title }) => title.includes(term))),
    readEntry: vi.fn(async (path) => {
      const entry = entries.find((item) => item.path === path);
      return entry ? detail(entry) : null;
    }),
    listCrystals: vi.fn(async () => ({ crystals: [crystal], links: [] })),
    readCrystal: vi.fn(async () => null),
    setStatus: vi.fn<VaultApi['setStatus']>(async () => ({ ok: false, reason: 'io' })),
    saveEntry: vi.fn<VaultApi['saveEntry']>(async () => ({ ok: false, reason: 'io' })),
    moveToRecycle: vi.fn<VaultApi['moveToRecycle']>(async () => ({ ok: false, reason: 'io' })),
    restoreFromRecycle: vi.fn<VaultApi['restoreFromRecycle']>(async () => ({ ok: false, reason: 'io' })),
    wake: vi.fn(async () => ({ ok: false, nodeName: null, sessionId: null })),
    onVaultChanged: vi.fn(() => () => {}),
    ...overrides,
  };
}

describe('典藏室', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  async function renderApp(vault = bridge()) {
    vi.stubGlobal('vault', vault);
    await act(async () => { root.render(<App />); });
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

  it('樓層可往返；點首字徽章只交接節點，不開卷', async () => {
    const vault = await renderApp();
    const library = button('樓下｜典藏室');
    const sky = button('樓上｜星象召喚盤');
    expect(container.querySelector('h1')?.textContent).toBe('記憶寶庫');
    expect(library.getAttribute('aria-pressed')).toBe('true');
    const seal = card(baseEntry).querySelector<HTMLButtonElement>('button[aria-label="承辦：霧苔"]')!;
    expect(seal.textContent).toBe('霧');
    expect(seal.tabIndex).toBe(-1);
    act(() => seal.click());
    expect(sky.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('main section > p')?.textContent).toBe('霧苔');
    expect(vault.readEntry).not.toHaveBeenCalled();
    act(() => library.click());
    expect(library.getAttribute('aria-pressed')).toBe('true');
  });

  it('記憶庫不存在時可選擇其他資料夾；空藏書架有說明', async () => {
    const chooseVault = vi.fn(async () => ({ ...vaultInfo, path: 'C:/fixture/new-vault' }));
    await renderApp(bridge({ getVaultInfo: async () => ({ ...vaultInfo, exists: false }), chooseVault, listEntries: async () => [] }));
    expect(container.textContent).toContain('找不到記憶庫資料夾');
    await act(async () => { button('選擇資料夾').click(); });
    expect(chooseVault).toHaveBeenCalledOnce();
    expect(button('記憶庫位置').title).toBe('C:/fixture/new-vault');
    expect(container.textContent).toContain('這裡還沒有任何記憶');
  });

  it('案頭包含典藏草稿與未完書籤，案頭及閱讀紙的寫入控制停用', async () => {
    const vault = await renderApp();
    const board = container.querySelector('[aria-labelledby="draft-board"]')!;
    expect(board.textContent).toContain('待核閱 2 · 未完書籤 1');
    expect(board.textContent).toContain('待核閱偏好');
    expect(button('確認', board).disabled).toBe(true);
    expect(button('標為完成', board).disabled).toBe(true);
    await act(async () => { button('看詳情', board).click(); });
    const paper = container.querySelector('[aria-label="閱讀桌"]')!;
    expect(paper.textContent).toContain('結論摘要');
    expect(paper.textContent).toContain('回顧正文');
    expect(paper.textContent).toContain('取代演化線');
    expect(paper.textContent).toContain('關聯卷宗');
    expect(paper.textContent).toContain('寫入功能將於 M4 開放');
    expect([...paper.querySelectorAll<HTMLButtonElement>('footer button')].every((item) => item.disabled)).toBe(true);
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
      select.value = 'p';
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
