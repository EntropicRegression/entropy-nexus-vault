import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GlowPeakStore } from './glow-peaks';

const vaultA = 'v_' + 'a'.repeat(24);
const vaultB = 'v_' + 'b'.repeat(24);
const scratch: string[] = [];

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'vault-glow-peaks-'));
  scratch.push(dir);
  let clock = Date.parse('2026-11-22T10:00:00.000Z');
  const file = join(dir, 'glow-peaks.json');
  return { dir, file, store: () => new GlowPeakStore(file, () => clock), tick: () => { clock += 60_000; } };
}

const counts = (entries: Record<string, [number, number]>) =>
  new Map(Object.entries(entries).map(([id, [completed, rejected]]) => [id, { completed, rejected }]));

afterEach(async () => {
  await Promise.all(scratch.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('userData/glow-peaks.json(docs/架構.md §9.2)', () => {
  it('只升不降:完成數下降時沿用峰值與當時的退回數;創新高才改寫', async () => {
    const { file, store } = await setup();
    const peaks = store();
    expect(await peaks.update(vaultA, counts({ n1: [40, 3] }))).toEqual(counts({ n1: [40, 3] }));
    const written = await readFile(file, 'utf8');
    expect(await peaks.update(vaultA, counts({ n1: [25, 1] }))).toEqual(counts({ n1: [40, 3] }));
    expect(await readFile(file, 'utf8')).toBe(written);
    expect(await peaks.update(vaultA, counts({ n1: [41, 6] }))).toEqual(counts({ n1: [41, 6] }));
    // A new process reads the stored peak.
    expect(await store().update(vaultA, counts({ n1: [10, 0] }))).toEqual(counts({ n1: [41, 6] }));
  });

  it('不同記憶庫各自記錄', async () => {
    const { store } = await setup();
    const peaks = store();
    await peaks.update(vaultA, counts({ shared: [50, 0] }));
    expect(await peaks.update(vaultB, counts({ shared: [5, 0] }))).toEqual(counts({ shared: [5, 0] }));
    expect(await peaks.update(vaultA, counts({ shared: [5, 0] }))).toEqual(counts({ shared: [50, 0] }));
  });

  it('損毀的檔以目前值重建;個別壞掉的項目略過,其餘保留', async () => {
    const { file, store } = await setup();
    await writeFile(file, '{ 這不是 JSON');
    expect(await store().update(vaultA, counts({ n1: [7, 1] }))).toEqual(counts({ n1: [7, 1] }));
    expect(JSON.parse(await readFile(file, 'utf8')).記憶庫[vaultA].n1).toMatchObject({ 完成數: 7, 退回數: 1 });

    await writeFile(file, JSON.stringify({ 版本: 1, 記憶庫: { [vaultA]: {
      good: { 完成數: 30, 退回數: 2, 記錄時間: '2026-11-20T00:00:00.000Z' },
      bad: { 完成數: -1, 退回數: 0, 記錄時間: 'x' },
    }, 'C:/not-a-key': {} } }));
    expect(await store().update(vaultA, counts({ good: [3, 0], bad: [4, 0] }))).toEqual(counts({ good: [30, 2], bad: [4, 0] }));
    const saved = JSON.parse(await readFile(file, 'utf8'));
    expect(Object.keys(saved.記憶庫)).toEqual([vaultA]);
  });

  it('讀不到(不是 ENOENT)時本次照算但不覆寫原檔', async () => {
    const { file, store } = await setup();
    await mkdir(file);
    expect(await store().update(vaultA, counts({ n1: [9, 0] }))).toEqual(counts({ n1: [9, 0] }));
  });

  it('內容沒有路徑:看起來像路徑的節點 ID 存成雜湊', async () => {
    const { file, store } = await setup();
    const legacy = 'legacy:nodes/C:/Users/Someone/夜苔.md';
    await store().update(vaultA, counts({ [legacy]: [12, 1], plain: [3, 0] }));
    const text = await readFile(file, 'utf8');
    expect(text).not.toMatch(/[a-z]:[\\/]|Users|nodes\//i);
    expect(Object.keys(JSON.parse(text).記憶庫[vaultA]).sort()).toEqual([expect.stringMatching(/^n_[a-f0-9]{64}$/), 'plain'].sort());
    expect(await store().update(vaultA, counts({ [legacy]: [1, 0] }))).toEqual(counts({ [legacy]: [12, 1] }));
  });
});
