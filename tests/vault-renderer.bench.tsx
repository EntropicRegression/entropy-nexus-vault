// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { VaultSnapshot } from '../src/main/vault';
import { entryFromFile } from '../src/main/vault/entry';
import { App } from '../src/renderer/app/App';
import type { VaultApi } from '../src/shared/ipc';
import type { MemoryEntry, VaultStatusUpdate } from '../src/shared/types';

const count = 500;
const samples = 7;
const now = Date.UTC(2026, 10, 22);

// Generated Markdown uses the real parser and search index. IPC transport is mocked.
function makeSnapshot() {
  const files = Array.from({ length: count }, (_, index) => {
    const pos = index % 4;
    const project = '測試書閣' + (index % 5);
    const kind = ['case', 'knowledge', 'knowledge', 'preference'][pos];
    const folder = ['cases/' + project, 'knowledge/' + project, 'knowledge/' + project, 'preferences'][pos];
    const subtype = ['', '決策', '書籤', ''][pos];
    const status = index % 11 === 0 ? (pos === 2 ? '未完' : '未確認') : (pos === 2 ? '已完成' : '已確認');
    const id = '2026-' + String(index + 1).padStart(4, '0');
    const text = [
      '---', '種類: ' + kind, '標題: 合成卷宗 ' + id, '子類: ' + subtype, '狀態: ' + status,
      '節點ID: fixture-node-' + (index % 12), '關鍵字: 演練-' + id, '---',
      '摘要: 以合成資料覆核記憶讀取。', '', '## 正文', '', '確認卷宗的排序、時間及內容。'.repeat(20),
      '', '## 回顧', '', '用同一組合成資料比較互動所需時間。',
    ].join('\n');
    return entryFromFile({ path: folder + '/' + id + '.md', text, mtime: now - index, size: text.length },
      { count: index % 7, lastRecalledAt: null }, now);
  });
  return new VaultSnapshot('.', files, { heat: new Map(), stats: null });
}

