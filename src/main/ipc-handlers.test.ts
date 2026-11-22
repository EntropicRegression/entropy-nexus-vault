import { copyFile, cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { appUrl } from './app-assets';
import { isVaultFrameUrl, registerVaultIpc } from './ipc-handlers';
import { readVaultPath, readViewSettings, saveVaultPath, saveViewSettings } from './settings';
import { serveVaultImage } from './images';
import { opaqueKey } from './vault/privacy';
import { vaultChannels } from '../shared/ipc';
import type { VaultRequests } from '../shared/ipc';

const electron = vi.hoisted(() => ({
  userData: '',
  handle: vi.fn<(channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => void>(),
  registered: vi.fn((_url: string) => ''),
  openExternal: vi.fn(async (_url: string) => {}),
  showOpenDialog: vi.fn(async (_parent: unknown, _options: unknown): Promise<{ canceled: boolean; filePaths: string[] }> =>
    ({ canceled: true, filePaths: [] })),
}));

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => resolve('.'),
    getPath: () => electron.userData,
    getApplicationNameForProtocol: electron.registered,
  },
  dialog: { showOpenDialog: electron.showOpenDialog },
  ipcMain: { handle: electron.handle },
  shell: { openExternal: electron.openExternal },
}));

afterEach(async () => {
  electron.handle.mockClear();
  electron.registered.mockReset();
  electron.openExternal.mockReset();
  electron.showOpenDialog.mockReset();
  if (electron.userData) {
    await rm(electron.userData, { recursive: true, force: true });
    electron.userData = '';
  }
});

