import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { VaultReader } from './index';
import { opaqueKey } from './privacy';
import { folderAliases } from './project-aliases';
import { readSidecars } from './sidecars';

const scratch: string[] = [];
afterEach(async () => {
  await Promise.all(scratch.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('同一個實際資料夾的專案合併(使用者 2026-11-28)', () => {
  it('實際路徑相同才合併,保留路徑本身就是實際資料夾的那個;解析不到或不是路徑的不動', () => {
    const real = 'C:/work/agent lobby', link = 'C:/work/test', other = 'C:/work/other';
    const resolve = (path: string) => ({ [real]: 'C:\\work\\agent lobby', [link]: 'C:\\work\\agent lobby', [other]: 'C:\\work\\other' })[path] ?? null;
    expect(folderAliases([link, real, other, 'C:/gone', '專案名稱'], resolve))
      .toEqual(new Map([[opaqueKey('p', link), opaqueKey('p', real)]]));
    // Once the link is gone (resolves to itself or not at all) nothing is merged; nothing was remembered.
    expect(folderAliases([link, real], (path) => path === real ? 'C:\\work\\agent lobby' : null)).toEqual(new Map());
  });

  it('統計檔與記憶庫:連結到同一資料夾的兩個專案合併成一個,節點任務數相加,舊專案ID 的判例歸到保留的專案', async () => {
    const base = await mkdtemp(join(tmpdir(), 'vault-alias-'));
    scratch.push(base);
    const lobby = join(base, 'agent lobby'), old = join(base, 'test');
    await mkdir(lobby);
    await symlink(lobby, old, 'junction');
    const root = join(base, 'vault');
    await mkdir(join(root, 'cases', 'test'), { recursive: true });
    const node = {
      名稱: '甲', 狀態: '線上', 任務數: 9, 完成數: 9, 完成率: 1, 驗收數: 9, 退回數: 0, 判例數: 1,
      專案: ['agent lobby', 'test'], 專案ID: [lobby, old], 專案任務數: [2, 7], session: { 後台: 'Claude Code', sessionId: null },
    };
    await writeFile(join(root, '.nexus-stats.json'), JSON.stringify({
      更新時間: '2026-11-28T00:00:00.000Z', 圖像目錄: '', 節點: { n1: node }, 協作: [], 同席: [],
      專案表: { [lobby]: { 名稱: 'agent lobby', 類型: '資料夾' }, [old]: { 名稱: 'test', 類型: '資料夾' } },
    }));
    await writeFile(join(root, 'cases', 'test', '2026-0001-舊判例.md'), ['---', '案號: 2026-0001', '案由: 舊判例', '種類: case',
      '範圍: 專案', '專案ID: ' + old.replace(/\\/g, '/'), '專案: test', '節點ID: n1', '狀態: 已確認', '---', '', '內容', ''].join('\n'));

    const stats = (await readSidecars(root, { heat: new Map(), stats: null })).snapshot.stats!;
    const kept = opaqueKey('p', lobby);
    expect([...stats.projectTypes!.keys()]).toEqual([kept]);
    expect(stats.projectAliases).toEqual(new Map([[opaqueKey('p', old), kept]]));
    expect(stats.nodes.get('n1')!.projects).toEqual([{ key: kept, name: 'agent lobby', hasProjectId: true, recentTasks: 9 }]);
    expect(stats.nodes.get('n1')!.projectNames).toEqual(['agent lobby']);

    const vault = await new VaultReader(root).read();
    expect(vault.listEntries({}).find((entry) => entry.caseId === '2026-0001')).toMatchObject({ projectId: kept, projectName: 'agent lobby' });
    expect(vault.galaxyInput(new Set())!.projects.size).toBe(1);
  });
});
