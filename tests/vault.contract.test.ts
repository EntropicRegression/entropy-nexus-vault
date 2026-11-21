import { copyFile, cp, mkdir, mkdtemp, readFile, rename, rm, stat, unlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { VaultReader } from '../src/main/vault';
import { heatFilename, statsFilename } from '../src/main/vault/sidecars';

const fixture = resolve('fixtures/memory-vault');
const malformedStats = resolve('fixtures/malformed-stats', statsFilename);
const now = () => Date.parse('2026-11-21T08:00:00.000Z');
const casePaths = [
  'cases/月汐溫室/2026-0001-補送資料以測點與採樣時間去重.md',
  'cases/月汐溫室/2026-0002-日報按採樣日期歸檔.md',
  'cases/月汐溫室/2026-0003-缺測時沿用前次讀值.md',
];
const knowledge = (name: string) => 'knowledge/月汐溫室/' + name + '.md';
const decisions = ['開窗期間每分鐘採樣', '每五分鐘採樣', '每十分鐘採樣'].map(knowledge);
const archives = ['nodes/封存/夜苔-2026-11-18.md', 'nodes/封存/夜苔-2026-11-12.md'];
const moss = 'fixture-node-moss';
const heron = 'fixture-node-heron';

const scratchDirs: string[] = [];

async function copyVault(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'entropy-vault-contract-'));
  scratchDirs.push(root);
  await cp(fixture, root, { recursive: true });
  return root;
}