describe('主程序 IPC 來源驗證', () => {
  it('M5d 回傳正確側寫與補充分節，編輯原路徑只留在主程序', async () => {
    electron.userData = await mkdtemp(join(tmpdir(), 'nexus-profile-ipc-'));
    const vault = join(electron.userData, 'sky');
    await cp(resolve('fixtures/sky-vault'), vault, { recursive: true });
    await saveVaultPath(join(electron.userData, 'settings.dev.json'), vault);
    const nodeId = 'fixture-sky-iris';
    const live = 'nodes/稜鏡.md';
    const archived = 'nodes/封存/稜鏡-2026-11-21.md';
    const latest = 'nodes/封存/稜鏡-2026-11-21-2.md';
    const archivedBytes = await readFile(join(vault, archived));
    await writeFile(join(vault, latest), archivedBytes.toString('utf8').replace('擅長核對合成脈衝的時間戳。', '同日較晚的封存。'));
    const privateBody = [
      '---', '種類: node', '節點ID: ' + nodeId, '工作目錄: C:\\Users\\SyntheticHeader\\secret', '---',
      '', '## 特長', '', '現役使用者版第一句。第二句。', '看「C:\\Users\\SyntheticBody\\private.md」。',
      '', '## 回顧', '', '編輯者回顧「/home/SyntheticReview/hidden.md」', '', '## 主控台補充(2026-11-22 08:00)', '',
      '見 /Users/SyntheticAppendix/hidden.md', '## 特長', '主控台不能替代。', '',
      '## 回顧', '', '補充回顧「C:\\Users\\SyntheticReview\\appendix.md」', '',
      '## 主控台補充(2026-11-23 08:00)', '', '第二份補充', '',
    ].join('\n');
    await writeFile(join(vault, live), privateBody);
    await writeFile(join(vault, 'nodes', '無統計.md'), '---\n種類: node\n節點ID: nostats\n---\n\n## 特長\n真實側寫但無統計。\n');
    const sender = {};
    registerVaultIpc(() => ({ webContents: sender }) as BrowserWindow);
    const event = { sender, senderFrame: { url: appUrl, parent: null } };
    function invoke<M extends keyof VaultRequests>(method: M, ...args: Parameters<VaultRequests[M]>): ReturnType<VaultRequests[M]> {
      return electron.handle.mock.calls.find(([channel]) => channel === vaultChannels[method])![1](event, ...args) as ReturnType<VaultRequests[M]>;
    }
    const read = await invoke('readNodeProfile', nodeId);
    expect(read).toMatchObject({
      source: { kind: 'live', path: live, archivedAt: null },
      body: expect.stringContaining('現役使用者版第一句。'),
      review: '編輯者回顧「[本機路徑已隱藏]」',
      consoleAppendixCount: 2,
      consoleAppendices: [
        { at: '2026-11-22 08:00', localTime: expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}（本機時間）$/),
          text: '見 [本機路徑已隱藏]\n## 特長\n主控台不能替代。', review: '補充回顧「[本機路徑已隱藏]」' },
        { at: '2026-11-23 08:00', text: '第二份補充', review: '' },
      ],
    });
    expect(read?.body).not.toMatch(/回顧|第二份補充/);
    expect((await invoke('listCrystals')).crystals.find((crystal) => crystal.nodeId === nodeId)?.specialty).toBe('現役使用者版第一句。');
    expect(await invoke('readCrystal', nodeId)).toMatchObject({ specialty: '現役使用者版第一句。', consoleAppendixCount: 2 });
    const draft = await invoke('readProfileForEdit', nodeId);
    if (!draft.ok) throw Error(draft.reason);
    expect(draft.body).toContain('看「⟦路徑1⟧」');
    expect(draft.body).toContain('編輯者回顧');
    expect(draft.body).not.toContain('第二份補充');
    expect(Object.keys(draft).sort()).toEqual(['archiveNotice', 'body', 'isArchive', 'ok', 'version']);
    expect(draft).toMatchObject({ isArchive: false, archiveNotice: null });
    expect(Object.keys(draft.version).sort()).toEqual(['editToken', 'identity', 'mtime', 'size']);
    const missing = await invoke('saveProfileBody', nodeId, draft.body.replace('⟦路徑1⟧', ''), draft.version);
    expect(missing).toMatchObject({ ok: false, reason: 'invalid-placeholders', issue: 'missing', missingPlaceholders: [1],
      message: expect.stringMatching(/#1.*永久移除/) });
    const save = await invoke('saveProfileBody', nodeId, draft.body.replace('現役使用者版第一句。', '新第一句。'), draft.version);
    expect(save).toMatchObject({ ok: true });
    expect(await readFile(join(vault, live), 'utf8')).toEqual(privateBody.replace('現役使用者版第一句。', '新第一句。'));
    expect((await invoke('readCrystal', nodeId))?.specialty).toBe('新第一句。');
    expect(JSON.stringify([read, draft, save, missing, await invoke('readCrystal', nodeId)]))
      .not.toMatch(/(?<![a-z0-9-])[a-z]:[\\/]|\/(?:Users|home)\/|Synthetic(?:Header|Body|Appendix|Review)/i);
    if (!save.ok) throw Error(save.reason);
    const removedBody = draft.body.replace('現役使用者版第一句。', '新第一句。').replace('看「⟦路徑1⟧」。', '');
    expect(await invoke('saveProfileBody', nodeId, removedBody, save.version, { acknowledgedRemovals: [1] })).toMatchObject({ ok: true });
    const editedBytes = await readFile(join(vault, live), 'utf8');
    expect(editedBytes).not.toContain('SyntheticBody');
    expect(editedBytes).toContain('編輯者回顧「/home/SyntheticReview/hidden.md」');

    expect(await invoke('readNodeProfile', 'nostats')).toMatchObject({ body: expect.stringContaining('真實側寫但無統計。') });
    expect(await invoke('readCrystal', 'nostats')).toMatchObject({ stats: null, status: '未知' });
    expect(await invoke('readNodeProfile', 'fixture-sky-dawn')).toBeNull();
    expect(await invoke('readProfileForEdit', 'fixture-sky-dawn')).toEqual({ ok: false, reason: 'missing' });
    expect(await invoke('readProfileForEdit', 'cases/其他.md')).toEqual({ ok: false, reason: 'missing' });
    await rm(join(vault, live));
    expect(await invoke('readNodeProfile', nodeId)).toMatchObject({
      source: { kind: 'archived', path: latest, archivedAt: '2026-11-21 08:00' },
      body: expect.stringContaining('同日較晚的封存。'),
    });
    const archivedDraft = await invoke('readProfileForEdit', nodeId);
    if (!archivedDraft.ok) throw Error(archivedDraft.reason);
    expect(archivedDraft).toMatchObject({ isArchive: true, archiveNotice: '這份是封存檔，修改會在日後接回時帶進新節點。' });
    expect(await invoke('saveProfileBody', nodeId, archivedDraft.body.replace('同日較晚的封存。', '編輯最新封存。'), archivedDraft.version))
      .toMatchObject({ ok: true });
    expect(await readFile(join(vault, archived))).toEqual(archivedBytes);
    expect((await invoke('readNodeProfile', nodeId))?.body).toContain('編輯最新封存。');
  });

  it('喚醒 IPC 檢查目前星圖、協定與來源，只有符合白名單的封存節點能送出', async () => {
    electron.userData = await mkdtemp(join(tmpdir(), 'nexus-wake-ipc-'));
    const vault = join(electron.userData, 'sky');
    await cp(resolve('fixtures/sky-vault'), vault, { recursive: true });
    await saveVaultPath(join(electron.userData, 'settings.dev.json'), vault);
    const path = join(vault, '.nexus-stats.json');
    const stats = JSON.parse(await readFile(path, 'utf8'));
    stats.節點['fixture-sky-iris'].session.sessionId = 'synthetic-session';
    await writeFile(path, JSON.stringify(stats));
    const sender = {};
    registerVaultIpc(() => ({ webContents: sender }) as BrowserWindow);
    const event = { sender, senderFrame: { url: appUrl, parent: null } };
    const [, invoke] = electron.handle.mock.calls.find(([channel]) => channel === vaultChannels.requestWake)!;
    expect(() => invoke({ sender, senderFrame: { url: 'https://outside.invalid/', parent: null } }, 'fixture-sky-iris')).toThrow('無法驗證');
    expect(await invoke(event, 'https://wake?node=fixture-sky-iris')).toMatchObject({ ok: false, reason: 'invalid-node' });
    expect(await invoke(event, 'fixture-sky-quill')).toMatchObject({ ok: false, reason: 'not-wakeable' });
    expect(await invoke(event, 'fixture-sky-dawn')).toMatchObject({ ok: false, reason: 'not-wakeable' });
    expect(await invoke(event, 'fixture-sky-iris')).toEqual({ ok: false, reason: 'unregistered', nodeName: '稜鏡', sessionId: 'synthetic-session' });
    expect(electron.openExternal).not.toHaveBeenCalled();
    electron.registered.mockReturnValue('Synthetic Console');
    expect(await invoke(event, 'fixture-sky-iris')).toEqual({ ok: true });
    expect(electron.openExternal).toHaveBeenCalledExactlyOnceWith('entropy-nexus://wake?node=fixture-sky-iris');
    expect((await (electron.handle.mock.calls.find(([channel]) => channel === vaultChannels.readCrystal)![1])(event, 'fixture-sky-iris')))
      .toMatchObject({ status: '封存', canWake: true });
  });
  it.each([appUrl, appUrl + '#/library', appUrl + '?layout=B#/library', appUrl + '/library'])('接受 %s', (source) => {
    expect(isVaultFrameUrl(source)).toBe(true);
  });

  it.each([
    'https://app/index.html', 'vault-app://other/index.html', 'vault-app://app:44/index.html',
    'vault-app://app/index.html2', 'vault-app://app/assets/test.js', 'about:blank',
  ])('拒絕 %s', (source) => {
    expect(isVaultFrameUrl(source)).toBe(false);
  });

  it('只有本視窗頂層介面能讀開發 fixtures', async () => {
    electron.userData = await mkdtemp(join(tmpdir(), 'nexus-vault-ipc-'));
    const sender = {};
    registerVaultIpc(() => ({ webContents: sender }) as BrowserWindow);
    const [, invoke] = electron.handle.mock.calls.find(([channel]) => channel === vaultChannels.listEntries)!;
    const senderFrame = { url: appUrl + '#/library', parent: null };
    expect(await invoke({ sender, senderFrame }, { shelf: 'archive' })).toEqual(expect.arrayContaining([
      expect.objectContaining({ shelf: 'archive', kind: 'preference' }),
    ]));
    expect(() => invoke({ sender: {}, senderFrame }, {})).toThrow('無法驗證');
    expect(() => invoke({ sender, senderFrame: { ...senderFrame, parent: {} } }, {})).toThrow('無法驗證');
    expect(() => invoke({ sender, senderFrame: { ...senderFrame, url: 'https://app/index.html#/library' } }, {})).toThrow('無法驗證');
  });

  it('版式與低動態記住上次選擇且保留記憶庫位置', async () => {
    electron.userData = await mkdtemp(join(tmpdir(), 'nexus-vault-settings-'));
    const settingsFile = join(electron.userData, 'settings.dev.json');
    const vaultPath = resolve('fixtures/memory-vault');
    expect(await readViewSettings(settingsFile)).toEqual({ deskMode: 'A', reducedMotion: false });
    await Promise.all([
      saveVaultPath(settingsFile, vaultPath),
      saveViewSettings(settingsFile, { deskMode: 'B' }),
      saveViewSettings(settingsFile, { reducedMotion: true }),
    ]);
    expect(await readVaultPath(settingsFile, '')).toBe(vaultPath);
    expect(await readViewSettings(settingsFile)).toEqual({ deskMode: 'B', reducedMotion: true });
  });

  it('寫入、回收與撤銷 IPC 只操作暫存複本並重建快照', async () => {
    electron.userData = await mkdtemp(join(tmpdir(), 'nexus-vault-ipc-'));
    const vault = join(electron.userData, 'synthetic-vault');
    const fixtures = resolve('fixtures/memory-vault');
    await cp(fixtures, vault, { recursive: true });
    await saveVaultPath(join(electron.userData, 'settings.dev.json'), vault);
    const sender = {};
    registerVaultIpc(() => ({ webContents: sender }) as BrowserWindow);
    const event = { sender, senderFrame: { url: appUrl, parent: null } };
    function invoke<M extends keyof VaultRequests>(method: M, ...args: Parameters<VaultRequests[M]>): ReturnType<VaultRequests[M]> {
      return electron.handle.mock.calls.find(([channel]) => channel === vaultChannels[method])![1](event, ...args) as ReturnType<VaultRequests[M]>;
    }
    const entry = (await invoke('listEntries', { kind: 'case', status: '未確認' }))[0];
    const path = entry.path;
    const result = await invoke('setStatus', path, '已確認', { mtime: entry.mtime, size: entry.size });
    if (!result.ok) throw new Error(result.reason);
    expect(await invoke('readEntry', path)).toMatchObject({ status: '已確認', mtime: result.mtime });
    const recycled = await invoke('moveToRecycle', path, result);
    if (!recycled.ok) throw new Error(recycled.reason);
    expect(await invoke('readEntry', path)).toBeNull();
    expect(await invoke('restoreFromRecycle', recycled.recycledPath, recycled)).toMatchObject({ ok: true });
    expect(await invoke('readEntry', path)).toMatchObject({ status: '已確認' });
    expect(await readFile(join(fixtures, path), 'utf8')).toContain('狀態: 未確認');
  });

  it('完整 IPC JSON 過濾原始專案 ID、工作目錄和其他本機路徑；代號篩選仍可使用', async () => {
    electron.userData = await mkdtemp(join(tmpdir(), 'nexus-vault-privacy-'));
    const vault = join(electron.userData, 'vault');
    await cp(resolve('fixtures/memory-vault'), vault, { recursive: true });
    await saveVaultPath(join(electron.userData, 'settings.dev.json'), vault);
    const path = 'knowledge/月汐溫室/本機路徑驗證.md';
    const projectId = 'C:\\Users\\Synthetic\\Private project';
    const statsPath = join(vault, '.nexus-stats.json');
    const stats = JSON.parse(await readFile(statsPath, 'utf8'));
    stats.節點['fixture-node-heron'].角色 = 'C:\\Users\\Synthetic\\SearchPortraits';
    stats.節點['fixture-node-heron'].session.後台 = 'antigravity';
    await writeFile(statsPath, JSON.stringify(stats));
    await writeFile(join(vault, path), [
      '---', '種類: 知識', '標題: 隱私驗證', '專案ID: ' + projectId, 'project-id: 隱藏別名',
      '工作目錄: /Users/Synthetic/Note', '其他: [公開, /home/user/private]', '公開欄位: 保留下來', '---',
      '索引標記。位置是（' + projectId + '）。',
      '相對位置：..\\..\\Users\\RelativeName\\Note.md', '附帶索引：Users\\RelativeName\\Index.md',
      '## 回顧', '開啟 file:///C:/Users/Synthetic/Nexus.txt',
    ].join('\n'));
    const archive = 'nodes/封存/霜-2026-11-22.md';
    await writeFile(join(vault, archive), [
      '---', '種類: 節點側寫', '節點ID: fixture-private', '工作目錄: /tmp/private/vault',
      '任意欄位: \\\\test-server\\share\\secret', '驗收數: 3', '完成數: 0', '---',
      '# 霜', '位於 /Users/Synthetic/Archive', '## 解決問題的流程', '參考 ..\\..\\Users\\RelativeName\\Workflow.md',
    ].join('\n'));
    const sender = {};
    registerVaultIpc(() => ({ webContents: sender }) as BrowserWindow);
    const event = { sender, senderFrame: { url: appUrl, parent: null } };
    function invoke<M extends keyof VaultRequests>(method: M, ...args: Parameters<VaultRequests[M]>): ReturnType<VaultRequests[M]> {
      return electron.handle.mock.calls.find(([channel]) => channel === vaultChannels[method])![1](event, ...args) as ReturnType<VaultRequests[M]>;
    }
    const rows = await invoke('listEntries', { includeSuperseded: true });
    const project = rows.find((row) => row.path === path)!;
    expect(project.projectId).toMatch(/^p_[a-f0-9]{24}$/);
    expect(await invoke('listEntries', { projectId: project.projectId })).toMatchObject([{ path }]);
    expect(await invoke('listEntries', { projectId })).toEqual([]);
    const found = await invoke('search', '索引標記', { projectId: project.projectId });
    expect(found).toMatchObject([{ path, projectId: project.projectId }]);
    const entry = await invoke('readEntry', path);
    expect(entry?.attributes.filter(([key]) => ['專案ID', 'project-id', '工作目錄'].includes(key))).toEqual([]);
    // List attributes lose only the items that are local paths.
    expect(entry?.attributes).toContainEqual(['其他', ['公開']]);
    expect(entry?.attributes).toContainEqual(['公開欄位', '保留下來']);
    expect(entry?.body).toContain('[本機路徑已隱藏]');
    const crystal = await invoke('readCrystal', 'fixture-private');
    expect(crystal?.profile?.path).toBe(archive);
    expect(crystal).toMatchObject({ workflow: '參考 [本機路徑已隱藏]',
      stats: { accepted: 3, completed: 0, rejected: null, cases: null }, notRejectedRate: null });
    const fixtures = await invoke('readCrystal', 'fixture-node-moss');
    const nodeHits = [
      ...await invoke('searchNodes', '霜'),
      ...await invoke('searchNodes', '紙鷺'),
      ...await invoke('searchNodes', '夜苔'),
    ];
    expect(nodeHits).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeId: 'fixture-private', brand: { vendor: null, mode: 'dormant' } }),
      expect.objectContaining({
        nodeId: 'fixture-node-heron', brand: { vendor: 'gemini', mode: 'active' }, role: '[本機路徑已隱藏]',
      }),
      expect.objectContaining({ nodeId: 'fixture-node-moss', brand: { vendor: 'claude', mode: 'dormant' } }),
    ]));
    const snapshot = [rows, found, entry, crystal, fixtures, nodeHits, await invoke('listCrystals'), await invoke('getVaultInfo')];
    expect(JSON.stringify(snapshot)).not.toMatch(/[a-z]:[\\/]|\/(?:Users|home|tmp|Volumes)\/|file:\/\/|test-server|RelativeName|SearchPortraits/i);
  });

  it('專案星系 IPC:分群、連線、座標固定、升格與整理一次;整份 JSON 沒有路徑與原始專案ID', async () => {
    electron.userData = await mkdtemp(join(tmpdir(), 'nexus-galaxy-ipc-'));
    const vault = join(electron.userData, 'galaxy');
    await cp(resolve('fixtures/console-stats'), vault, { recursive: true });
    await saveVaultPath(join(electron.userData, 'settings.dev.json'), vault);
    const sender = {};
    registerVaultIpc(() => ({ webContents: sender }) as BrowserWindow);
    const event = { sender, senderFrame: { url: appUrl, parent: null } };
    function invoke<M extends keyof VaultRequests>(method: M, ...args: Parameters<VaultRequests[M]>): ReturnType<VaultRequests[M]> {
      return electron.handle.mock.calls.find(([channel]) => channel === vaultChannels[method])![1](event, ...args) as ReturnType<VaultRequests[M]>;
    }
    const map = await invoke('listGalaxies');
    if (!map.enabled) throw new Error('galaxies should be enabled');
    expect(map.hub).toEqual(['0b6f1c2e-0000-4000-8000-000000000001']);
    expect(map.groups.filter(({ kind }) => kind === 'galaxy')).toHaveLength(4);
    expect(map.groups.find(({ name }) => name === '共用庫')).toMatchObject({ kind: 'nebula', projectType: '資料夾', promoted: false });
    for (const group of map.groups) {
      expect(group.key).toMatch(/^p_[a-f0-9]{24}$/);
      expect(group.position.every(Number.isFinite)).toBe(true);
    }
    expect(map.bridges).toHaveLength(4);
    const raw = JSON.stringify(map);
    expect(raw).not.toMatch(/synthetic|[a-z]:[\/]|\/Users\//i);

    // Positions are fixed: a second call (and a new process) returns the same coordinates.
    const again = await invoke('listGalaxies');
    expect(again).toEqual(map);
    const layout = await readFile(join(electron.userData, 'galaxy-layout.json'), 'utf8');
    expect(layout).not.toMatch(/synthetic|[a-z]:[\/]/i);

    const shared = map.groups.find(({ name }) => name === '共用庫')!;
    const promoted = await invoke('setGalaxyPromotion', shared.key, true);
    if (!promoted.enabled) throw new Error('galaxies should be enabled');
    expect(promoted.groups.find(({ key }) => key === shared.key)).toMatchObject({ kind: 'galaxy', promoted: true, position: shared.position });
    expect(promoted.bridges.length).toBeGreaterThan(map.bridges.length);
    for (const group of map.groups) expect(promoted.groups.find(({ key }) => key === group.key)?.position).toEqual(group.position);
    expect(await readFile(join(electron.userData, 'galaxy-settings.json'), 'utf8')).not.toMatch(/synthetic|[a-z]:[\/]/i);
    // A git project cannot be promoted; an unknown key is ignored.
    const git = map.groups.find(({ projectType }) => projectType === 'git')!;
    expect(await invoke('setGalaxyPromotion', git.key, true)).toEqual(promoted);
    expect(await invoke('setGalaxyPromotion', 'p_' + '0'.repeat(24), true)).toEqual(promoted);
    const reverted = await invoke('setGalaxyPromotion', shared.key, false);
    expect(reverted.enabled && reverted.groups.find(({ key }) => key === shared.key)?.kind).toBe('nebula');

    const arranged = await invoke('arrangeGalaxies');
    expect(arranged.enabled && arranged.groups.length).toBe(map.groups.length);
    expect(JSON.stringify(arranged)).not.toMatch(/synthetic|[a-z]:[\/]/i);
  });

  it('水晶 IPC 保留與主星系同名的單人專案代號，舊資料只留名稱，整份回傳遮蔽路徑', async () => {
    electron.userData = await mkdtemp(join(tmpdir(), 'nexus-crystal-project-ipc-'));
    const vault = join(electron.userData, 'galaxy');
    await cp(resolve('fixtures/console-stats'), vault, { recursive: true });
    await saveVaultPath(join(electron.userData, 'settings.dev.json'), vault);
    const statsPath = join(vault, '.nexus-stats.json');
    const stats = JSON.parse(await readFile(statsPath, 'utf8'));
    const nodeId = '0b6f1c2e-0000-4000-8000-000000000006';
    const legacyId = '0b6f1c2e-0000-4000-8000-000000000004';
    const homeId = 'd:/synthetic/work/app';
    const soloId = 'C:\\Users\\SyntheticSolo\\workspace\\app';
    const legacyPath = '/Users/SyntheticLegacy/old-project';
    stats.節點[nodeId].專案.push('工作區舊名稱');
    stats.節點[nodeId].專案ID.push(soloId);
    stats.節點[nodeId].專案任務數.push(1);
    stats.專案表[soloId] = { 名稱: 'app', 類型: '資料夾' };
    stats.節點[legacyId].專案.push(legacyPath);
    await writeFile(statsPath, JSON.stringify(stats));

    const sender = {};
    registerVaultIpc(() => ({ webContents: sender }) as BrowserWindow);
    const event = { sender, senderFrame: { url: appUrl, parent: null } };
    function invoke<M extends keyof VaultRequests>(method: M, ...args: Parameters<VaultRequests[M]>): ReturnType<VaultRequests[M]> {
      return electron.handle.mock.calls.find(([channel]) => channel === vaultChannels[method])![1](event, ...args) as ReturnType<VaultRequests[M]>;
    }
    const map = await invoke('listGalaxies');
    const list = await invoke('listCrystals');
    const detail = await invoke('readCrystal', nodeId);
    const homeKey = opaqueKey('p', homeId);
    const soloKey = opaqueKey('p', soloId);
    expect(map.enabled && map.membership[nodeId].group).toBe(homeKey);
    expect(soloKey).not.toBe(homeKey);
    expect(list.links.some((link) => link.kind === 'project' && link.projectKey === soloKey)).toBe(false);
    const projects = list.crystals.find((crystal) => crystal.nodeId === nodeId)?.projects;
    expect(projects?.filter(({ name }) => name === 'app')).toEqual([
      { key: homeKey, name: 'app', kind: 'git' },
      { key: soloKey, name: 'app', kind: '資料夾' },
    ]);
    expect(detail?.projects).toEqual(projects);
    expect(list.crystals.find((crystal) => crystal.nodeId === legacyId)?.projects).toEqual([
      { name: '舊專案' }, { name: '[本機路徑已隱藏]' },
    ]);
    expect(JSON.stringify({ map, list, detail })).not.toMatch(/[a-z]:[\\/]|\/Users\/|SyntheticSolo|SyntheticLegacy|專案ID/i);
  });

  it('沒有專案表時星系關閉', async () => {
    electron.userData = await mkdtemp(join(tmpdir(), 'nexus-galaxy-off-'));
    const vault = join(electron.userData, 'sky');
    await cp(resolve('fixtures/sky-vault'), vault, { recursive: true });
    await saveVaultPath(join(electron.userData, 'settings.dev.json'), vault);
    const sender = {};
    registerVaultIpc(() => ({ webContents: sender }) as BrowserWindow);
    const event = { sender, senderFrame: { url: appUrl, parent: null } };
    const call = (channel: string, ...args: unknown[]) =>
      electron.handle.mock.calls.find(([name]) => name === channel)![1](event, ...args) as Promise<unknown>;
    expect(await call(vaultChannels.listGalaxies)).toEqual({ enabled: false });
    expect(await call(vaultChannels.arrangeGalaxies)).toEqual({ enabled: false });
  });

  it('立繪資料夾由對話框設定，IPC 只回代稱，節點自己的立繪/頭像維持優先', async () => {
    electron.userData = await mkdtemp(join(tmpdir(), 'nexus-brand-ipc-'));
    const vault = join(electron.userData, 'sky');
    const chosen = join(electron.userData, 'SyntheticAccount', 'private-art');
    const brandFolder = join(chosen, 'claude');
    await cp(resolve('fixtures/sky-vault'), vault, { recursive: true });
    await mkdir(brandFolder, { recursive: true });
    const settings = join(electron.userData, 'settings.dev.json');
    await saveVaultPath(settings, vault);
    const own = join(vault, 'nodes', '封存', '_圖像', 'fixture-sky-iris');
    await copyFile(join(own, 'avatar.png'), join(brandFolder, 'active.png'));
    await copyFile(join(own, 'avatar.png'), join(brandFolder, 'dormant.png'));
    const statsFile = join(vault, '.nexus-stats.json');
    const stats = JSON.parse(await readFile(statsFile, 'utf8'));
    stats.節點['fixture-sky-iris'].session.後台 = 'claude';
    stats.節點['fixture-sky-quill'].session.後台 = 'claude';
    await writeFile(statsFile, JSON.stringify(stats));

    const sender = {};
    const sources = registerVaultIpc(() => ({ webContents: sender }) as BrowserWindow);
    const event = { sender, senderFrame: { url: appUrl, parent: null } };
    function invoke<M extends keyof VaultRequests>(method: M, ...args: Parameters<VaultRequests[M]>): ReturnType<VaultRequests[M]> {
      return electron.handle.mock.calls.find(([channel]) => channel === vaultChannels[method])![1](event, ...args) as ReturnType<VaultRequests[M]>;
    }
    const disabled = { configured: false, label: null };
    const brandImage = new Request('vault-image://brand/claude/dormant');
    expect(await invoke('getBrandPortraitSettings')).toEqual(disabled);
    const forgedPatch = { reducedMotion: true, brandPortraitPath: chosen };
    expect(await invoke('setSettings', forgedPatch)).toEqual({ deskMode: 'A', reducedMotion: true });
    expect((await serveVaultImage(brandImage, sources)).status).toBe(404);
    electron.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [chosen] });
    const selection = await invoke('chooseBrandPortraitFolder');
    expect(selection).toEqual({ configured: true, label: '自訂立繪資料夾' });
    expect(electron.showOpenDialog).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ properties: ['openDirectory'] }));
    expect(JSON.parse(await readFile(settings, 'utf8')).brandPortraitPath).toBe(await realpath(chosen));
    electron.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    expect(await invoke('chooseBrandPortraitFolder')).toBeNull();
    const current = await invoke('getBrandPortraitSettings');
    expect(current).toEqual(selection);

    const list = await invoke('listCrystals');
    const detail = await invoke('readCrystal', 'fixture-sky-iris');
    const iris = {
      portraitUrl: 'vault-image://node/fixture-sky-iris/portrait',
      avatarUrl: 'vault-image://node/fixture-sky-iris/avatar',
      brand: { vendor: 'claude', mode: 'dormant' },
    };
    expect(list.crystals.find(({ nodeId }) => nodeId === 'fixture-sky-iris')).toMatchObject(iris);
    expect(detail).toMatchObject(iris);
    expect(list.crystals.find(({ nodeId }) => nodeId === 'fixture-sky-quill')).toMatchObject({
      portraitUrl: null, avatarUrl: null, brand: { vendor: 'claude', mode: 'active' },
    });
    const ownResponse = await serveVaultImage(new Request(iris.portraitUrl), sources);
    const brandResponse = await serveVaultImage(brandImage, sources);
    expect(ownResponse.status).toBe(200);
    expect(brandResponse.status).toBe(200);
    expect(Buffer.from(await ownResponse.arrayBuffer())).toEqual(await readFile(join(own, 'portrait.png')));
    expect(Buffer.from(await brandResponse.arrayBuffer())).toEqual(await readFile(join(own, 'avatar.png')));
    expect((await serveVaultImage(new Request('vault-image://brand/claude/active'), sources)).status).toBe(200);
    const cleared = await invoke('clearBrandPortraitFolder');
    expect(cleared).toEqual(disabled);
    expect(await invoke('getBrandPortraitSettings')).toEqual(disabled);
    expect((await serveVaultImage(brandImage, sources)).status).toBe(404);
    expect(JSON.stringify({ selection, current, list, detail, cleared }))
      .not.toMatch(/(?<![a-z0-9-])[a-z]:[\\/]|\/Users\/|SyntheticAccount|private-art|brandPortraitPath/i);
  });

  it('星圖合成庫提供四種徽章、關係、履歷及白名單內的實際合成立繪', async () => {
    electron.userData = await mkdtemp(join(tmpdir(), 'nexus-sky-ipc-'));
    const vault = join(electron.userData, 'sky');
    await cp(resolve('fixtures/sky-vault'), vault, { recursive: true });
    await saveVaultPath(join(electron.userData, 'settings.dev.json'), vault);
    const cases = join(vault, 'cases', '合成觀測站');
    const original = await readFile(join(cases, '2026-0001-對齊觀測時間.md'), 'utf8');
    await writeFile(join(cases, '2026-0002-未確認.md'),
      original.replace('2026-0001', '2026-0002').replace('已確認', '未確認').replace('對齊觀測時間', '未確認'));
    await writeFile(join(cases, '2026-0003-只參與.md'), original.replace('2026-0001', '2026-0003')
      .replace('節點ID: fixture-sky-iris', '節點ID: fixture-sky-quill\n參與節點ID: [fixture-sky-iris]')
      .replace('對齊觀測時間', '只參與'));
    const statsFile = join(vault, '.nexus-stats.json');
    const stats = JSON.parse(await readFile(statsFile, 'utf8'));
    stats.節點['fixture-sky-iris'].判例數 = 99;
    await writeFile(statsFile, JSON.stringify(stats));
    const sender = {};
    const context = registerVaultIpc(() => ({ webContents: sender }) as BrowserWindow);
    const event = { sender, senderFrame: { url: appUrl, parent: null } };
    function invoke<M extends keyof VaultRequests>(method: M, ...args: Parameters<VaultRequests[M]>): ReturnType<VaultRequests[M]> {
      return electron.handle.mock.calls.find(([channel]) => channel === vaultChannels[method])![1](event, ...args) as ReturnType<VaultRequests[M]>;
    }
    const map = await invoke('listCrystals');
    const iris = map.crystals.find((node) => node.nodeId === 'fixture-sky-iris')!;
    expect(map.crystals).toHaveLength(4);
    expect(new Set(map.links.map(({ kind }) => kind))).toEqual(new Set(['lineage', 'delegate', 'meeting', 'project']));
    // 1 handled confirmed case (10) + 1 participated (1) + 1 project (4) + (8 − 2) / 10 completed (0) = 15 → green;
    // the console's 判例數 (99 here) is not used.
    expect(iris).toMatchObject({ glow: 'green', status: '封存', canWake: true,
      avatarUrl: 'vault-image://node/fixture-sky-iris/avatar', portraitUrl: 'vault-image://node/fixture-sky-iris/portrait' });
    expect(iris.position).toHaveLength(3);
    expect(iris.position.every(Number.isFinite)).toBe(true);
    expect(map.crystals.filter(({ portraitUrl }) => portraitUrl === null)).toHaveLength(3);
    const image = await serveVaultImage(new Request(iris.portraitUrl!), context);
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toBe('image/png');
    const png = Buffer.from(await image.arrayBuffer());
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([96, 136]);
    const detail = await invoke('readCrystal', iris.nodeId);
    expect(detail).toMatchObject({
      specialty: '擅長核對合成脈衝的時間戳。',
      workflow: '先比對時鐘，再核對合成時間序列。',
      review: '同一批觀測記錄要對齊測試基準。',
      notRejectedRate: 0.75,
      consoleAppendixCount: 1,
      archives: [{ archivedAt: '2026-11-21 08:00' }],
      confirmedCaseCount: 1,
      relatedEntries: expect.arrayContaining([{ title: '對齊觀測時間' }, { title: '未確認' }, { title: '只參與' }]
        .map((entry) => expect.objectContaining(entry))),
      portraitUrl: iris.portraitUrl,
      richness: { score: 15, tier: 'green', parts: { confirmedCases: 10, participatedCases: 1, projects: 4, completed: 0 } },
      award: null,
      glow: 'green',
    });
    expect(JSON.stringify([map, detail])).not.toMatch(/(?<![a-z0-9-])[a-z]:[\\/]|\/Users\/|\.{2}\\/i);

    // Rainbow award through IPC: the reason is masked on the way out; the glow changes only after the write.
    expect(map.awards).toEqual({ version: null, corrupt: false });
    expect(await invoke('setAward', 'no-such-node', { reason: '' }, null)).toEqual({ ok: false, reason: 'invalid' });
    const granted = await invoke('setAward', iris.nodeId, { reason: '見 C:\\Users\\Someone\\筆記.md 的整理' }, null);
    expect(granted).toMatchObject({ ok: true, award: { reason: '見 [本機路徑已隱藏]' } });
    const after = await invoke('listCrystals');
    expect(after.crystals.find((node) => node.nodeId === iris.nodeId)?.glow).toBe('rainbow');
    const awarded = await invoke('readCrystal', iris.nodeId);
    expect(awarded).toMatchObject({ glow: 'rainbow', award: { reason: '見 [本機路徑已隱藏]' }, richness: { tier: 'green' } });
    expect(await invoke('setAward', iris.nodeId, null, null)).toMatchObject({ ok: false, reason: 'conflict' });
    expect(await invoke('setAward', iris.nodeId, null, after.awards!.version)).toMatchObject({ ok: true, award: null });
    expect((await invoke('listCrystals')).crystals.find((node) => node.nodeId === iris.nodeId)?.glow).toBe('green');
    // App-owned files hold no paths.
    const peaks = await readFile(join(electron.userData, 'glow-peaks.json'), 'utf8');
    expect(peaks).not.toMatch(/[a-z]:[\\/]|\/Users\//i);
    expect(Object.keys(JSON.parse(peaks).記憶庫)).toEqual([expect.stringMatching(/^v_[a-f0-9]{24}$/)]);
  });
});
