import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { VaultReader } from './index';
import { redactForRenderer } from './privacy';
import { VaultWriter } from './write';

const fixture = resolve('fixtures/memory-vault');
const author = 'fixture-node-heron';
const other = 'fixture-node-moss';
const folder = 'memoirs/紙鷺-fixture-/';
const first = folder + '2026-11-18-觀測日報的第一課.md';
const second = folder + '2026-11-22-和夜苔交接的那一夜.md';
const third = folder + '2026-11-23-把溫室留給下一位.md';
const scratch: string[] = [];

afterEach(async () => {
  await Promise.all(scratch.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function copyVault() {
  const root = await mkdtemp(join(tmpdir(), 'nexus-vault-memoir-'));
  scratch.push(root);
  await cp(fixture, root, { recursive: true });
  return root;
}

function chapter(fields: string[], body: string) {
  return ['---', '種類: "回憶錄"', ...fields, '---', '', body, ''].join('\n');
}

describe('回憶錄卷宗', () => {
  it('重分類知識、偏好與回憶錄；回憶錄全域，支援三種涵蓋期間，並拆出章節與摘要', async () => {
    const vault = await new VaultReader(fixture).read();
    expect(new Set(vault.listEntries({ shelf: 'knowledge' }).map(({ kind }) => kind))).toEqual(new Set(['knowledge', 'preference']));
    expect(vault.listEntries({ shelf: 'archive' }).map(({ path }) => path)).toEqual([first, second, third]);
    const date = (value: string) => Date.parse(value + 'T00:00:00Z');
    expect(await vault.readEntry(first)).toMatchObject({
      kind: 'memoir', scope: '全域', projectId: '', projectName: '',
      memoir: { coverage: { start: date('2026-11-09'), end: date('2026-11-12') }, coverageText: '2026-11-09/2026-11-12' },
    });
    const detail = redactForRenderer(await vault.readEntry(second));
    expect(detail).toMatchObject({
      path: second,
      title: '和夜苔交接的那一夜', nodeId: author, nodeLabel: '紙鷺', participantNodeIds: [],
      updatedAt: Date.parse('2026-11-22T10:30:00Z'),
      memoir: { coverage: { start: date('2026-11-17'), end: null }, coverageText: '2026-11-17/' },
    });
    expect(detail?.summary).toMatch(/^夜苔把幾張/);
    expect(detail?.memoirSections).toMatchObject({
      body: expect.stringContaining('## 那一夜\n\n夜苔'),
      uncertain: expect.stringContaining('前一輪的採樣時間'),
      sources: expect.stringContaining('紙鷺的合成交接手記'),
    });
    expect(detail?.memoirSections?.body).not.toContain('## 來源');
    expect(detail?.caseReferences).toContain('cases/月汐溫室/2026-0001-補送資料以測點與採樣時間去重.md');
    expect((await vault.readEntry(third))?.memoir?.coverage).toEqual({ start: date('2026-11-21'), end: null });
  });

  it('只以節點 ID 歸章；節點換名、被取代、退回、無效期間、專案與參與資料都正確處理', async () => {
    const root = await copyVault();
    const renamed = 'memoirs/更名紙鷺-fixture-/';
    await mkdir(join(root, renamed), { recursive: true });
    const newer = renamed + '2026-11-23-改寫.md';
    const undated = renamed + '2026-11-01-不合法起日.md';
    const reversed = renamed + '2026-11-02-逆序期間.md';
    const write = (path: string, fields: string[], body = '合成內容。') => writeFile(join(root, path), chapter(fields, body));
    await write(newer, ['節點ID: ' + author, '節點: 更名紙鷺', '標題: 改寫', '狀態: 已確認', '涵蓋期間: "2026-11-09"',
      '取代: "[[' + first + ']]"', '範圍: 專案', '專案ID: C:/Synthetic/demo', '參與節點ID: [' + other + ']']);
    await write(undated, ['節點ID: ' + author, '標題: 不合法起日', '涵蓋期間: "2026-02-30"', '更新時間: 2026-11-01T00:00:00Z']);
    await write(reversed, ['節點ID: ' + author, '標題: 逆序期間', '涵蓋期間: "2026-11-05/2026-11-04"', '更新時間: 2026-11-02T00:00:00Z']);
    await write(renamed + '2026-11-19-別人的章.md', ['節點ID: ' + other, '節點: 紙鷺', '標題: 別人的章', '參與節點ID: [' + author + ']']);
    await write(renamed + '2026-11-19-缺少作者.md', ['nodeId: ' + author, '節點: 紙鷺', '標題: 缺少作者']);
    const legacy = 'knowledge/月汐溫室/舊知識.md';
    await write(legacy, ['節點ID: ' + author, '標題: 舊知識']);
    const vault = await new VaultReader(root).read();
    expect((await vault.readCrystal(author))?.memoirEntries?.map(({ path }) => path)).toEqual([newer, second, third, undated, reversed]);
    expect((await vault.readCrystal(other))?.memoirEntries?.map(({ title }) => title)).toEqual(['別人的章']);
    expect(await vault.readEntry(first)).toMatchObject({ superseded: true });
    expect(await vault.readEntry(newer)).toMatchObject({ previousCount: 1, scope: '全域', projectId: '', projectName: '', nodeIds: [author] });
    expect(await vault.readEntry(undated)).toMatchObject({ memoir: { coverage: null, coverageText: '2026-02-30' } });
    expect(await vault.readEntry(reversed)).toMatchObject({ memoir: { coverage: null, coverageText: '2026-11-05/2026-11-04' } });
    expect(await vault.readEntry(legacy)).toMatchObject({ kind: 'knowledge', shelf: 'knowledge' });
  });

  it('保留引用和程式碼內的標題，缺節仍可讀，私有路徑由 IPC 遮蔽', async () => {
    const root = await copyVault();
    const path = folder + '2026-11-24-合成.md';
    const localPath = 'C:\\Users\\Fictitious\\private.md';
    const body = ['## 來源', localPath, '## 回想', '真正的開頭。', '', '> ## 不確定之處', '> 這是引用',
      '', '~~~md', '## 來源', '這是程式碼', '~~~', '', '## 回顧', '回顧不能成為摘要。'].join('\n');
    await writeFile(join(root, path), chapter(['節點ID: ' + author], body));
    const detail = redactForRenderer(await (await new VaultReader(root).read()).readEntry(path));
    expect(detail).toMatchObject({ summary: '真正的開頭。', memoirSections: {
      uncertain: null, sources: '[本機路徑已隱藏]', body: expect.stringContaining('> ## 不確定之處'),
    } });
    expect(detail?.memoirSections?.body).toContain('~~~md\n## 來源');
    expect(detail?.memoirSections?.body).not.toContain('## 回顧');
    expect(JSON.stringify(detail)).not.toMatch(/[a-z]:[\\/]|Fictitious/i);
  });

  it('確認與退回只改狀態行，回收與撤銷保持位元組', async () => {
    const root = await copyVault();
    const reader = new VaultReader(root);
    const writer = new VaultWriter(root, () => reader.invalidate());
    const read = async () => (await reader.read()).readEntry(second);
    const fullPath = join(root, second);
    const before = await readFile(fullPath, 'utf8');
    const current = (await read())!;
    expect(await writer.setStatus(second, '已確認', current)).toMatchObject({ ok: true });
    expect(await readFile(fullPath, 'utf8')).toBe(before.replace('狀態: "未確認"', '狀態: "已確認"'));
    expect(await writer.setStatus(second, '退回', (await read())!)).toMatchObject({ ok: true });
    const expected = before.replace('狀態: "未確認"', '狀態: "退回"');
    expect(await readFile(fullPath, 'utf8')).toBe(expected);
    const recycled = await writer.moveToRecycle(second, (await read())!);
    expect(redactForRenderer(recycled)).toMatchObject({ ok: true, recycledPath: '_回收/' + second, originalPath: second });
    if (!recycled.ok) throw new Error(recycled.reason);
    expect(await read()).toBeNull();
    expect(await writer.restoreFromRecycle(recycled.recycledPath, recycled)).toMatchObject({ ok: true });
    expect(await readFile(fullPath, 'utf8')).toBe(expected);
  });
});
