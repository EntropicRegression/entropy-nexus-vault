// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryEntry, NodeCrystal, NodeCrystalDetail } from '../../shared/types';
import { DetailPanel } from '../sky/DetailPanel';
import { Library } from './Library';
import { dateLabel } from './catalog';

const base: MemoryEntry = {
  path: 'cases/試驗/2026-0001.md', title: '整理採樣記錄', summary: '採樣時間採用二十四小時制。', mtime: 100, size: 200, writable: true,
  kind: 'case', shelf: 'case', scope: '專案', subtype: '', status: '未確認', projectId: 'p', projectName: '溫室',
  nodeId: 'host', nodeLabel: '霧苔', participantNodeIds: [], nodeIds: ['host'], caseId: '2026-0001',
  updatedAt: Date.UTC(2026, 10, 22), superseded: false, previousCount: 0, heat: { level: 'tepid', count: 1, lastRecalledAt: null },
};
const meeting = (path: string, topic: string, extra: Partial<MemoryEntry> = {}, end: '完成' | '中止' | '逾時' | null = '完成'): MemoryEntry => ({
  ...base, path, title: topic, summary: '', kind: 'meeting', shelf: 'meeting', caseId: null, projectId: '', projectName: '',
  participantNodeIds: ['guest'], nodeIds: ['host', 'guest'],
  meeting: { topic, rounds: 3, startedAt: 1, endedAt: 2, hostName: '霧苔', participants: [{ nodeId: 'guest', name: '藍鯨' }], endReason: end,
    hasConclusion: false, outputs: [] },
  ...extra,
});
const m1 = meeting('meetings/a.md', '排程討論', { summary: '決定週三發布。', status: '已確認' });
m1.meeting = { ...m1.meeting!, hasConclusion: true };
const m2 = meeting('meetings/b.md', '預算討論', {}, '中止');
const m3 = meeting('meetings/c.md', '路線討論', {}, '逾時');

describe('會議書架', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

  async function mount(entries: MemoryEntry[]) {
    vi.stubGlobal('vault', {
      listEntries: async () => entries, listCrystals: async () => ({ crystals: [], links: [] }),
      search: async () => [], searchNodes: async () => [], readEntry: async () => null,
    });
    await act(async () => { root.render(<Library query="" deskMode="B" onToggleMode={() => {}} active refreshToken={0} />); });
  }

  it('第五個書架與「會議」分頁;卡片顯示識別、輪數與中止/逾時標籤', async () => {
    await mount([base, m1, m2, m3]);
    const heading = [...container.querySelectorAll('h2')].map((item) => item.textContent);
    expect(heading.indexOf('會議書架')).toBeGreaterThan(heading.indexOf('判例書架'));
    expect([...container.querySelectorAll('button')].some((item) => item.textContent === '會議')).toBe(true);
    const card = (path: string) => container.querySelector<HTMLElement>('[data-entry="' + path + '"]')!;
    expect(card(m1.path).querySelector('[data-shelf="meeting"]')).not.toBeNull();
    expect(card(m1.path).textContent).toContain('會議 · ' + dateLabel(m1.updatedAt));
    expect(card(m1.path).textContent).toContain('3 輪');
    expect(card(m1.path).textContent).toContain('決定週三發布。');
    expect(card(m1.path).textContent).not.toMatch(/中止|逾時/);
    expect(card(m2.path).textContent).toContain('中止');
    expect(card(m3.path).textContent).toContain('逾時');
    expect(card(m2.path).textContent).toContain('(主持人未寫結論)');
    expect(card(m2.path).querySelector('[aria-label="主持:霧苔"], [aria-label="主持：霧苔"]')).not.toBeNull();
    expect(container.innerHTML).not.toMatch(/[A-Za-z]:\\|file:|data:/);
  });

  it('案頭:會議不計入待核閱,另計「會議 K」,標籤為待核閱會議,照更新時間與其他便箋混排', async () => {
    await mount([m2, m3, base, m1]);
    const board = container.querySelector('[aria-labelledby="draft-board"]')!;
    expect(board.querySelector('[aria-live]')!.textContent).toBe('待核閱 1 · 未完書籤 0 · 會議 2');
    const labels = [...board.querySelectorAll('article strong')].map((item) => item.textContent);
    expect(labels).toEqual(['待核閱會議', '待核閱會議', '待核閱判例']);
  });
});