afterEach(async () => {
  await Promise.all(scratchDirs.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('記憶庫唯讀契約', () => {
  it('掃描四類記憶、排除附屬目錄與暫存檔，並保留各種判例和書籤狀態', async () => {
    const snapshot = await new VaultReader(fixture, now).read();
    const entries = snapshot.listEntries({ includeSuperseded: true });

    expect(entries).toHaveLength(12);
    expect(new Set(entries.map(({ kind }) => kind))).toEqual(new Set(['node', 'case', 'knowledge', 'preference']));
    expect(entries.every(({ path }) => !path.includes('/_') && !path.endsWith('.tmp'))).toBe(true);
    expect(snapshot.listEntries({ kind: 'case' }).map(({ status }) => status)).toEqual(['已確認', '未確認', '退回']);
    expect(snapshot.listEntries({ kind: 'case', status: '未確認' }).map(({ path }) => path)).toEqual([casePaths[1]]);
    expect(snapshot.listEntries({ kind: 'case', nodeId: moss }).map(({ path }) => path)).toEqual([casePaths[0]]);
    expect(snapshot.listEntries({ subtype: '書籤', status: '未完' }).map(({ path }) => path)).toEqual([knowledge('補齊開窗前後的讀值')]);
    expect(snapshot.listEntries({ subtype: '書籤', status: '已完成' })[0]).toMatchObject({
      path: knowledge('確認測點代號'), projectId: expect.stringMatching(/^p_[a-f0-9]{24}$/), nodeId: moss,
      updatedAt: Date.parse('2026-11-12T04:30:00.000Z'),
    });

    const legacy = await snapshot.readEntry(casePaths[2]);
    const file = await stat(join(fixture, casePaths[2]));
    expect(legacy).toMatchObject({
      kind: 'case', projectId: expect.stringMatching(/^p_[a-f0-9]{24}$/), caseId: '2026-0003', status: '退回', summary: '',
      attributes: expect.arrayContaining([['改過的檔案', ['src/gaps.ts']]]), mtime: file.mtimeMs, size: file.size,
    });
    expect(await snapshot.readEntry('preferences/報表時間格式.md')).toMatchObject({
      title: '報表時間格式使用二十四小時制', kind: 'preference', scope: '全域', attributes: [],
    });
    expect(await snapshot.readEntry('nodes/封存/_圖像/fixture-node-moss/掃描排除測試.md')).toBeNull();
    expect(await snapshot.readEntry('knowledge/月汐溫室/待發布.md.tmp')).toBeNull();
  });

  it('沿取代鏈解析三代決策、解析先例案號，全文搜尋排除回顧', async () => {
    const snapshot = await new VaultReader(fixture, now).read();

    expect(snapshot.listEntries({ subtype: '決策' }).map(({ path }) => path)).toEqual([decisions[0]]);
    expect(await snapshot.readEntry(decisions[0])).toMatchObject({
      previousCount: 2,
      supersessionChain: [
        { path: decisions[1], status: 'available', updatedAt: expect.any(Number) },
        { path: decisions[2], status: 'available' },
      ],
    });
    expect(await snapshot.readEntry(decisions[1])).toMatchObject({ superseded: true });
    expect(await snapshot.readEntry(casePaths[1])).toMatchObject({ caseReferences: [casePaths[0]] });

    const confirmed = await snapshot.readEntry(casePaths[0]);
    expect(confirmed?.summary).toContain('唯一鍵');
    expect(confirmed?.review).toContain('促成了複合唯一鍵');
    expect(confirmed?.body).not.toContain('## 回顧');
    expect(snapshot.search('促成了複合唯一鍵')).toEqual([]);
    expect(snapshot.search('午夜 報表', { kind: 'case' }).map(({ path }) => path)).toEqual([casePaths[1]]);
    expect(snapshot.search('2026-0003', { kind: 'case' }).map(({ path }) => path)).toEqual([casePaths[2]]);
  });

  it('保留屬性原順序、非判例取第一段摘要，並搜尋關鍵字、案由與節點名', async () => {
    const root = await copyVault();
    const path = knowledge('書架契約');
    const paragraph = '雪光'.repeat(43);
    await writeFile(join(root, path), [
      '---', '3000: 最先', '1000: 其次', '標題: 書架契約', '案由: 斷面水流',
      '關鍵字: [青松閥, 細流]', '節點ID: ' + moss, '參與節點ID: [' + heron + ', ' + moss + ', ' + heron + ']',
      '狀態: 未確認', '---',
      '# 不是摘要', '', '~~~md', '程式碼不是摘要', '~~~', '## 記錄', '', paragraph,
      '', '第二段不放在摘要。', '', '## 回顧', '回顧關鍵字不參與搜尋。',
    ].join('\n'));
    const snapshot = await new VaultReader(root, now).read();
    const note = await snapshot.readEntry(path);
    expect(note).toMatchObject({ summary: paragraph.slice(0, 80), shelf: 'archive', nodeIds: [moss, heron] });
    expect(note?.attributes.slice(0, 2)).toEqual([['3000', '最先'], ['1000', '其次']]);
    expect(snapshot.search('青松閥 斷面水流', { shelf: 'archive', status: ['未確認', '退回'] }).map((entry) => entry.path)).toEqual([path]);
    expect(snapshot.search('紙鷺', { shelf: 'archive' }).map((entry) => entry.path)).toEqual([path]);
    expect(snapshot.search('回顧關鍵字')).toEqual([]);
    expect(snapshot.listEntries({ kind: 'node' }).every((entry) => entry.shelf === null)).toBe(true);
  });

  it('節點搜尋比對名稱、角色、特長與側寫正文,不搜回顧;依符合欄位排序', async () => {
    const root = await copyVault();
    await writeFile(join(root, 'nodes', '星砂.md'), [
      '---', '種類: node', '節點ID: fixture-node-sand', '節點: 星砂', '角色: 潮汐校對', '---',
      '# 星砂', '', '## 特長', '', '擅長比對潮位曲線。', '', '## 解決問題的流程', '', '先查鹽度計再對時。',
      '', '## 回顧', '', '回顧專屬詞不參與搜尋。',
    ].join('\n'));
    const snapshot = await new VaultReader(root, now).read();
    const ids = (query: string) => snapshot.searchNodes(query).map(({ nodeId }) => nodeId);
    expect(snapshot.searchNodes('星砂')).toEqual([{ nodeId: 'fixture-node-sand', name: '星砂', role: '潮汐校對', status: '未知', matchedIn: '名稱' }]);
    expect(snapshot.searchNodes('潮汐')[0]).toMatchObject({ nodeId: 'fixture-node-sand', matchedIn: '立繪角色' });
    expect(snapshot.searchNodes('潮位曲線')[0]).toMatchObject({ matchedIn: '特長' });
    expect(snapshot.searchNodes('鹽度計')[0]).toMatchObject({ matchedIn: '側寫' });
    expect(ids('星砂 鹽度計')).toEqual(['fixture-node-sand']);
    expect(ids('回顧專屬詞')).toEqual([]);
    expect(ids('   ')).toEqual([]);
    expect(snapshot.searchNodes(42 as unknown as string)).toEqual([]);
    // S5: the lower-cased fields are built once per snapshot and reused by later keystrokes.
    const index = (snapshot as unknown as { nodeSearchIndex: unknown }).nodeSearchIndex;
    expect(index).toBeDefined();
    snapshot.searchNodes('星砂');
    expect((snapshot as unknown as { nodeSearchIndex: unknown }).nodeSearchIndex).toBe(index);
    const next = await new VaultReader(root, now).read();
    expect((next as unknown as { nodeSearchIndex?: unknown }).nodeSearchIndex).toBeUndefined();
  });

  it('依封存時間合併同節點的兩份檔，另保留接回的新 ID 與四種連線', async () => {
    const root = await copyVault();
    await utimes(join(root, archives[1]), new Date('2030-01-01'), new Date('2030-01-01'));
    const snapshot = await new VaultReader(root, now).read();
    const result = snapshot.listCrystals();

    expect(result.crystals.map(({ nodeId }) => nodeId).sort()).toEqual([heron, moss].sort());
    expect(result.links).toEqual(expect.arrayContaining([
      { kind: 'lineage', from: moss, to: heron },
      { kind: 'delegate', from: moss, to: heron, count: 2, lastAt: '2026-11-17T06:00:00.000Z' },
      { kind: 'meeting', nodeIds: [heron, moss], count: 1 },
      { kind: 'project', projectKey: expect.stringMatching(/^p_/), projectName: '月汐溫室', nodeIds: expect.arrayContaining([heron, moss]) },
    ]));
    expect(await snapshot.readCrystal(moss)).toMatchObject({
      name: '夜苔', status: '封存', canWake: true, profile: { path: archives[0] },
      stats: { tasks: 4, completed: 3, completionRate: 0.75 },
      archives: [
        { path: archives[0], archivedAt: '2026-11-18 17:00' },
        { path: archives[1], archivedAt: '2026-11-12 16:30' },
      ],
      relatedEntries: [{ path: casePaths[0] }],
    });
  });

  it('支援省略副檔名、檔名別名、回收狀態及補充段落第一行的傳承', async () => {
    const root = await copyVault();
    const replacement = knowledge('額外決策');
    const recycledPath = knowledge('已回收的舊稿');
    const recycled = join(root, '_回收', recycledPath);
    await mkdir(join(root, '_回收', 'knowledge', '月汐溫室'), { recursive: true });
    await writeFile(recycled, '# 回收稿');
    await writeFile(join(root, replacement), [
      '---',
      '標題: 額外決策',
      'supersedes: [[開窗期間每分鐘採樣|前版]], [[knowledge/月汐溫室/已回收的舊稿]], [[遺失稿]]',
      '---',
      '內文',
    ].join('\n'));
    await writeFile(join(root, 'nodes/紙鷺.md'), [
      '---', 'kind: node', 'nodeId: ' + heron, '---',
      '## 主控台補充(2026-11-21 06:00)', '', '接回自:' + archives[1],
    ].join('\n'));

    const snapshot = await new VaultReader(root, now).read();
    expect(snapshot.listCrystals().links).toContainEqual({ kind: 'lineage', from: moss, to: heron });
    expect(await snapshot.readEntry(replacement)).toMatchObject({
      supersessionChain: [
        { path: decisions[0], status: 'available' },
        { path: decisions[1], status: 'available' },
        { path: decisions[2], status: 'available' },
        { path: recycledPath, status: 'recycled' },
        { path: knowledge('遺失稿'), status: 'missing' },
      ],
    });
    expect(snapshot.listEntries({ includeSuperseded: true }).some(({ path }) => path === recycledPath)).toBe(false);
  });

  it('統計有效 → 損毀時保留上一份；熱度獨立更新；修復後採用新統計', async () => {
    const root = await copyVault();
    const reader = new VaultReader(root, now);
    const initial = await reader.read();
    const baseline = initial.sidecars.stats;
    expect(baseline?.updatedAt).toBe('2026-11-21T08:00:00.000Z');
    expect(await initial.readEntry(casePaths[0])).toMatchObject({ heat: { count: 5, level: 'flaming' } });
    expect(await initial.readEntry(casePaths[1])).toMatchObject({ heat: { count: 0, level: 'ember' } });
    expect(await initial.readEntry(knowledge('確認測點代號'))).toMatchObject({ heat: { count: 1, level: 'tepid' } });
    expect(await initial.readEntry(decisions[0])).toMatchObject({ heat: { count: 4, level: 'temperate' } });
    expect(await initial.readEntry(decisions[2])).toMatchObject({ heat: { count: 6, level: 'temperate' } });

    await copyFile(malformedStats, join(root, statsFilename));
    await writeFile(join(root, heatFilename), JSON.stringify({
      [casePaths[0]]: { 召回次數: 2, 最後召回: '2026-11-21T06:00:00.000Z' },
    }));
    const duringFailure = await reader.read();
    expect(duringFailure.sidecars.stats).toBe(baseline);
    expect(await duringFailure.readCrystal(moss)).toMatchObject({ stats: { tasks: 4 } });
    expect(await duringFailure.readEntry(casePaths[0])).toMatchObject({ heat: { count: 2, level: 'tepid' } });
    const noHistory = await new VaultReader(root, now).read();
    expect(noHistory.sidecars.stats).toBeNull();
    expect(await noHistory.readCrystal(moss)).toMatchObject({ stats: { tasks: 4 }, canWake: false });

    const repaired = (await readFile(join(fixture, statsFilename), 'utf8'))
      .replace('2026-11-21T08:00:00.000Z', '2026-11-21T08:10:00.000Z')
      .replace('"任務數": 4', '"任務數": 5');
    await writeFile(join(root, statsFilename), repaired);
    await writeFile(join(root, heatFilename), '{');
    const afterRepair = await reader.read();
    expect(afterRepair.sidecars.stats?.updatedAt).toBe('2026-11-21T08:10:00.000Z');
    expect(await afterRepair.readCrystal(moss)).toMatchObject({ stats: { tasks: 5 } });
    expect(await afterRepair.readEntry(casePaths[0])).toMatchObject({ heat: { count: 2, level: 'tepid' } });
  });

  it('統計與熱度更新只略過不合格的單筆資料', async () => {
    const root = await copyVault();
    const reader = new VaultReader(root, now);
    const initial = await reader.read();
    const originalStats = JSON.parse(await readFile(join(root, statsFilename), 'utf8'));
    await writeFile(join(root, statsFilename), JSON.stringify({
      ...originalStats,
      更新時間: '2026-11-21T08:20:00.000Z',
      節點: {
        [moss]: { ...originalStats.節點[moss], 完成率: 75 },
        [heron]: { ...originalStats.節點[heron], 任務數: 8 },
      },
      協作: [{ 從: moss, 到: heron, 最後: '2026-11-17T06:00:00.000Z' }, ...originalStats.協作],
      同席: [{ 節點: [moss, heron], 次數: -1 }, ...originalStats.同席],
    }));
    await writeFile(join(root, heatFilename), JSON.stringify({
      [casePaths[0]]: { 召回次數: 1, 最後召回: '2026-11-21T06:00:00.000Z' },
      [decisions[0]]: { 召回次數: '不合格' },
    }));

    const updated = await reader.read();
    expect(updated.sidecars.stats).not.toBe(initial.sidecars.stats);
    expect([...updated.sidecars.stats!.nodes.keys()]).toEqual([heron]);
    expect(await updated.readCrystal(heron)).toMatchObject({ stats: { tasks: 8 } });
    expect(updated.listCrystals().links.filter(({ kind }) => kind === 'delegate' || kind === 'meeting')).toEqual([
      { kind: 'delegate', from: moss, to: heron, count: 2, lastAt: '2026-11-17T06:00:00.000Z' },
      { kind: 'meeting', nodeIds: [heron, moss], count: 1 },
    ]);
    expect(await updated.readEntry(casePaths[0])).toMatchObject({ heat: { count: 1, level: 'tepid' } });
    expect(updated.sidecars.heat.has(casePaths[1])).toBe(false);
    expect(updated.sidecars.heat.has(decisions[0])).toBe(false);
    await writeFile(join(root, statsFilename), JSON.stringify({ ...originalStats, 同席: null }));
    await writeFile(join(root, heatFilename), '[]');
    const invalidRoot = await reader.read();
    expect(invalidRoot.sidecars.stats).toBe(updated.sidecars.stats);
    expect(invalidRoot.sidecars.heat).toBe(updated.sidecars.heat);
  });

  it('快照命中、手動失效及檔案新增、編輯、改名與刪除', async () => {
    const root = await copyVault();
    const reader = new VaultReader(root, now);
    const initial = await reader.read();
    expect(await reader.read()).toBe(initial);
    reader.invalidate();
    const fresh = await reader.read();
    expect(fresh).not.toBe(initial);
    const preference = 'preferences/報表時間格式.md';
    const target = join(root, preference);
    const updated = '# 改用固定時區\n';
    await writeFile(target, updated);
    await utimes(target, new Date('2030-01-01'), new Date('2030-01-01'));
    expect(await (await reader.read()).readEntry(preference)).toMatchObject({ title: '改用固定時區' });

    const added = 'preferences/新記憶.md';
    await writeFile(join(root, added), '# 新記憶');
    expect(await (await reader.read()).readEntry(added)).toMatchObject({ title: '新記憶' });
    const renamed = 'preferences/更名.md';
    await rename(join(root, added), join(root, renamed));
    const afterRename = await reader.read();
    expect(await afterRename.readEntry(added)).toBeNull();
    expect(await afterRename.readEntry(renamed)).toMatchObject({ title: '新記憶' });
    await unlink(join(root, renamed));
    expect(await (await reader.read()).readEntry(renamed)).toBeNull();
  });

  it('檔案未變也會在召回超過 30 天時更新熱度', async () => {
    const edge = Date.parse('2026-12-21T05:30:00.000Z');
    let clock = edge - 1;
    const reader = new VaultReader(fixture, () => clock);
    const initial = await reader.read();
    expect(await initial.readEntry(casePaths[0])).toMatchObject({ heat: { count: 5, level: 'flaming' } });
    clock = edge;
    expect(await reader.read()).toBe(initial);
    clock = edge + 1;
    expect(await (await reader.read()).readEntry(casePaths[0])).toMatchObject({ heat: { count: 5, level: 'temperate' } });
  });

  it('舊卷宗保留承辦名稱，節點 ID 與名稱各自篩選', async () => {
    const snapshot = await new VaultReader(fixture, now).read();
    const legacyLabel = '灰礫(Claude Code · fixture-model)';
    expect(await snapshot.readEntry(casePaths[2])).toMatchObject({ nodeId: '', nodeLabel: legacyLabel });
    expect(await snapshot.readEntry(casePaths[0])).toMatchObject({
      nodeId: moss,
      nodeLabel: '夜苔(Claude Code · fixture-model)',
    });
    expect(snapshot.listEntries({ nodeId: legacyLabel })).toEqual([]);
    expect(snapshot.listEntries({ nodeLabel: legacyLabel }).map(({ path }) => path)).toEqual([casePaths[2]]);
  });
});

describe('主控台 stats 契約(仿 buildVaultStats 目前輸出)', () => {
  const consoleStats = resolve('fixtures/console-stats');
  const id = (n: number) => '0b6f1c2e-0000-4000-8000-00000000000' + n;

  it('解析不丟節點:null 欄位、缺 專案ID 的舊版節點與協作、同席都保留', async () => {
    const snapshot = await new VaultReader(consoleStats, now).read();
    expect(snapshot.sidecars.stats?.nodes.size).toBe(5);
    const { crystals, links } = snapshot.listCrystals();
    expect(crystals.map((crystal) => crystal.nodeId).sort()).toEqual([1, 2, 3, 4, 5].map(id));
    expect(crystals.find((crystal) => crystal.nodeId === id(2))).toMatchObject({ role: null, status: '休眠', canWake: false });
    expect(crystals.find((crystal) => crystal.nodeId === id(4))).toMatchObject({ status: '封存', canWake: true, projectNames: ['舊專案'] });
    expect(links).toEqual(expect.arrayContaining([
      { kind: 'delegate', from: id(1), to: id(2), count: 3, lastAt: '2026-11-21T10:00:00.000Z' },
      { kind: 'meeting', nodeIds: [id(1), id(3)], count: 2 },
    ]));
    const third = await snapshot.readCrystal(id(3));
    expect(third).toMatchObject({ stats: { completed: 0, rejected: 0, completionRate: null }, notRejectedRate: null });
    expect((await snapshot.readCrystal(id(1)))?.notRejectedRate).toBeCloseTo(0.9);
  });

  it('同專案以 專案ID 分組:同名不同 ID 不連線、同 ID 連線、舊版退回用名稱;代號不含原始路徑', async () => {
    const snapshot = await new VaultReader(consoleStats, now).read();
    const projectLinks = snapshot.listCrystals().links.filter((link) => link.kind === 'project');
    expect(projectLinks.map((link) => link.kind === 'project' && [link.projectName, [...link.nodeIds].sort()])).toEqual(
      expect.arrayContaining([['共用庫', [id(1), id(3)]], ['舊專案', [id(4), id(5)]]]));
    expect(projectLinks.some((link) => link.kind === 'project' && link.projectName === 'app')).toBe(false);
    for (const link of projectLinks) if (link.kind === 'project') expect(link.projectKey).toMatch(/^p_[a-f0-9]{24}$/);
    expect(JSON.stringify(snapshot.listCrystals())).not.toMatch(/synthetic|[a-z]:\//i);
  });

  it('經歷計分的輸入:完成/退回取統計(驗收數不用),跨專案以 專案ID 代號去重,舊版退回用名稱', async () => {
    const snapshot = await new VaultReader(consoleStats, now).read();
    const inputs = snapshot.richnessInputs();
    // Two projects named "app" with different IDs count as two.
    expect(inputs.get(id(1))).toEqual({ confirmedCases: 0, participatedCases: 0, completedNow: 10, rejectedNow: 1, projects: 2 });
    expect(inputs.get(id(4))).toMatchObject({ completedNow: 2, rejectedNow: 0, projects: 1 });
    expect(inputs.get(id(3))).toMatchObject({ completedNow: 0, projects: 1 });
  });

  it('封存節點沒有統計專案時,跨專案改用其已確認判例的專案;判例數由寶庫自己計', async () => {
    const root = await copyVault();
    await unlink(join(root, statsFilename));
    const snapshot = await new VaultReader(root, now).read();
    const confirmedHandled = snapshot.listEntries({ kind: 'case', status: '已確認' }).filter((entry) => entry.nodeId === moss);
    const input = snapshot.richnessInputs().get(moss)!;
    expect(input.confirmedCases).toBe(confirmedHandled.length);
    expect(input.projects).toBe(new Set(snapshot.listEntries({ kind: 'case', status: '已確認' })
      .filter((entry) => entry.nodeIds.includes(moss)).map((entry) => entry.projectId).filter(Boolean)).size);
    expect(input.projects).toBeGreaterThan(0);
  });

  it('沒有統計檔時,只有現役側寫的節點顯示「未知」,封存檔仍是封存', async () => {
    const root = await copyVault();
    await unlink(join(root, statsFilename));
    const { crystals } = (await new VaultReader(root, now).read()).listCrystals();
    expect(crystals.find((crystal) => crystal.nodeId === heron)?.status).toBe('未知');
    expect(crystals.find((crystal) => crystal.nodeId === moss)?.status).toBe('封存');
  });
});
