import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { VaultReader } from './index';
import { redactForRenderer } from './privacy';
import { VaultWriter } from './write';

const scratch: string[] = [];
afterEach(async () => { await Promise.all(scratch.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

const localPath = String.raw`C:\Users\Someone\x.md`;
const day = (date: string) => date + 'T10:20:00.000Z';

function meeting(date: string, status: string, extra: string[], body: string[]): string {
  return ['---', '種類: 會議紀錄', '主題: 合成會議 ' + date, '輪數: 1',
    '開始: ' + date + 'T10:00:00.000Z', '結束: ' + day(date), '更新時間: ' + day(date),
    '節點ID: host-1', '主持人: 主持', '參與節點ID:', '  - host-1', '  - part-1', '參與者:', '  - "主持"', '  - "參與"',
    String.raw`專案ID: C:\Work\secret-project`, '專案: 合成專案', '結束原因: 完成', '狀態: ' + status, ...extra, '---', '', ...body, ''].join('\n');
}

const withConclusion = ['## 結論', '> 結語第一段。', '', '## 第 1 輪', '### 主持 · host-1', '> 看這個 ' + localPath];
const withoutConclusion = ['## 第 1 輪', '### 主持 · host-1', '> 沒有結論'];
const current = 'meetings/合成專案/2026-11-22-合成會議.md';

async function setup(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'nexus-meeting-'));
  scratch.push(root);
  const folder = join(root, 'meetings', '合成專案');
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, '2026-11-22-合成會議.md'), meeting('2026-11-22', '未確認', ['摘要: 標頭摘要'], withConclusion));
  await writeFile(join(folder, '2026-11-21-較舊.md'), meeting('2026-11-21', '退回', [], withoutConclusion));
  return root;
}

describe('會議紀錄進寶庫', () => {
  it('列在會議書架,欄位取自檔頭,專案ID不透出原值', async () => {
    const snapshot = await new VaultReader(await setup()).read();
    const entries = snapshot.listEntries({ shelf: 'meeting' });
    expect(entries).toHaveLength(2);
    const entry = entries.find((item) => item.path === current)!;
    expect(entry).toMatchObject({
      kind: 'meeting', shelf: 'meeting', title: '合成會議 2026-11-22', summary: '標頭摘要', nodeId: 'host-1', nodeLabel: '主持',
      participantNodeIds: ['host-1', 'part-1'], status: '未確認', projectName: '合成專案', updatedAt: Date.parse(day('2026-11-22')),
    });
    expect(entry.projectId).toMatch(/^p_[a-f0-9]{24}$/);
    expect(entry.meeting).toMatchObject({ hasConclusion: true, endReason: '完成',
      participants: [{ nodeId: 'host-1', name: '主持' }, { nodeId: 'part-1', name: '參與' }] });
    // 沒有摘要時不取第一段發言。
    const old = entries.find((item) => item.path.endsWith('較舊.md'))!;
    expect(old.summary).toBe('');
    expect(old.meeting?.hasConclusion).toBe(false);
    expect(old.status).toBe('退回');
  });

  it('詳情含逐字稿;經 IPC 邊界後本機路徑被遮蔽、原始專案ID不出現', async () => {
    const snapshot = await new VaultReader(await setup()).read();
    const detail = (await snapshot.readEntry(current))!;
    expect(detail.transcript!.conclusion).toBe('結語第一段。');
    expect(detail.transcript!.rounds[0].speeches[0].text).toContain(localPath);
    const sent = JSON.stringify(redactForRenderer(detail));
    expect(sent).toContain('[本機路徑已隱藏]');
    expect(sent).not.toContain('Someone');
    expect(sent).not.toContain('secret-project');
  });

  // 迴歸:status-line.ts 曾以 String#trim 處理逐位元組的鍵名,「結束原因」的「因」結尾位元組 0xA0 被當成空白切掉,
  // 整個檔頭被判成舊格式(legacy),確認/退回失敗。
  it('(真實格式)確認與退回只改狀態行', async () => {
    const root = await setup();
    const reader = new VaultReader(root);
    const writer = new VaultWriter(root, () => reader.invalidate());
    const seen = (await (await reader.read()).readEntry(current))!;
    expect(await writer.setStatus(current, '已確認', seen)).toMatchObject({ ok: true });
  });

  it('確認與退回只改狀態行,也可移入回收(檔頭不含「結束原因」)', async () => {
    const root = await setup();
    await writeFile(join(root, current), (await readFile(join(root, current), 'utf8')).replace('結束原因: 完成\n', ''));
    const reader = new VaultReader(root);
    const writer = new VaultWriter(root, () => reader.invalidate());
    const file = join(root, current);
    const original = await readFile(file, 'utf8');
    const seen = (await (await reader.read()).readEntry(current))!;
    const confirmed = await writer.setStatus(current, '已確認', seen);
    expect(confirmed).toMatchObject({ ok: true });
    expect(await readFile(file, 'utf8')).toBe(original.replace('狀態: 未確認', '狀態: 已確認'));
    const afterConfirm = await stat(file);
    expect(await writer.setStatus(current, '退回', { mtime: afterConfirm.mtimeMs, size: afterConfirm.size })).toMatchObject({ ok: true });
    expect(await readFile(file, 'utf8')).toBe(original.replace('狀態: 未確認', '狀態: 退回'));
    const now = await stat(file);
    const moved = await writer.moveToRecycle(current, { mtime: now.mtimeMs, size: now.size });
    expect(moved).toMatchObject({ ok: true, recycledPath: '_回收/' + current });
    expect((await reader.read()).listEntries({ shelf: 'meeting' })).toHaveLength(1);
  });

  it('節點水晶的會議:主持與參與都算,所有狀態,新的在前,被取代的不列', async () => {
    const root = await setup();
    await writeFile(join(root, 'meetings', '合成專案', '2026-11-23-新版.md'),
      meeting('2026-11-23', '已確認', ['取代: "[[meetings/合成專案/2026-11-21-較舊]]"'], withoutConclusion));
    await mkdir(join(root, 'nodes'), { recursive: true });
    for (const id of ['host-1', 'part-1', 'other-1']) {
      await writeFile(join(root, 'nodes', id + '.md'),
        ['---', '種類: 節點側寫', '節點ID: ' + id, '節點: ' + id, '---', '', '合成側寫。', ''].join('\n'));
    }
    const snapshot = await new VaultReader(root).read();
    for (const id of ['host-1', 'part-1']) {
      const detail = (await snapshot.readCrystal(id))!;
      expect(detail.meetingEntries!.map((entry) => entry.path.split('/').at(-1))).toEqual(['2026-11-23-新版.md', '2026-11-22-合成會議.md']);
      expect(detail.meetingEntries!.map((entry) => entry.status)).toEqual(['已確認', '未確認']);
    }
    expect((await snapshot.readCrystal('other-1'))!.meetingEntries).toEqual([]);
  });
});
