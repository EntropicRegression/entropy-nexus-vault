// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryEntry, MemoryEntryDetail, MeetingTranscript, NodeCrystal } from '../../shared/types';
import libraryCss from './Library.module.css?raw';
import coil from '../../../assets/ui/meeting-coil.svg?raw';
import verifyPackaged from '../../../scripts/verify-packaged-app.cjs?raw';
import { Markdown } from './Markdown';
import { MeetingView } from './MeetingView';
import { EndBadge } from './Paper';
import { ReadingDesk, sourceMeetingPath } from './ReadingDesk';

const transcript: MeetingTranscript = {
  conclusion: '採用週期制。\n\n後續:潮音寫規則。',
  rounds: [
    { round: 1, speeches: [
      { name: '松針', nodeId: 'n1', text: '提議改成週期制。' },
      { name: '潮音', nodeId: 'n2', text: '## 草案\n\n```ts\nif (x) {\n    run();\n}\n```\n\n> 上次也這樣寫' },
    ] },
    { round: 2, speeches: [
      { name: '主控台', nodeId: null, text: '燈芯本輪沒有回覆,已略過。' },
      { name: '松針', nodeId: 'n1', text: '收斂成結論。' },
    ] },
  ],
  problems: [],
};

const entry = (extra: Partial<MemoryEntryDetail> = {}): MemoryEntryDetail => ({
  path: 'meetings/觀測站/2026-11-21-排程.md', title: '排程', summary: '採用週期制。', mtime: 1, size: 1, writable: true,
  kind: 'meeting', shelf: 'meeting', scope: '專案', subtype: '', status: '未確認', projectId: 'p_x', projectName: '觀測站',
  nodeId: 'n1', nodeLabel: '松針', participantNodeIds: ['n2', 'n3'], nodeIds: ['n1', 'n2', 'n3'], caseId: null,
  updatedAt: 0, superseded: false, previousCount: 0, heat: { level: 'ember', count: 0, lastRecalledAt: null },
  meeting: { topic: '排程', rounds: 2, startedAt: 0, endedAt: 0, hostName: '松針',
    participants: [{ nodeId: 'n2', name: '潮音' }, { nodeId: 'n3', name: '燈芯' }], endReason: '逾時', hasConclusion: true,
    outputs: ['knowledge/觀測站/排程決策.md', 'knowledge/觀測站/不存在.md'] },
  body: '## 第 1 輪\n\n### 松針 · n1\n\n> 原文', attributes: [], review: '', supersessionChain: [], caseReferences: [],
  transcript, ...extra,
} as MemoryEntryDetail);

const decision = { path: 'knowledge/觀測站/排程決策.md', title: '週期排程決策' } as MemoryEntry;

