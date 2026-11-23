// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeskMode, MemoryEntry, MemoryEntryDetail } from '../../shared/types';
import { Library } from './Library';

const day = (date: number) => Date.UTC(2026, 10, date);
const base: MemoryEntry = {
  path: 'cases/溫室/2026-0001.md', title: '維護判例', summary: '維護細節', mtime: 100, size: 200, writable: true,
  kind: 'case', shelf: 'case', scope: '專案', subtype: '', status: '未確認', projectId: 'p_fixture', projectName: '溫室',
  nodeId: 'writer', nodeLabel: '新名字', participantNodeIds: [], nodeIds: ['writer'], caseId: '2026-0001',
  updatedAt: day(20), superseded: false, previousCount: 0, heat: { level: 'tepid', count: 1, lastRecalledAt: null },
};

function memoir(file: string, title: string, coverageDay: number | null, extra: Partial<MemoryEntry> = {}): MemoryEntry {
  const coverage = coverageDay === null ? null : { start: day(coverageDay), end: null };
  return { ...base, ...{
    path: 'memoirs/' + file + '.md', title, summary: '章節摘要', kind: 'memoir', shelf: 'archive',
    projectId: '', projectName: '', scope: '全域', caseId: null, status: '已確認',
    memoir: { coverage, coverageText: coverage ? new Date(coverage.start).toISOString().slice(0, 10) : '' },
  }, ...extra };
}

const first = memoir('舊名字-writer/一', '初次相遇', 10, { nodeLabel: '舊名字', updatedAt: day(27) });
const second = memoir('新名字-writer/二', '再次出發', 17, { status: '未確認', updatedAt: day(25), previousCount: 1 });
const last = memoir('新名字-writer/三', '路的盡頭', null, { status: '退回', summary: '', updatedAt: day(12) });
const superseded = memoir('新名字-writer/前版', '被取代的回憶', 12, { superseded: true });
const other = memoir('新名字-other/一', '另一節點的回憶', 13, { nodeId: 'other', nodeIds: ['other', 'writer'], participantNodeIds: ['writer'] });
const knowledge: MemoryEntry = {
  ...base, kind: 'knowledge', shelf: 'knowledge', path: 'knowledge/溫室/有用手冊.md', title: '有用手冊', caseId: null,
};
const preference: MemoryEntry = {
  ...base, kind: 'preference', shelf: 'knowledge', path: 'preferences/文件.md', title: '文件偏好', caseId: null, status: '已確認',
};
const entries = [second, last, base, other, superseded, first, knowledge, preference];

function detail(entry: MemoryEntry): MemoryEntryDetail {
  return {
    ...entry, body: '', review: '', attributes: [], caseReferences: [],
    supersessionChain: entry.path === second.path
      ? [{ path: superseded.path, title: superseded.title, updatedAt: superseded.updatedAt, caseId: null, status: 'available' }]
      : [],
    memoirSections: {
      uncertain: entry.path === last.path ? '無' : '尚未找到較早版本。',
      sources: '測試記錄。', body: entry.path === last.path ? '' : '回憶正文。',
    },
  };
}

