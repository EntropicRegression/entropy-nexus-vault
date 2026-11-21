// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { VaultSnapshot } from '../src/main/vault';
import { entryFromFile } from '../src/main/vault/entry';
import { App } from '../src/renderer/app/App';
import type { VaultApi } from '../src/shared/ipc';

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
  let completeSearch: (() => void) | undefined;
  const bridge: Pick<VaultApi, 'getVaultInfo' | 'getSettings' | 'listEntries' | 'search' | 'readEntry' | 'listCrystals'> = {
    getVaultInfo: async () => ({ path: 'synthetic-fixture', exists: true, wakeAvailable: false }),
    getSettings: async () => ({ deskMode: 'A', reducedMotion: true }),
    listEntries: async (filter) => snapshot.listEntries(filter),
    search: async (query, filter) => {
      const entries = snapshot.search(query, filter);
      completeSearch?.();
      return entries;
    },
    readEntry: async (path) => snapshot.readEntry(path),
    listCrystals: async () => snapshot.listCrystals(),
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
      const host = document.createElement('div');
      document.body.append(host);
      const root = createRoot(host);
      try {
        await measure('首批渲染', () => root.render(<App />));
        expect(host.querySelectorAll('[data-entry]')).toHaveLength(96);
        expect(host.textContent).toContain('凡 500 卷');
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