const crystal = { nodeId: 'host', name: '霧苔', role: null, status: '線上', canWake: false, projectNames: [], glow: 'white' } as NodeCrystal;
const detail = (meetingEntries?: MemoryEntry[]): NodeCrystalDetail => ({
  ...crystal, profile: null, stats: null, archives: [], relatedEntries: [], archiveEntries: [], meetingEntries,
  confirmedCaseCount: 0, specialty: '', workflow: '', review: '', notRejectedRate: null, consoleAppendixCount: 0,
} as unknown as NodeCrystalDetail);

describe('節點履歷:參與的會議', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    vi.stubGlobal('vault', {});
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
  const show = (d: NodeCrystalDetail, onOpenEntry = vi.fn()) => {
    act(() => root.render(<DetailPanel node={crystal} detail={d} loading={false} error={false} onDismiss={() => {}} onOpenEntry={onOpenEntry} />));
    return onOpenEntry;
  };

  it('列出主持/參與、非已確認的狀態標籤,點擊跳轉', () => {
    const guestView = { ...m2, nodeId: 'other', nodeIds: ['other', 'host'], participantNodeIds: ['host'] };
    const rejected = { ...m3, status: '退回' as const };
    const open = show(detail([m1, guestView, rejected]));
    const rows = [...container.querySelectorAll<HTMLButtonElement>('[data-meeting-entry]')];
    expect(rows.map((row) => row.dataset.meetingEntry)).toEqual(['主持', '參與', '主持']);
    expect(rows[0].textContent).toContain('會議 · ' + dateLabel(m1.updatedAt) + ' · 排程討論');
    expect(rows[0].querySelector('[data-meeting-status]')).toBeNull();
    expect(rows[1].querySelector('[data-meeting-status]')!.textContent).toBe('待核閱');
    expect(rows[2].querySelector('[data-meeting-status]')!.textContent).toBe('已退回');
    act(() => rows[1].click());
    expect(open).toHaveBeenCalledWith(guestView);
    expect(container.querySelector('[data-meeting-entries]')!.innerHTML).not.toMatch(/[A-Za-z]:\\|file:|data:/);
    // Section sits after 典藏回憶.
    const text = container.textContent!;
    expect(text.indexOf('參與的會議')).toBeGreaterThan(text.indexOf('典藏回憶'));
  });

  it('沒有會議時顯示空狀態', () => {
    show(detail([]));
    expect(container.querySelector('[data-meeting-empty]')!.textContent).toBe('還沒有這個節點主持或參與的會議紀錄。');
  });
});

describe('閱讀桌引用與印章名稱', () => {
  it('只有會議紀錄的引用逐行換行;其他卷宗的折行引用仍合成一段', async () => {
    const { Markdown } = await import('./ReadingDesk');
    const host = document.createElement('div');
    const r = createRoot(host);
    const body = '> 第一行\n> 第二行';
    await act(async () => { r.render(<Markdown body={body} related={new Map()} onOpen={() => {}} />); });
    expect(host.querySelector('blockquote')!.innerHTML).toBe('第一行 第二行');
    await act(async () => { r.render(<Markdown body={body} related={new Map()} onOpen={() => {}} lineBreaks />); });
    expect(host.querySelectorAll('blockquote br')).toHaveLength(1);
    act(() => r.unmount());
  });

  it('不在星圖上的參與者用會議檔頭的名稱,不顯示節點ID', async () => {
    const { nodeName } = await import('./Paper');
    expect(nodeName(m1, 'guest', new Map())).toBe('藍鯨');
    expect(nodeName(m1, 'nobody', new Map())).toBe('nobody');
  });
});