describe('M7 回憶錄閱讀桌與知識書架', () => {
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
    vi.unstubAllGlobals();
  });

  async function mount(deskMode: DeskMode) {
    vi.stubGlobal('vault', {
      listEntries: async () => entries,
      listCrystals: async () => ({ crystals: [], links: [] }),
      readEntry: async (path: string) => detail(entries.find((entry) => entry.path === path)!),
    });
    await act(async () => root.render(<Library query="" deskMode={deskMode} onToggleMode={() => {}} active refreshToken={0} />));
  }

  const q = <T extends HTMLElement = HTMLElement>(selector: string) => container.querySelector<T>(selector)!;
  const card = (entry: MemoryEntry) => q('[data-entry="' + entry.path + '"]');
  const button = (text: string, scope: ParentNode = container) => Array.from(scope.querySelectorAll('button'))
    .find((item) => item.textContent === text)!;
  const chapters = () => q('[aria-label="這本回憶錄"]');
  const readingTitle = () => q('[aria-label="閱讀桌"] h2').textContent;

  it('典藏、知識與待處理分頁各自呈現正確卷宗，案頭另算回憶錄', async () => {
    await mount('A');
    const tabGroup = q('[aria-label="卷宗類別"]');
    expect(Array.from(tabGroup.querySelectorAll('button'), (tab) => tab.textContent))
      .toEqual(['全部', '判例', '決策', '書籤', '知識', '會議', '典藏', '待處理']);
    expect(q('[aria-labelledby="draft-board"] [aria-live]').textContent)
      .toBe('待核閱 2 · 未完書籤 0 · 會議 0 · 回憶錄 1');
    expect(q('[aria-labelledby="draft-board"] article strong').textContent).toBe('待核閱回憶錄');

    act(() => button('知識', tabGroup).click());
    expect(container.querySelectorAll('[data-entry] [data-shelf="knowledge"]')).toHaveLength(2);
    expect(card(knowledge).textContent).toContain('知識 · ');
    expect(card(preference).textContent).toContain('偏好 · ');
    expect(card(second)).toBeNull();

    act(() => button('典藏', tabGroup).click());
    expect(container.querySelectorAll('[data-entry] [data-shelf="archive"]')).toHaveLength(4);
    expect(card(first).textContent).toContain('回憶錄 · 舊名字 · 2026-11-10');
    expect(card(last).textContent).toContain('(沒有正文)');
    expect(card(other).querySelector('[aria-label="撰寫：新名字"]')).not.toBeNull();
    expect(card(other).querySelectorAll('[aria-label^="撰寫："]')).toHaveLength(1);
    expect(card(other).querySelector('[aria-label^="參與："]')).toBeNull();
    expect(card(superseded)).toBeNull();

    const project = q<HTMLSelectElement>('select');
    act(() => {
      project.value = project.options[1].value;
      project.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(card(second)).toBeNull();
    act(() => {
      project.value = '';
      project.dispatchEvent(new Event('change', { bubbles: true }));
      button('待處理', tabGroup).click();
    });
    expect(card(first)).toBeNull();
    expect(card(second)).not.toBeNull();
    expect(card(last)).not.toBeNull();
  });

  it.each<DeskMode>(['A', 'B'])('閱讀桌 %s 顯示同 ID 的章節，並能逐章切換', async (mode) => {
    await mount(mode);
    await act(async () => button(second.title, card(second)).click());
    const entries = [...chapters().querySelectorAll('ol button')];
    expect(entries.map((chapter) => chapter.querySelector('strong')!.textContent))
      .toEqual(['第 1 章 · 初次相遇', '第 2 章 · 再次出發', '第 3 章 · 路的盡頭']);
    expect(entries[1].getAttribute('aria-current')).toBe('page');
    expect(entries[1].textContent).toContain('待核閱');
    expect(entries[2].textContent).toContain('已退回');
    expect(q('[aria-label="閱讀桌"]').textContent).toContain(superseded.title);
    expect(q('[data-memoir-uncertain]').textContent).toContain('尚未找到較早版本。');
    expect(q('[data-memoir-uncertain]').nextElementSibling).toBe(q('[data-memoir-body]'));
    expect(q('[data-memoir-body]').nextElementSibling).toBe(q('[data-memoir-sources]'));

    await act(async () => button('← 上一章', chapters()).click());
    expect(readingTitle()).toBe(first.title);
    expect(button('← 上一章', chapters()).disabled).toBe(true);
    await act(async () => button('下一章 →', chapters()).click());
    expect(readingTitle()).toBe(second.title);
    await act(async () => button('下一章 →', chapters()).click());
    expect(readingTitle()).toBe(last.title);
    expect(button('下一章 →', chapters()).disabled).toBe(true);
    expect(q('[data-memoir-uncertain]').textContent).toContain('撰寫者表示沒有不確定之處');
  });
});
