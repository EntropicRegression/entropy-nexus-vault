import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { VaultReader } from './index';
import { redactForRenderer } from './privacy';
import { VaultWriter } from './write';

// 與主控台交叉驗證:下面是主控台 docs/memory-vault-app/回憶錄樣本.md(主控台 9d6b1b6,去識別、內容全虛構,由
// tools/make-memoir-sample.mjs 用 parseMemoir、buildMemoir 與 serializeFrontMatter 產生)去掉檔尾兩行樣本說明註解後的原文。
// 主控台格式改了就重新貼上。
const sample = "---\n種類: \"回憶錄\"\n節點ID: \"node-orion\"\n節點: \"獵戶\"\n後台: \"Claude Code\"\n標題: \"第一次接手星圖 App 的登入改版\"\n涵蓋期間: \"2031-03-14/2031-03-16\"\n範圍: \"全域\"\n更新時間: \"2031-03-16 21:04:09\"\n狀態: \"未確認\"\n---\n\n這三天我主要在處理星圖 App 的登入流程。使用者一開始只說「換裝置要重登太煩」,我先讀了 src/auth/session.ts,以為是 Cookie 逾時設太短,改了之後才發現真正的原因是權杖沒有跨裝置同步。\n\n第二天主持了一場短會,織女提出遷移步驟,天琴負責文件。我那時太急著定案,沒有先問北河二號的意見,後來他補充的風險(舊版 App 還會送舊 Cookie)差點被漏掉。\n\n學到的事:\n\n1. 使用者描述的是症狀,先確認原因再動手。\n2. 開會時每個人都要問到,不要只聽第一個提案。\n\n我當時把測試用的設定放在 [本機路徑已隱藏],裡面的 api_key: [已遮罩] 已經請使用者作廢。\n\n## 來源\n\n- 這個 session 裡和使用者的對話(2031-03-14 到 2031-03-16)\n- 會議紀錄:meetings/star-app/2031-03-14-星圖 App 的登入流程要不要改成權杖.md\n- 任務:改登入逾時、補遷移腳本\n\n## 不確定之處\n\n- 北河二號提醒舊 Cookie 的時間,我記得是第二天下午,但不確定。\n";
const folder = 'memoirs/獵戶-node-ori/';
const rel = folder + '2031-03-16-第一次接手星圖 App 的登入改版.md';
const day = (text: string) => Date.parse(text + 'T00:00:00Z');

const scratch: string[] = [];
afterEach(async () => { await Promise.all(scratch.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

async function setup(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'nexus-memoir-sample-'));
  scratch.push(root);
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(root, ...path.split('/').slice(0, -1)), { recursive: true });
    await writeFile(join(root, ...path.split('/')), text);
  }
  return root;
}

describe('主控台回憶錄樣本(9d6b1b6)', () => {
  it('檔頭、涵蓋期間、章節拆分、書架與隱私照寶庫 M7 規格解析', async () => {
    const snapshot = await new VaultReader(await setup({ [rel]: sample })).read();
    const [entry] = snapshot.listEntries({ shelf: 'archive' });
    expect(entry).toMatchObject({
      path: rel, kind: 'memoir', shelf: 'archive', status: '未確認', title: '第一次接手星圖 App 的登入改版',
      nodeId: 'node-orion', nodeLabel: '獵戶', participantNodeIds: [], projectId: '', scope: '全域',
    });
    expect(entry.memoir).toEqual({ coverage: { start: day('2031-03-14'), end: day('2031-03-16') }, coverageText: '2031-03-14/2031-03-16' });
    // 主控台的更新時間是本機時間「YYYY-MM-DD HH:MM:SS」(沒有時區),依本機時間解析
    expect(entry.updatedAt).toBe(new Date(2031, 2, 16, 21, 4, 9).getTime());
    expect(entry.summary.startsWith('這三天我主要在處理星圖 App 的登入流程')).toBe(true);
    const detail = (await snapshot.readEntry(rel))!;
    expect(detail.memoirSections!.uncertain).toBe('- 北河二號提醒舊 Cookie 的時間,我記得是第二天下午,但不確定。');
    expect(detail.memoirSections!.sources).toContain('會議紀錄:meetings/star-app/');
    expect(detail.memoirSections!.body).toContain('學到的事');
    expect(detail.memoirSections!.body).not.toMatch(/## 來源|## 不確定之處/);
    expect(JSON.stringify(redactForRenderer(detail))).not.toMatch(/[A-Za-z]:\\Users/);
  });

  it('只有起日(主控台寫成 YYYY-MM-DD,代表單日)與寶庫也接受的「起日/」', async () => {
    const single = sample.replace('涵蓋期間: "2031-03-14/2031-03-16"', '涵蓋期間: "2031-03-15"');
    const open = sample.replace('涵蓋期間: "2031-03-14/2031-03-16"', '涵蓋期間: "2031-03-15/"');
    const snapshot = await new VaultReader(await setup({ [folder + 'a.md']: single, [folder + 'b.md']: open })).read();
    for (const path of [folder + 'a.md', folder + 'b.md']) {
      expect(snapshot.listEntries({ shelf: 'archive' }).find((entry) => entry.path === path)!.memoir!.coverage)
        .toEqual({ start: day('2031-03-15'), end: null });
    }
  });

  it('確認後只改狀態行,檔頭字串的引號保留', async () => {
    const root = await setup({ [rel]: sample });
    const reader = new VaultReader(root);
    const writer = new VaultWriter(root, () => reader.invalidate());
    const seen = (await (await reader.read()).readEntry(rel))!;
    expect(await writer.setStatus(rel, '已確認', seen)).toMatchObject({ ok: true });
    expect(await readFile(join(root, ...rel.split('/')), 'utf8')).toBe(sample.replace('狀態: "未確認"', '狀態: "已確認"'));
  });
});

describe('主控台接受的章節標題寫法(回憶錄審查必修 2)', () => {
  it('「## 來源:」「## **不確定之處**:」也拆得出來;整行註解裡的標題不算', async () => {
    const variant = sample
      .replace('## 來源', '## 來源:')
      .replace('## 不確定之處', '## **不確定之處**:')
      .replace('學到的事:', '<!--\n## 來源\n這段被註解掉了\n-->\n\n學到的事:');
    const snapshot = await new VaultReader(await setup({ [rel]: variant })).read();
    const detail = (await snapshot.readEntry(rel))!;
    expect(detail.memoirSections!.uncertain).toBe('- 北河二號提醒舊 Cookie 的時間,我記得是第二天下午,但不確定。');
    expect(detail.memoirSections!.sources).toContain('會議紀錄:meetings/star-app/');
    expect(detail.memoirSections!.sources).not.toContain('這段被註解掉了');
    expect(detail.memoirSections!.body).not.toMatch(/不確定之處|北河二號提醒/);
  });
});
