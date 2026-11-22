import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { VaultReader } from './index';
import { redactForRenderer } from './privacy';
import { VaultWriter } from './write';

// 與主控台交叉驗證:下面是主控台 docs/memory-vault-app/會議紀錄樣本.md(去識別、內容全虛構,由 buildMeetingRecord 與
// serializeFrontMatter 產生)去掉檔首兩行樣本說明註解後的原文(2026-11-22 主控台尚未提交的版本)。主控台格式改了就重新貼上。
const sample = "---\n種類: 會議紀錄\n主題: 星圖 App 的登入流程要不要改成權杖\n輪數: 2\n開始: 2031-03-14T06:00:00.000Z\n結束: 2031-03-14T06:18:42.000Z\n更新時間: 2031-03-14T06:18:42.000Z\n節點ID: node-orion\n主持人: 獵戶\n參與節點ID: [node-vega, node-lyra, node-castor]\n參與者: [織女, 天琴, 北河]\n範圍: 專案\n專案ID: c:/projects/star-app\n專案: star-app\n摘要: 登入改用短效權杖,舊的工作階段 Cookie 保留兩週後移除。\n結束原因: 完成\n狀態: 未確認\n---\n\n## 結論\n\n> 登入改用短效權杖,舊的工作階段 Cookie 保留兩週後移除。\n>\n> 後續:織女補遷移腳本,天琴更新文件。\n\n## 第 1 輪\n\n### 織女 · node-vega\n\n> 可行。我看過設定檔 [本機路徑已隱藏],逾時寫死在裡面,要先抽成設定。\n\n### 天琴 · node-lyra\n\n> 文件那邊要同步改,相對路徑 docs/auth.md 之後也要補流程圖。\n\n### 北河 · node-castor\n\n> 同意。換裝置要重登是最多人抱怨的地方。\n\n### 獵戶(主持人) · node-orion\n\n> 第 2 輪請織女列出遷移步驟,其他人看有沒有風險。\n\n## 第 2 輪\n\n### 織女 · node-vega\n\n> ## 遷移步驟\n>\n> 1. 新增權杖表\n> 2. 雙寫兩週\n>\n> ```ts\n> export const TOKEN_TTL_MS = 15 * 60 * 1000;\n> ```\n>\n> 有沒有人反對?\n\n### 天琴 · node-lyra\n\n> (第 2 輪略過:目前在休眠)\n\n### 北河 · node-castor\n\n> 沒有反對。(沒有需要補充的)\n";
const rel = 'meetings/star-app/2031-03-14-星圖 App 的登入流程要不要改成權杖.md';

const scratch: string[] = [];
afterEach(async () => { await Promise.all(scratch.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

async function setup(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'nexus-meeting-sample-'));
  scratch.push(root);
  await mkdir(join(root, 'meetings', 'star-app'), { recursive: true });
  await writeFile(join(root, ...rel.split('/')), sample);
  return root;
}

describe('主控台會議紀錄樣本', () => {
  it('檔頭、卡片欄位與正文結構照第五輪解析', async () => {
    const snapshot = await new VaultReader(await setup()).read();
    const [entry] = snapshot.listEntries({ shelf: 'meeting' });
    expect(entry).toMatchObject({
      kind: 'meeting', shelf: 'meeting', status: '未確認', title: '星圖 App 的登入流程要不要改成權杖',
      summary: '登入改用短效權杖,舊的工作階段 Cookie 保留兩週後移除。', nodeId: 'node-orion',
      participantNodeIds: ['node-vega', 'node-lyra', 'node-castor'],
    });
    expect(entry.updatedAt).toBe(Date.parse('2031-03-14T06:18:42.000Z'));
    expect(entry.projectId).toMatch(/^p_/);
    expect(entry.nodeIds).toEqual(['node-orion', 'node-vega', 'node-lyra', 'node-castor']);
    expect(entry.meeting).toEqual({
      topic: '星圖 App 的登入流程要不要改成權杖', rounds: 2,
      startedAt: Date.parse('2031-03-14T06:00:00.000Z'), endedAt: Date.parse('2031-03-14T06:18:42.000Z'),
      hostName: '獵戶',
      participants: [{ nodeId: 'node-vega', name: '織女' }, { nodeId: 'node-lyra', name: '天琴' }, { nodeId: 'node-castor', name: '北河' }],
      endReason: '完成', hasConclusion: true, outputs: [],
    });

    const detail = (await snapshot.readEntry(rel))!;
    const transcript = detail.transcript!;
    expect(transcript.problems).toEqual([]);
    expect(transcript.conclusion).toBe('登入改用短效權杖,舊的工作階段 Cookie 保留兩週後移除。\n\n後續:織女補遷移腳本,天琴更新文件。');
    expect(transcript.rounds.map((round) => [round.round, round.speeches.map((s) => [s.name, s.nodeId])])).toEqual([
      [1, [['織女', 'node-vega'], ['天琴', 'node-lyra'], ['北河', 'node-castor'], ['獵戶(主持人)', 'node-orion']]],
      [2, [['織女', 'node-vega'], ['天琴', 'node-lyra'], ['北河', 'node-castor']]],
    ]);
    // 引用裡的 ## 標題與程式碼區塊留在發言內,只剝一層 >
    expect(transcript.rounds[1].speeches[0].text).toBe(
      '## 遷移步驟\n\n1. 新增權杖表\n2. 雙寫兩週\n\n```ts\nexport const TOKEN_TTL_MS = 15 * 60 * 1000;\n```\n\n有沒有人反對?');
    expect(JSON.stringify(redactForRenderer(detail))).not.toContain('c:/projects');
  });

  it('確認後只改狀態行', async () => {
    const root = await setup();
    const reader = new VaultReader(root);
    const writer = new VaultWriter(root, () => reader.invalidate());
    const seen = (await (await reader.read()).readEntry(rel))!;
    expect(await writer.setStatus(rel, '已確認', seen)).toMatchObject({ ok: true });
    expect(await readFile(join(root, ...rel.split('/')), 'utf8')).toBe(sample.replace('狀態: 未確認', '狀態: 已確認'));
  });
});
