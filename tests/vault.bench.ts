import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { VaultReader } from '../src/main/vault';
import { VaultWriter } from '../src/main/vault/write';

// npm exec --offline -- vitest run --config tests/vault-perf.config.mts
const now = () => Date.parse('2026-11-22T04:00:00.000Z');
const count = 500;
const lookupCount = 10;
let root: string;
let warmReader: VaultReader;

async function measure(label: string, samples: number, run: () => Promise<unknown>): Promise<void> {
  const elapsed: number[] = [];
  for (let sample = 0; sample < samples; sample++) {
    const start = performance.now();
    await run();
    elapsed.push(performance.now() - start);
  }
  elapsed.sort((a, b) => a - b);
  console.log(label + '｜' + samples + ' 組｜中位數 ' + elapsed[Math.floor(samples / 2)].toFixed(2) +
    ' ms｜範圍 ' + elapsed[0].toFixed(2) + '–' + elapsed[samples - 1].toFixed(2) + ' ms');
}

describe('記憶庫（500 筆合成判例）', () => {
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'entropy-vault-bench-'));
    const projects = Array.from({ length: 5 }, (_, index) => 'project-' + index);
    await Promise.all(projects.map((project) => mkdir(join(root, 'cases', project), { recursive: true })));
    const body = '## 結論\n\n' + '已比較資料來源與時間戳，並在固定測試樣本驗證處理順序及報表收錄的正確性。'.repeat(12);
    for (let index = 1; index <= count; index++) {
      const project = projects[index % projects.length];
      const caseId = '2026-' + String(index).padStart(4, '0');
      const path = join(root, 'cases', project, caseId + '.md');
      await writeFile(path, [
        '---', '種類: case', '專案: ' + project, '節點ID: bench-node-' + index % 12,
        '案由: 驗證採樣流程 ' + caseId, '狀態: 已確認', '---',
        '摘要: 核對採樣與報表', body,
      ].join('\n'));
    }
    warmReader = new VaultReader(root, now);
    if ((await warmReader.read()).listEntries().length !== count) throw new Error('合成資料筆數不符');
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('量測冷讀、快取命中與連續搜尋', async () => {
    await measure('冷讀（新 Reader）', 7, () => new VaultReader(root, now).read());
    await measure('已暖機 Reader 讀取', 15, () => warmReader.read());
    await measure('連續查詢（10 次，含取得快照）', 5, async () => {
      for (let index = 1; index <= lookupCount; index++) {
        const results = (await warmReader.read()).search('2026-' + String(index * 31).padStart(4, '0'));
        if (results.length !== 1) throw new Error('查詢結果筆數不符');
      }
    });
  }, 60_000);

  it('量測寫入以及寫入後的 500 筆資料快照', async () => {
    const writer = new VaultWriter(root, () => warmReader.invalidate());
    const target = (await warmReader.read()).listEntries({ kind: 'case' })[0];
    let version = { mtime: target.mtime, size: target.size };
    let confirmation = false;
    await measure('真實檔案確認／退回（含暫存與同步）', 8, async () => {
      const result = await writer.setStatus(target.path, confirmation ? '已確認' : '退回', version);
      if (!result.ok) throw new Error(result.reason);
      confirmation = !confirmation;
      version = result;
    });
    await measure('寫入加快照更新（500 筆）', 7, async () => {
      const result = await writer.setStatus(target.path, confirmation ? '已確認' : '退回', version);
      if (!result.ok) throw new Error(result.reason);
      confirmation = !confirmation;
      version = result;
      if ((await warmReader.read()).listEntries().length !== count) throw new Error('合成資料筆數不符');
    });
  }, 60_000);
});

describe('節點搜尋（60 個側寫 + 500 筆判例）', () => {
  let nodeRoot: string;
  const nodes = 60;

  beforeAll(async () => {
    nodeRoot = await mkdtemp(join(tmpdir(), 'entropy-vault-node-bench-'));
    await mkdir(join(nodeRoot, 'nodes'), { recursive: true });
    await mkdir(join(nodeRoot, 'cases', 'bench'), { recursive: true });
    const paragraph = '比對資料來源與時間戳，整理任務紀錄並驗證處理順序。'.repeat(40);
    for (let index = 0; index < nodes; index++) {
      await writeFile(join(nodeRoot, 'nodes', '節點' + index + '.md'), [
        '---', '種類: node', '節點ID: bench-node-' + index, '節點: 節點' + index, '角色: art-' + (index % 7), '---',
        '# 節點' + index, '', '## 特長', '', '擅長第 ' + index + ' 類工作。', '', '## 任務紀錄', '', paragraph,
        '', '## 解決問題的流程', '', paragraph, '', '## 回顧', '', '回顧不參與搜尋。',
      ].join('\n'));
    }
    for (let index = 1; index <= count; index++) {
      await writeFile(join(nodeRoot, 'cases', 'bench', '2026-' + String(index).padStart(4, '0') + '.md'), [
        '---', '種類: case', '專案: bench', '節點ID: bench-node-' + index % nodes, '狀態: 已確認', '---', '摘要: 合成判例',
      ].join('\n'));
    }
  });

  afterAll(async () => {
    await rm(nodeRoot, { recursive: true, force: true });
  });

  it('量測第一次查詢（建立索引）與之後每次按鍵的查詢', async () => {
    const reader = new VaultReader(nodeRoot, now);
    await reader.read();
    // The first query on a snapshot builds the index; this is what every keystroke cost before the cache.
    const builds: number[] = [];
    for (let sample = 0; sample < 7; sample++) {
      reader.invalidate();
      const fresh = await reader.read();
      const start = performance.now();
      if (fresh.searchNodes('時間戳').length !== nodes) throw new Error('節點搜尋筆數不符');
      builds.push(performance.now() - start);
    }
    builds.sort((a, b) => a - b);
    console.log('新快照第一次查詢（建立索引）｜7 組｜中位數 ' + builds[3].toFixed(2) + ' ms｜範圍 ' +
      builds[0].toFixed(2) + '–' + builds[6].toFixed(2) + ' ms');
    const snapshot = await reader.read();
    snapshot.searchNodes('暖機');
    const queries = ['節', '節點', '節點1', '節點12', '時間', '時間戳', 'art', 'art-3'];
    await measure('同一快照連續 8 次按鍵查詢（合計）', 15, async () => {
      for (const query of queries) snapshot.searchNodes(query);
    });
  }, 60_000);
});