it('典藏室 500 筆合成卷宗，量測可見 DOM 更新', async () => {
  const snapshot = makeSnapshot();
  const target = snapshot.listEntries().find((entry) => entry.caseId === '2026-0001')!;
  let saved: { status: VaultStatusUpdate; mtime: number } | undefined;
  const updated = <T extends MemoryEntry>(entry: T): T => entry.path === target.path && saved ? { ...entry, ...saved } : entry;
  let completeSearch: (() => void) | undefined;
  const bridge: Pick<VaultApi, 'getVaultInfo' | 'getSettings' | 'listEntries' | 'search' | 'searchNodes' | 'readEntry' | 'listCrystals' | 'setStatus'> = {
    getVaultInfo: async () => ({ key: 'synthetic-fixture', path: 'synthetic-fixture', exists: true, wakeAvailable: false }),
    getSettings: async () => ({ deskMode: 'A', reducedMotion: true }),
    listEntries: async (filter) => structuredClone(snapshot.listEntries(filter).map(updated)),
    searchNodes: async (query) => snapshot.searchNodes(query),
    search: async (query, filter) => {
      const entries = snapshot.search(query, filter);
      completeSearch?.();
      return entries;
    },
    readEntry: async (path) => {
      const entry = await snapshot.readEntry(path);
      return entry && updated(entry);
    },
    listCrystals: async () => snapshot.listCrystals(),
    setStatus: async (path, status, expected) => {
      if (path !== target.path || expected.mtime !== (saved?.mtime ?? target.mtime) || expected.size !== target.size) {
        throw new Error('benchmark write version mismatch');
      }
      saved = { status, mtime: expected.mtime + 1 };
      return { ok: true, mtime: saved.mtime, size: expected.size };
    },
  };
  vi.stubGlobal('vault', bridge);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const timings = new Map<string, number[]>();
  async function measure(label: string, run: () => void | Promise<void>) {
    const start = performance.now();
    await act(async () => run());
    const values = timings.get(label) ?? [];
    values.push(performance.now() - start);
    timings.set(label, values);
  }

  try {
    for (let sample = 0; sample < samples; sample++) {
      saved = undefined;
      const host = document.createElement('div');
      document.body.append(host);
      const root = createRoot(host);
      try {
        await measure('首批渲染', () => root.render(<App />));
        expect(host.querySelectorAll('[data-entry]')).toHaveLength(96);
        expect(host.textContent).toContain('凡 500 卷');

        const cards = Array.from(host.querySelectorAll<HTMLElement>('[data-entry]'));
        const targetCard = cards.find((item) => item.dataset.entry === target.path)!;
        const board = host.querySelector('[aria-labelledby="draft-board"]')!;
        const note = [...board.querySelectorAll('article')].find((item) => item.textContent.includes('2026-0001'))!;
        const confirm = [...note.querySelectorAll('button')].find((item) => item.textContent.trim() === '確認')!;
        const checkDOM = (before: Set<string>, records: MutationRecord[]) => {
          for (const record of records) {
            const element = record.target instanceof Element ? record.target : record.target.parentElement;
            const path = element?.closest<HTMLElement>('[data-entry]')?.dataset.entry;
            if (path) before.add(path);
          }
        };
        const changed = new Set<string>();
        const mutations = new MutationObserver((records) => checkDOM(changed, records));
        mutations.observe(host, { subtree: true, childList: true, attributes: true, characterData: true });
        try {
          await measure('確認後 DOM 更新', () => confirm.click());
          checkDOM(changed, mutations.takeRecords());
          expect(targetCard.textContent).toContain('已收錄');
          expect([...changed]).toEqual([target.path]);
          expect(Array.from(host.querySelectorAll('[data-entry]')).every((node, index) => node === cards[index])).toBe(true);
          await act(async () => targetCard.querySelector<HTMLButtonElement>('[data-entry-title]')!.click());
          changed.clear();
          mutations.takeRecords();
          const footer = host.querySelector('[aria-label="閱讀桌"] footer')!;
          const reject = [...footer.querySelectorAll('button')].find((item) => item.textContent.trim() === '退回')!;
          await measure('退回後 DOM 更新', () => reject.click());
          checkDOM(changed, mutations.takeRecords());
          expect(targetCard.textContent).toContain('已退回');
          expect([...changed]).toEqual([target.path]);
          expect(Array.from(host.querySelectorAll('[data-entry]')).every((node, index) => node === cards[index])).toBe(true);
        } finally {
          mutations.disconnect();
        }
        await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="返回書架"]')!.click());
        const filters = host.querySelector('[aria-label="卷宗類別"]')!;
        const archive = [...filters.querySelectorAll('button')].find((item) => item.textContent === '典藏')!;
        await measure('切換典藏頁籤', () => archive.click());
        expect(host.querySelectorAll('[data-entry]')).toHaveLength(24);
        expect(host.textContent).toContain('凡 125 卷');

        const input = host.querySelector<HTMLInputElement>('input[type=search]')!;
        await measure('搜尋（含 120ms 去抖）', async () => {
          const searched = new Promise<void>((resolve) => { completeSearch = resolve; });
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '演練-2026-0004');
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await searched;
        });
        expect(host.querySelectorAll('[data-entry]')).toHaveLength(1);
        const button = host.querySelector<HTMLButtonElement>('[data-entry-title]')!;
        await measure('開卷', () => button.click());
        expect(document.activeElement?.textContent).toBe('合成卷宗 2026-0004');
        await measure('Esc 回位', () => {
          document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });
        expect(document.activeElement).toBe(button);
      } finally {
        await act(async () => root.unmount());
        host.remove();
      }
    }
    for (const [label, values] of timings) {
      const ordered = values.sort((a, b) => a - b);
      console.log(label + '｜' + samples + ' 組｜中位數 ' + ordered[Math.floor(samples / 2)].toFixed(2) +
        ' ms｜範圍 ' + ordered[0].toFixed(2) + '–' + ordered.at(-1)!.toFixed(2) + ' ms');
    }
  } finally {
    vi.unstubAllGlobals();
  }
}, 30_000);
