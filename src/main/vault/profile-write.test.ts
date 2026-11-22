import { appendFile, chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, rmdir, stat, symlink, unlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatLocalAppendixTime, profileSections } from './profile-content';
import { VaultWriter } from './write';

vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs/promises')>();
  return { ...fs, rename: vi.fn(fs.rename), unlink: vi.fn(fs.unlink) };
});

const nodeId = 'synthetic-profile';
const key = 'nodes/星砂.md';
const archived = 'nodes/封存/星砂-2026-11-20-2.md';
const header = Buffer.concat([
  Buffer.from('\uFEFF---\r\n種類: 節點側寫\r\n節點ID: synthetic-profile\r\n完成數: 3  # 固定\r\n接回自: old-node\r\n# '),
  Buffer.from([0xff]), Buffer.from(' raw comment\r\n---\r\n'),
]);
const user = '\r\n## 特長\r\n\r\n原側寫。見「C:\\Users\\Synthetic\\one file.md」與「/home/synthetic/two.md」。\r\n\r\n## 回顧\r\n\r\n原回顧';
const appendixText = '\n\n## 主控台補充(2026-11-21 06:00)\n\n第一段\n## 特長\n主控台的特長不能取代原文。\n' +
  '\n## 主控台補充(2026-11-22 07:10)\r\n\r\n第二段\r\n';
const appendix = Buffer.concat([Buffer.from(appendixText), Buffer.from([0xfe, 0x0a])]);
const original = Buffer.concat([header, Buffer.from(user), appendix]);
const lockedError = () => Object.assign(new Error('simulated locked file'), { code: 'EBUSY' });

