import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { VaultReader } from '../src/main/vault';

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
});