describe('會議閱讀檢視(M6b)', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });

  const render = async (detail: MemoryEntryDetail, onOpen = vi.fn(), onNode = vi.fn()) => {
    const nodes = new Map([['n2', { nodeId: 'n2', name: '潮音' } as NodeCrystal]]);
    await act(async () => {
      root.render(<MeetingView entry={detail} entries={new Map([[decision.path, decision]])} nodes={nodes} related={new Map()}
        onOpen={onOpen} onNode={onNode} />);
    });
    return { onOpen, onNode };
  };
  const view = () => container.querySelector('[data-meeting-view]')!;
  const click = async (element: Element) => { await act(async () => { (element as HTMLElement).click(); }); };

  it('結論置頂、出席名單主持在前、逾時徽章、分輪與發言者印章', async () => {
    await render(entry());
    const sections = [...view().children].map((child) => child.tagName);
    expect(sections.indexOf('SECTION')).toBeLessThan(sections.indexOf('DETAILS'));
    expect(view().querySelector('section')!.textContent).toBe('結論採用週期制。後續:潮音寫規則。');
    const attendees = [...view().querySelectorAll('[class*="attendee"]')].map((item) => item.textContent);
    expect(attendees).toEqual(['♛ 主持 · 松針', '潮音', '燈芯']);
    expect(view().querySelector('[data-end="逾時"]')!.textContent).toContain('逾時');
    expect([...view().querySelectorAll('details > summary')].map((item) => item.textContent)).toEqual(['第 1 輪2 則發言', '第 2 輪2 則發言']);
    const consoleSpeech = view().querySelector('[data-speech="-"]')!;
    expect(consoleSpeech.querySelector('svg rect[stroke-dasharray]')).not.toBeNull();
    expect(consoleSpeech.textContent).toContain('主控台');
    expect(view().querySelector('[data-speech="n1"] svg polygon')).not.toBeNull();
    expect(view().innerHTML).not.toMatch(/data:|url\(/);
  });

  it('發言內的標題、程式碼縮排與內層引用都保留', async () => {
    await render(entry());
    const speech = view().querySelector('[data-speech="n2"]')!;
    expect(speech.querySelector('h3')!.textContent).toBe('草案');
    expect(speech.querySelector('pre code')!.textContent).toBe('if (x) {\n    run();\n}');
    expect(speech.querySelector('blockquote')!.textContent).toBe('上次也這樣寫');
  });

  it('發言者篩選:只顯示所選節點,沒有發言的輪次說明;再按一次回到全部', async () => {
    await render(entry());
    await click(view().querySelector('[data-speaker-filter="n2"]')!);
    expect([...view().querySelectorAll('[data-speech]')].map((item) => item.getAttribute('data-speech'))).toEqual(['n2']);
    expect(view().textContent).toContain('本輪沒有 潮音 的發言。');
    expect(view().querySelector('details > summary small')!.textContent).toBe('顯示 1 / 2 則');
    expect(view().querySelector('[role="status"]')!.textContent).toBe('只顯示 潮音 的發言');
    await click(view().querySelector('[data-speaker-filter="n2"]')!);
    expect(view().querySelectorAll('[data-speech]')).toHaveLength(4);
  });

  it('全部收合與全部展開', async () => {
    await render(entry());
    const buttons = [...view().querySelectorAll('button')];
    await click(buttons.find((item) => item.textContent === '全部收合')!);
    expect([...view().querySelectorAll('details')].every((item) => !item.open)).toBe(true);
    await click(buttons.find((item) => item.textContent === '全部展開')!);
    expect([...view().querySelectorAll('details')].every((item) => item.open)).toBe(true);
  });

  it('產出草稿:找得到就能前往,找不到標示;節點名稱可前往星圖', async () => {
    const { onOpen, onNode } = await render(entry());
    const [found, missing] = view().querySelectorAll('[data-meeting-output]');
    expect(found.textContent).toBe('週期排程決策 →');
    await click(found);
    expect(onOpen).toHaveBeenCalledWith(decision.path);
    expect(missing.tagName).toBe('SPAN');
    expect(missing.textContent).toBe('不存在(找不到這份草稿)');
    await click([...view().querySelectorAll('button')].find((item) => item.textContent === '潮音' && item.className.includes('speakerName'))!);
    expect(onNode).toHaveBeenCalledWith(expect.objectContaining({ nodeId: 'n2' }));
  });

  it('沒有結論時顯示(主持人未寫結論);結構有問題時提示並可切換原文', async () => {
    await render(entry({ transcript: { ...transcript, conclusion: null, problems: ['發言標題「x」缺少「 · 節點ID」。'] } }));
    expect(view().querySelector('section p[data-empty]')!.textContent).toBe('(主持人未寫結論)');
    const notice = view().querySelector('[data-meeting-problems]')!;
    expect(notice.textContent).toContain('1 處結構無法辨認');
    await click(notice.querySelector('button')!);
    expect(view().querySelector('[data-meeting-raw]')!.textContent).toContain('原文');
    expect(view().querySelector('details')).toBeNull();
  });
});

describe('Markdown 引用(M6b 修正)', () => {
  it('巢狀引用成為巢狀 blockquote,引用內程式碼保留縮排', async () => {
    const host = document.createElement('div');
    const r = createRoot(host);
    await act(async () => { r.render(<Markdown body={'> 外層\n> > 內層\n>\n> ```\n>     縮排\n> ```'} related={new Map()} onOpen={() => {}} />); });
    expect(host.querySelector('blockquote blockquote')!.textContent).toBe('內層');
    expect(host.querySelector('blockquote pre code')!.textContent).toBe('    縮排');
    act(() => r.unmount());
  });
});