describe('節點側寫編輯契約', () => {
  let root: string;
  let target: string;
  let writer: VaultWriter;
  let selected: string | undefined;
  const lookup = async (id: string) => id === nodeId ? selected : undefined;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'nexus-profile-edit-'));
    await mkdir(join(root, 'nodes', '封存'), { recursive: true });
    target = join(root, key);
    await writeFile(target, original);
    writer = new VaultWriter(root);
    selected = key;
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function readDraft() {
    const result = await writer.readProfileForEdit(nodeId, lookup);
    if (!result.ok) throw Error(result.reason);
    return result;
  }

  it('換回所有原路徑，BOM、檔頭、原換行風格與補充原始位元組全保留，正文內的檔頭只算文字', async () => {
    const draft = await readDraft();
    expect(draft.body).toContain('「⟦路徑1⟧」與「⟦路徑2⟧」');
    expect(draft.body).toContain('原回顧');
    expect(draft.body).not.toMatch(/Synthetic|\/home\/|補充|完成數/);
    const edited = draft.body.replace('原側寫。', '新側寫。') + '\n\n---\n節點ID: injected\n---';
    const saved = await writer.saveProfileBody(nodeId, edited, draft.version, lookup);
    expect(saved.ok).toBe(true);
    if (!saved.ok) throw Error(saved.reason);
    const expectedUser = user.replace('原側寫。', '新側寫。') + '\r\n\r\n---\r\n節點ID: injected\r\n---';
    expect(await readFile(target)).toEqual(Buffer.concat([header, Buffer.from(expectedUser), appendix]));
    const info = await stat(target);
    expect(saved.version).toMatchObject({ mtime: info.mtimeMs, size: info.size, editToken: draft.version.editToken });
    expect(saved.version.identity).not.toBe(draft.version.identity);
    expect((await writer.saveProfileBody(nodeId, edited, draft.version, lookup))).toMatchObject({ ok: false, reason: 'conflict' });
    expect((await writer.saveProfileBody(nodeId, edited.replace('新側寫', '再編輯'), saved.version, lookup)).ok).toBe(true);
  });

  it.each([
    ['modified-or-unknown', (body: string) => body.replace('⟦路徑1⟧', '⟦路徑三⟧')],
    ['modified-or-unknown', (body: string) => body.replace('⟦路徑1⟧', '⟦路經1⟧')],
    ['modified-or-unknown', (body: string) => body.replace('⟦路徑1⟧', '路徑1⟧')],
    ['duplicate', (body: string) => body + '\n⟦路徑1⟧'],
    ['modified-or-unknown', (body: string) => body + '\n⟦路徑99⟧'],
    ['modified-or-unknown', (body: string) => body + '\n⟦路徑2'],
  ])('拒絕無效佔位符 %s', async (issue, change) => {
    const draft = await readDraft();
    expect(await writer.saveProfileBody(nodeId, change(draft.body), draft.version, lookup, { acknowledgedRemovals: [1] })).toEqual({
      ok: false, reason: 'invalid-placeholders', issue,
    });
    expect(await readFile(target)).toEqual(original);
    expect(await readdir(join(root, 'nodes'))).toEqual(['封存', '星砂.md']);
  });

  it('先回需要確認的編號與永久刪除說明，確認缺少的編號後才刪除路徑原文', async () => {
    const draft = await readDraft();
    const edited = draft.body.replace('見「⟦路徑1⟧」與', '見');
    const warning = await writer.saveProfileBody(nodeId, edited, draft.version, lookup);
    expect(warning).toMatchObject({ ok: false, reason: 'invalid-placeholders', issue: 'missing', missingPlaceholders: [1],
      message: expect.stringMatching(/#1.*永久移除/) });
    expect(JSON.stringify(warning)).not.toContain('Synthetic');
    expect(await readFile(target)).toEqual(original);
    const saved = await writer.saveProfileBody(nodeId, edited, draft.version, lookup, { acknowledgedRemovals: [1] });
    if (!saved.ok) throw Error(saved.reason);
    const updated = Buffer.concat([header, Buffer.from(user.replace('見「C:\\Users\\Synthetic\\one file.md」與', '見')), appendix]);
    expect(await readFile(target)).toEqual(updated);
    expect((await writer.saveProfileBody(nodeId, edited, saved.version, lookup)).ok).toBe(true);
    expect(await readFile(target)).toEqual(updated);
    const newDraft = await readDraft();
    expect(newDraft.body).toContain('見「⟦路徑1⟧」');
    expect(newDraft.body).not.toContain('⟦路徑2⟧');
  });

  it('缺少多枚佔位符時必須確認完整集合，且不得同時確認仍存在的編號', async () => {
    const draft = await readDraft();
    const oneMissing = draft.body.replace('⟦路徑1⟧', '');
    const bothMissing = oneMissing.replace('⟦路徑2⟧', '');
    const save = (body: string, acknowledgedRemovals: number[]) =>
      writer.saveProfileBody(nodeId, body, draft.version, lookup, { acknowledgedRemovals });
    expect(await save(bothMissing, [1])).toMatchObject({ issue: 'missing', missingPlaceholders: [1, 2],
      message: expect.stringContaining('#1、#2') });
    for (const wrong of [[1, 2], [1, 1], [1, 999], [0]]) {
      expect(await save(oneMissing, wrong)).toEqual({ ok: false, reason: 'invalid-input' });
    }
    expect(await readFile(target)).toEqual(original);
    expect((await save(bothMissing, [2, 1])).ok).toBe(true);
    expect(await readFile(target)).toEqual(Buffer.concat([
      header, Buffer.from(user.replace('C:\\Users\\Synthetic\\one file.md', '').replace('/home/synthetic/two.md', '')), appendix,
    ]));
  });

  it('改名失敗不會消耗已確認刪除的佔位符', async () => {
    const draft = await readDraft();
    const edit = draft.body.replace('⟦路徑2⟧', '');
    vi.mocked(rename).mockRejectedValueOnce(Object.assign(Error('disk fault'), { code: 'ENOSPC' }));
    const save = () => writer.saveProfileBody(nodeId, edit, draft.version, lookup, { acknowledgedRemovals: [2] });
    expect(await save()).toEqual({ ok: false, reason: 'io' });
    expect(await readFile(target)).toEqual(original);
    expect((await save()).ok).toBe(true);
    expect(await readFile(target, 'utf8')).not.toContain('/home/synthetic/two.md');
  });

  it('編輯文件已有的同形標記時，讀寫無變更仍可逐位元組往返', async () => {
    const literal = Buffer.concat([header, Buffer.from(user + '\n範例：⟦路徑2⟧\n不同行的換行'), appendix]);
    await writeFile(target, literal);
    const draft = await readDraft();
    expect(draft.body).toContain('範例：⟦路徑3⟧');
    expect((await writer.saveProfileBody(nodeId, draft.body, draft.version, lookup)).ok).toBe(true);
    expect(await readFile(target)).toEqual(literal);
  });

  it('同一草稿重複儲存新增的文末空行時，補充分隔符不會重複累加', async () => {
    const draft = await readDraft();
    const edit = draft.body + '\n\n';
    const saved = await writer.saveProfileBody(nodeId, edit, draft.version, lookup);
    if (!saved.ok) throw Error(saved.reason);
    const once = await readFile(target);
    expect(once).toEqual(Buffer.concat([header, Buffer.from(user + '\r\n\r\n'), appendix]));
    expect((await writer.saveProfileBody(nodeId, edit, saved.version, lookup)).ok).toBe(true);
    expect(await readFile(target)).toEqual(once);
  });

  it('拒絕新增補充標記或未關閉的程式碼區塊吞掉既有補充', async () => {
    const draft = await readDraft();
    for (const suffix of ['\n\n## 主控台補充(2026-11-23 08:00)\n偽造補充', '\n\n~~~\n未完成']) {
      expect(await writer.saveProfileBody(nodeId, draft.body + suffix, draft.version, lookup)).toEqual({ ok: false, reason: 'appendix-marker' });
    }
    expect(await readFile(target)).toEqual(original);
  });

  it('真正的主控台補充標記落在歷史未閉合區塊內時拒絕編輯', async () => {
    const malformed = Buffer.concat([header, Buffer.from('~~~\n程式碼區塊未關閉'), appendix]);
    await writeFile(target, malformed);
    expect(await writer.readProfileForEdit(nodeId, lookup)).toEqual({ ok: false, reason: 'appendix-marker' });
    expect(await readFile(target)).toEqual(malformed);
  });

  it('草稿與同節點的最新讀取綁定，不接受其他節點或已換成其他節點 ID 的檔案', async () => {
    const draft = await readDraft();
    const current = await readDraft();
    expect(await writer.saveProfileBody(nodeId, draft.body, draft.version, lookup)).toEqual({ ok: false, reason: 'edit-session' });
    expect(await writer.saveProfileBody('other-node', current.body, current.version, lookup)).toEqual({ ok: false, reason: 'edit-session' });
    const replacement = original.toString('utf8').replace('節點ID: synthetic-profile', '節點ID: other-node');
    await writeFile(target, replacement);
    expect(await writer.readProfileForEdit(nodeId, lookup)).toEqual({ ok: false, reason: 'conflict' });
    expect(await readFile(target, 'utf8')).toBe(replacement);
  });

  it('目前側寫更換時拒絕儲存，其他卷宗路徑無法取得編輯版本', async () => {
    const draft = await readDraft();
    selected = archived;
    await writeFile(join(root, archived), original);
    expect(await writer.saveProfileBody(nodeId, draft.body, draft.version, lookup)).toMatchObject({ ok: false, reason: 'conflict' });
    expect(await readFile(target)).toEqual(original);
    expect(await readFile(join(root, archived))).toEqual(original);
    expect((await readDraft()).body).toBe(draft.body);
    selected = 'knowledge/假側寫.md';
    expect(await writer.readProfileForEdit(nodeId, lookup)).toEqual({ ok: false, reason: 'missing' });
    selected = undefined;
    expect(await writer.readProfileForEdit(nodeId, lookup)).toEqual({ ok: false, reason: 'missing' });
  });

  it('回絕以相同 mtime 與大小換成不同 inode 的檔案', async () => {
    const draft = await readDraft();
    const other = join(root, 'replacement');
    await writeFile(other, original);
    const source = await stat(target);
    await utimes(other, source.atime, source.mtime);
    await rename(other, target);
    expect(await writer.saveProfileBody(nodeId, draft.body, draft.version, lookup)).toMatchObject({ ok: false, reason: 'conflict' });
    expect(await readFile(target)).toEqual(original);
  });

  it('工作檔被佔用時重試，再比對並保護重試期間的主控台附加', async () => {
    const draft = await readDraft();
    const renameMock = vi.mocked(rename);
    renameMock.mockRejectedValueOnce(lockedError());
    expect((await writer.saveProfileBody(nodeId, draft.body, draft.version, lookup)).ok).toBe(true);

    const later = await readDraft();
    const consoleWrite = '\n\n## 主控台補充(2026-11-24 03:01)\n\n同期更新\n';
    renameMock.mockImplementationOnce(async () => {
      await appendFile(target, consoleWrite);
      throw lockedError();
    });
    expect(await writer.saveProfileBody(nodeId, later.body, later.version, lookup)).toMatchObject({ ok: false, reason: 'conflict' });
    expect(await readFile(target)).toEqual(Buffer.concat([original, Buffer.from(consoleWrite)]));
    expect(await readdir(join(root, 'nodes'))).toEqual(['封存', '星砂.md']);
  });

  it('改名失敗清除自己的暫存檔，保留原檔並允許同一草稿重試', async () => {
    const draft = await readDraft();
    vi.mocked(rename).mockRejectedValueOnce(Object.assign(Error('disk fault'), { code: 'ENOSPC' }));
    expect(await writer.saveProfileBody(nodeId, draft.body, draft.version, lookup)).toEqual({ ok: false, reason: 'io' });
    expect(await readFile(target)).toEqual(original);
    expect(await readdir(join(root, 'nodes'))).toEqual(['封存', '星砂.md']);
    expect((await writer.saveProfileBody(nodeId, draft.body, draft.version, lookup)).ok).toBe(true);
  });

  it('自身暫存檔第一次無法刪除時短暫重試清除', async () => {
    const draft = await readDraft();
    vi.mocked(rename).mockRejectedValueOnce(Object.assign(Error('disk fault'), { code: 'ENOSPC' }));
    vi.mocked(unlink).mockRejectedValueOnce(lockedError()).mockRejectedValueOnce(lockedError());
    expect(await writer.saveProfileBody(nodeId, draft.body, draft.version, lookup)).toEqual({ ok: false, reason: 'io' });
    expect(await readFile(target)).toEqual(original);
    expect(await readdir(join(root, 'nodes'))).toEqual(['封存', '星砂.md']);
  });

  it('舊格式、正文非 UTF-8、唯讀與指向外部的連結皆不動檔案', async () => {
    await writeFile(target, '# 沒有檔頭');
    expect(await writer.readProfileForEdit(nodeId, lookup)).toEqual({ ok: false, reason: 'legacy' });
    await writeFile(target, Buffer.concat([header, Buffer.from([0xff])]));
    expect(await writer.readProfileForEdit(nodeId, lookup)).toEqual({ ok: false, reason: 'encoding' });
    const outside = join(root, 'other');
    await mkdir(outside);
    await writeFile(join(outside, '副本.md'), original);
    await rmdir(join(root, 'nodes', '封存'));
    await symlink(outside, join(root, 'nodes', '封存'), 'junction');
    selected = 'nodes/封存/副本.md';
    expect(await writer.readProfileForEdit(nodeId, lookup)).toEqual({ ok: false, reason: 'missing' });
    expect(await readFile(join(outside, '副本.md'))).toEqual(original);
    selected = key;
    await writeFile(target, original);
    await chmod(target, 0o444);
    try {
      const input = await readDraft();
      expect(await writer.saveProfileBody(nodeId, input.body, input.version, lookup)).toEqual({ ok: false, reason: 'readonly' });
    } finally {
      await chmod(target, 0o666);
    }
  });
});

it('依 UTC 時間標題分節，使用者與各段補充的回顧從正文分開提供', () => {
  const text = user + appendixText.replace('第一段', '第一段\n## 回顧\n補充的回顧');
  const profile = profileSections(text);
  expect(profile.body).toContain('原側寫');
  expect(profile.body).not.toMatch(/原回顧|第一段/);
  expect(profile.review).toBe('原回顧');
  expect(profile.appendices).toEqual([
    { at: '2026-11-21 06:00', localTime: expect.stringContaining('（本機時間）'),
      text: '第一段\n## 特長\n主控台的特長不能取代原文。', review: '補充的回顧' },
    { at: '2026-11-22 07:10', localTime: expect.stringContaining('（本機時間）'), text: '第二段', review: '' },
  ]);
});

it('以 UTC 轉本機時間，涵蓋同日、前一日與次日，保留原始標題的分隔符', () => {
  expect(formatLocalAppendixTime('2026-11-22 07:00', 'Asia/Taipei')).toBe('2026-11-22 15:00（本機時間）');
  expect(formatLocalAppendixTime('2026-11-22 23:55', 'Asia/Taipei')).toBe('2026-11-23 07:55（本機時間）');
  expect(formatLocalAppendixTime('2026-11-22 00:10', 'America/Los_Angeles')).toBe('2026-11-21 16:10（本機時間）');
  expect(formatLocalAppendixTime('2026-02-30 00:10', 'Asia/Taipei')).toBeNull();
  const date = new Date('2026-11-22T07:00:00Z');
  const pad = (value: number) => String(value).padStart(2, '0');
  const local = date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
    ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + '（本機時間）';
  expect(profileSections('## 主控台補充(2026-11-22T07:00)\n二級節').appendices[0]).toMatchObject({
    at: '2026-11-22T07:00', localTime: local,
  });
});