describe('會議卡外型(Hagemi M6 稿)', () => {
  it('線圈是同源 SVG 檔案,不用 data: URL;結束原因有圖示、文字與框線', async () => {
    const css = libraryCss.replace(/\r\n/g, '\n');
    expect(css).toContain("background: url('../../../assets/ui/meeting-coil.svg') 0 0 / 156px 20px no-repeat;");
    expect(css).not.toMatch(/url\(\s*['"]?data:/);
    expect(coil).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="156" height="20"/);
    expect(coil).not.toMatch(/<script|href=|url\(/);
    expect((coil.match(/<circle/g) ?? []).length).toBe(5);
    expect(verifyPackaged).toContain("source: 'assets/ui/meeting-coil.svg'");
    const host = document.createElement('div');
    const r = createRoot(host);
    await act(async () => { r.render(<>{(['完成', '中止', '逾時'] as const).map((reason) => <EndBadge key={reason} reason={reason} />)}</>); });
    expect([...host.querySelectorAll('[data-end]')].map((item) => item.textContent)).toEqual([' · ✓完成', ' · ■中止', ' · ⧗逾時']);
    expect(host.querySelector('[data-end] [aria-hidden="true"]')!.textContent).toBe('✓');
    act(() => r.unmount());
  });
});

describe('M6b 審查修正', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });

  const desk = (detail: MemoryEntryDetail, entries = new Map<string, MemoryEntry>()) => <ReadingDesk deskMode="A" selectedPath={detail.path}
    entry={detail} loading={false} checking={false} showLoading={false} error={false} entries={entries} nodes={new Map()}
    onOpen={() => {}} onClose={() => {}} onToggleMode={() => {}} onWrite={() => {}} onReload={() => {}} />;
  const click = async (element: Element) => { await act(async () => { (element as HTMLElement).click(); }); };

  it('換到另一份會議時,原文檢視、發言者篩選與收合狀態都重設', async () => {
    const broken = entry({ path: 'meetings/a/1.md', transcript: { ...transcript, problems: ['x'] } });
    await act(async () => { root.render(desk(broken)); });
    await click(container.querySelector('[data-meeting-problems] button')!);
    expect(container.querySelector('pre[data-meeting-raw]')!.textContent).toBe(broken.body);
    await act(async () => { root.render(desk(entry({ path: 'meetings/a/2.md' }))); });
    expect(container.querySelector('[data-meeting-raw]')).toBeNull();
    expect(container.querySelectorAll('[data-meeting-view] details')).toHaveLength(2);
  });

  it('讀屏狀態區一直存在;收合的輪次不顯示發言並有展開記號;主控台寫無節點 ID', async () => {
    await act(async () => { root.render(desk(entry())); });
    const status = container.querySelector('[data-meeting-view] [role="status"]')!;
    expect(status.textContent).toBe('');
    await click(container.querySelector('[data-speaker-filter="n1"]')!);
    expect(container.querySelector('[data-meeting-view] [role="status"]')).toBe(status);
    expect(status.textContent).toBe('只顯示 松針 的發言');
    await click(container.querySelector('[data-speaker-filter=""]')!);
    expect(container.querySelector('[data-speech="-"]')!.textContent).toContain('無節點 ID');
    await click([...container.querySelectorAll('[data-meeting-view] button')].find((b) => b.textContent === '全部收合')!);
    expect(container.querySelectorAll('[data-speech]')).toHaveLength(0);
    expect(container.querySelectorAll('details summary [aria-hidden="true"]')).toHaveLength(2);
    expect(libraryCss).toContain(".meetingRound:not([open]) .foldMark::before { content: '▸'; }");
  });

  it('決策草稿的來源會議:只認 meetings/ 下的相對路徑,找得到才能前往', async () => {
    expect(sourceMeetingPath([['來源會議', '[[meetings/觀測站/2026-11-21-排程.md]]']])).toBe('meetings/觀測站/2026-11-21-排程.md');
    expect(sourceMeetingPath([['來源會議', '[[meetings/觀測站/2026-11-21-排程]]']])).toBe('meetings/觀測站/2026-11-21-排程.md');
    expect(sourceMeetingPath([['來源會議', '[[knowledge/x/y.md]]']])).toBeNull();
    expect(sourceMeetingPath([['來源會議', '[[meetings/../x.md]]']])).toBeNull();
    expect(sourceMeetingPath([])).toBeNull();
    const draft = { ...entry({ transcript: undefined, meeting: undefined }), path: 'knowledge/觀測站/排程決策.md', kind: 'knowledge', shelf: 'decision',
      subtype: '決策', title: '週期排程決策', attributes: [['來源會議', '[[meetings/觀測站/2026-11-21-排程.md]]']] } as MemoryEntryDetail;
    const meetingEntry = { path: 'meetings/觀測站/2026-11-21-排程.md', title: '排程' } as MemoryEntry;
    await act(async () => { root.render(desk(draft, new Map([[meetingEntry.path, meetingEntry]]))); });
    expect(container.querySelector('[data-source-meeting] button')!.textContent).toBe('排程 →');
    await act(async () => { root.render(desk(draft)); });
    expect(container.querySelector('[data-source-meeting]')!.textContent).toContain('找不到這份會議紀錄');
  });
});

describe('會議閱讀檢視:完整主題(2026-11-28)', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });
  const show = async (detail: MemoryEntryDetail) => {
    await act(async () => {
      root.render(<MeetingView entry={detail} entries={new Map()} nodes={new Map()} related={new Map()} onOpen={vi.fn()} onNode={vi.fn()} />);
    });
  };

  it('短標題與主題不同時顯示完整主題;相同時不重複', async () => {
    const base = entry();
    await show({ ...base, title: '排程', meeting: { ...base.meeting!, topic: '排程:把背景說明整段寫進來的主題' } });
    expect(container.querySelector('[data-meeting-topic]')?.textContent).toBe('完整主題:排程:把背景說明整段寫進來的主題');
    await show(entry());
    expect(container.querySelector('[data-meeting-topic]')).toBeNull();
  });
});
