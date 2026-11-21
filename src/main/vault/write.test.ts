import { appendFile, chmod, cp, link, mkdtemp, open, readFile, readdir, rename, rm, stat, unlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VaultReader } from './index';
import { VaultWriter } from './write';

vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs/promises')>();
  return { ...fs, open: vi.fn(fs.open), link: vi.fn(fs.link), rename: vi.fn(fs.rename), unlink: vi.fn(fs.unlink) };
});

const fixtures = resolve('fixtures/memory-vault');
const draft = 'cases/月汐溫室/2026-0002-日報按採樣日期歸檔.md';
const bookmark = 'knowledge/月汐溫室/補齊開窗前後的讀值.md';
const recycled = '_回收/' + draft;
const ioError = (code: string) => Object.assign(new Error(code), { code });

async function version(path: string) {
  const { mtimeMs, size } = await stat(path);
  return { mtime: mtimeMs, size };
}

describe('記憶庫寫入契約', () => {
  let root: string;
  let writer: VaultWriter;
  let reader: VaultReader;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'nexus-vault-writes-'));
    await cp(fixtures, root, { recursive: true });
    reader = new VaultReader(root);
    writer = new VaultWriter(root, () => reader.invalidate());
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('確認與退回只改原狀態值，保留 BOM、CRLF、註解、未知檔頭與原始正文位元組', async () => {
    const target = join(root, draft);
    const prefix = Buffer.from('\uFEFF---\r\n種類: 判例\r\n2026: 註冊\r\n未知: [a, b]\r\n# 保留註解\r\n狀態 ：  "');
    const suffix = Buffer.concat([Buffer.from('" \t# 原始註解\r\n尾欄: 原樣\r\n--- \r\n# 原始正文\r\n'), Buffer.from([0xff, 0x00, 0xfa])]);
    const bytes = (status: string) => Buffer.concat([prefix, Buffer.from(status), suffix]);
    await writeFile(target, bytes('未確認'));
    const before = await reader.read();
    const seen = (await before.readEntry(draft))!;
    expect(seen.status).toBe('未確認');
    const confirmed = await writer.setStatus(draft, '已確認', seen);
    expect(confirmed.ok).toBe(true);
    expect(await readFile(target)).toEqual(bytes('已確認'));
    const next = await reader.read();
    expect(next).not.toBe(before);
    expect(await next.readEntry(draft)).toMatchObject({ status: '已確認' });
    expect(await writer.setStatus(draft, '退回', confirmed)).toMatchObject({ ok: true });
    expect(await readFile(target)).toEqual(bytes('退回'));
    expect(await readdir(dirname(target))).not.toEqual(expect.arrayContaining([expect.stringMatching(/\.tmp$/)]));
  });

  it('完成書籤、插入有效檔頭缺少的狀態欄位並拒絕無檔頭舊卷宗', async () => {
    const originalBookmark = await readFile(join(root, bookmark), 'utf8');
    expect(await writer.setStatus(bookmark, '已完成', await version(join(root, bookmark)))).toMatchObject({ ok: true });
    expect(await readFile(join(root, bookmark), 'utf8')).toBe(originalBookmark.replace('狀態: 未完', '狀態: 已完成'));

    const header = 'preferences/既有檔頭.md';
    const originalHeader = '---\r\n標題: 有 header\n其他欄位: 值\r\n---\n正文';
    await writeFile(join(root, header), originalHeader);
    expect(await writer.setStatus(header, '退回', await version(join(root, header)))).toMatchObject({ ok: true });
    expect(await readFile(join(root, header), 'utf8')).toBe(originalHeader.replace('值\r\n---', '值\r\n狀態: 退回\r\n---'));

    const legacy = 'preferences/正文舊檔.md';
    const legacyText = '# 正文\r\n保留行尾\r\n';
    await writeFile(join(root, legacy), legacyText);
    expect(await writer.setStatus(legacy, '退回', await version(join(root, legacy)))).toMatchObject({ ok: false, reason: 'legacy' });
    expect(await readFile(join(root, legacy), 'utf8')).toBe(legacyText);
    const moved = await writer.moveToRecycle(legacy, await version(join(root, legacy)));
    if (!moved.ok) throw new Error(moved.reason);
    expect(await readFile(join(root, moved.recycledPath), 'utf8')).toBe(legacyText);
    await expect(stat(join(root, legacy))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await writer.restoreFromRecycle(moved.recycledPath, moved)).toMatchObject({ ok: true });
    expect(await readFile(join(root, legacy), 'utf8')).toBe(legacyText);
  });

  it.each([
    '---\n這是正文而不是檔頭\n---\n正文',
    '---\n臨時備註: 無法判定的舊正文\n---\n正文',
    '---\n標題: 沒有結束分隔線\n',
    '---\n標題: 多行狀態\n狀態:\n # 註\n  - 未確認\n---\n正文',
    '---\n標題: 清單狀態\n狀態: [未確認]\n---\n正文',
    '---\n標題: 區塊狀態\n狀態: |\n  未確認\n---\n正文',
  ])('拒絕有歧義或不支援的檔頭 #%#', async (original) => {
    const target = join(root, draft);
    await writeFile(target, original);
    expect(await writer.setStatus(draft, '退回', await version(target))).toMatchObject({ ok: false, reason: 'legacy' });
    expect(await readFile(target, 'utf8')).toBe(original);
  });

  it('混用換行時保留目標行風格；英文別名與最後一個中文狀態值按解析順序處理', async () => {
    const target = join(root, draft);
    const english = '---\r\ntitle: 值\r\nstatus: 未確認\n---\r\n尾端\n';
    await writeFile(target, english);
    expect(await writer.setStatus(draft, '已確認', await version(target))).toMatchObject({ ok: true });
    expect(await readFile(target, 'utf8')).toBe(english.replace('status: 未確認', 'status: 已確認'));
    const both = '---\n標題: 值\r\nstatus: 退回\n狀態: 已確認\r\n狀態: 未確認\n---\r\n正文';
    await writeFile(target, both);
    expect(await writer.setStatus(draft, '已確認', await version(target))).toMatchObject({ ok: true });
    expect(await readFile(target, 'utf8')).toBe(both.replace('狀態: 未確認\n', '狀態: 已確認\n'));
  });

  it('舊版本與同時提交的第二筆寫入都不能覆寫', async () => {
    const target = join(root, draft);
    const initial = await version(target);
    await utimes(target, new Date(initial.mtime), new Date(initial.mtime + 3000));
    expect(await writer.setStatus(draft, '已確認', initial)).toMatchObject({ ok: false, reason: 'conflict' });
    const current = await version(target);
    const [first, second] = await Promise.all([writer.setStatus(draft, '已確認', current), writer.setStatus(draft, '退回', current)]);
    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: false, reason: 'conflict' });
    expect(await readFile(target, 'utf8')).toContain('狀態: 已確認');
  });

  it('暫存寫完後若主控台追加內容，最後比對會中止且清掉暫存', async () => {
    const target = join(root, draft);
    const initial = await version(target);
    const original = await readFile(target);
    const extra = Buffer.from('\n## 主控台補充\n外部更新。\n');
    const fs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(open)
      .mockImplementationOnce(fs.open)
      .mockImplementationOnce(async (...args) => {
        const handle = await fs.open(...args);
        const sync = handle.sync.bind(handle);
        vi.spyOn(handle, 'sync').mockImplementationOnce(async () => {
          await sync();
          await appendFile(target, extra);
        });
        return handle;
      });

    expect(await writer.setStatus(draft, '已確認', initial)).toMatchObject({ ok: false, reason: 'conflict' });
    expect(await readFile(target)).toEqual(Buffer.concat([original, extra]));
    expect((await readdir(dirname(target))).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('以回收後版本撤銷並完整還原位元組；保護附檔、拒絕無效路徑', async () => {
    const target = join(root, draft);
    const bytes = await readFile(target);
    const writes = join(root, '.nexus-writes.json');
    await writeFile(writes, '{"fixture":true}');
    const outcome = await writer.moveToRecycle(draft, await version(target));
    if (!outcome.ok) throw new Error(outcome.reason);
    expect(outcome.recycledPath).toBe(recycled);
    expect(await (await reader.read()).readEntry(draft)).toBeNull();
    expect(await readFile(join(root, recycled))).toEqual(bytes);
    expect(await writer.restoreFromRecycle(recycled, { ...outcome, mtime: outcome.mtime - 1 })).toMatchObject({ ok: false, reason: 'conflict' });
    expect(await writer.restoreFromRecycle(recycled, outcome)).toMatchObject({ ok: true });
    expect(await readFile(target)).toEqual(bytes);
    await expect(stat(join(root, recycled))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await writer.setStatus('.nexus-writes.json', '已確認', await version(writes))).toMatchObject({ ok: false, reason: 'io' });
    expect(await writer.moveToRecycle('cases/../' + draft, outcome)).toMatchObject({ ok: false, reason: 'io' });
    expect(await readFile(writes, 'utf8')).toBe('{"fixture":true}');
  });

  it('撤銷時即使另一份同名卷宗在最後一刻出現，也保留兩份', async () => {
    const target = join(root, draft);
    const original = await readFile(target);
    const outcome = await writer.moveToRecycle(draft, await version(target));
    if (!outcome.ok) throw new Error(outcome.reason);
    const fs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(link).mockImplementationOnce(async (...args) => {
      await writeFile(target, '後來新增的同名卷宗', { flag: 'wx' });
      await fs.link(...args);
    });
    expect(await writer.restoreFromRecycle(recycled, outcome)).toMatchObject({ ok: false, reason: 'occupied' });
    expect(await readFile(target, 'utf8')).toBe('後來新增的同名卷宗');
    expect(await readFile(join(root, recycled))).toEqual(original);
  });

  it('同一路徑回收多次會跳過既有名稱及序號；撤銷只還原那次的檔案', async () => {
    const target = join(root, draft);
    const bytes = await readFile(target);
    const first = await writer.moveToRecycle(draft, await version(target));
    expect(first).toMatchObject({ ok: true, recycledPath: recycled, originalPath: draft });
    const secondKey = recycled.replace(/\.md$/, ' (2).md');
    const thirdKey = recycled.replace(/\.md$/, ' (3).md');
    await writeFile(join(root, secondKey), '先前回收的同名檔');
    const newBytes = Buffer.concat([bytes, Buffer.from('\n新卷宗的正文。')]);
    await writeFile(target, newBytes);
    const later = await writer.moveToRecycle(draft, await version(target));
    expect(later).toMatchObject({ ok: true, recycledPath: thirdKey, originalPath: draft });
    if (!later.ok) throw new Error(later.reason);
    expect(await writer.readRecycledEntry(later.recycledPath, draft)).toMatchObject({ title: expect.any(String), size: newBytes.length });
    expect(await writer.restoreFromRecycle(later.recycledPath, later)).toMatchObject({ ok: true });
    expect(await readFile(target)).toEqual(newBytes);
    expect(await readFile(join(root, recycled))).toEqual(bytes);
    expect(await readFile(join(root, secondKey), 'utf8')).toBe('先前回收的同名檔');
  });

  it('回收第二次使用 (2)，若原檔本來就有 (2) 則還原時保留原名', async () => {
    const key = draft.replace(/\.md$/, ' (2).md');
    const target = join(root, key);
    const bytes = await readFile(join(root, draft));
    for (let index = 0; index < 2; index++) {
      await writeFile(target, bytes);
      const outcome = await writer.moveToRecycle(key, await version(target));
      expect(outcome).toMatchObject({ ok: true, originalPath: key,
        recycledPath: '_回收/' + (index ? key.replace(/\.md$/, ' (2).md') : key) });
      if (outcome.ok) {
        if (index) expect(await writer.restoreFromRecycle(outcome.recycledPath, outcome)).toMatchObject({ ok: true });
        else {
          expect(await writer.readRecycledEntry(outcome.recycledPath, draft)).toBeNull();
          expect(await writer.restoreFromRecycle(outcome.recycledPath, { ...outcome, originalPath: draft }))
            .toMatchObject({ ok: false });
        }
      }
    }
    expect(await readFile(target)).toEqual(bytes);
  });

  it('遇 Windows 佔用會重試，成功版本以改名後的 lstat 為準', async () => {
    const target = join(root, draft);
    const fs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const changed = new Date('2030-01-01');
    vi.mocked(rename).mockRejectedValueOnce(ioError('EBUSY')).mockRejectedValueOnce(ioError('EACCES'))
      .mockImplementationOnce(async (...args) => {
        await fs.rename(...args);
        await utimes(target, changed, changed);
      });
    const result = await writer.setStatus(draft, '已確認', await version(target));
    expect(result).toEqual({ ok: true, ...(await version(target)) });
    expect(result).toMatchObject({ mtime: changed.getTime() });
  });

  it('改名重試前重新比對，休息期間有外部追加就停止', async () => {
    const target = join(root, draft);
    const original = await readFile(target);
    const expected = await version(target);
    const extra = Buffer.from('\n在佔用期間追加的資料。');
    const calls = vi.mocked(rename).mock.calls.length;
    vi.mocked(rename).mockImplementationOnce(async () => {
      await appendFile(target, extra);
      throw ioError('EPERM');
    });
    expect(await writer.setStatus(draft, '已確認', expected)).toMatchObject({ ok: false, reason: 'conflict' });
    expect(vi.mocked(rename).mock.calls.length).toBe(calls + 1);
    expect(await readFile(target)).toEqual(Buffer.concat([original, extra]));
  });

  it('唯讀檔回傳明確原因，清理失敗則僅回傳相對暫存檔名', async () => {
    const target = join(root, draft);
    const original = await readFile(target);
    await chmod(target, 0o444);
    try {
      expect(await writer.setStatus(draft, '已確認', await version(target))).toMatchObject({ ok: false, reason: 'readonly' });
      expect((await readdir(dirname(target))).filter((item) => item.endsWith('.tmp'))).toEqual([]);
    } finally {
      await chmod(target, 0o666);
    }
    for (let attempt = 0; attempt < 5; attempt++) vi.mocked(rename).mockRejectedValueOnce(ioError('EPERM'));
    vi.mocked(unlink).mockRejectedValueOnce(ioError('EPERM')).mockRejectedValueOnce(ioError('EPERM'));
    const outcome = await writer.setStatus(draft, '已確認', await version(target));
    expect(outcome).toMatchObject({ ok: false, reason: 'io', residualPath: /^cases\/月汐溫室\/\.vault-write-[^/]+\.tmp$/ });
    expect(await readFile(target)).toEqual(original);
  });

  it('硬連結不受支援時以獨佔複製完成回收與還原，位元組一致', async () => {
    const target = join(root, draft);
    const bytes = await readFile(target);
    vi.mocked(link).mockRejectedValueOnce(ioError('ENOTSUP')).mockRejectedValueOnce(ioError('EXDEV'));
    const outcome = await writer.moveToRecycle(draft, await version(target));
    expect(outcome).toMatchObject({ ok: true, recycledPath: recycled });
    if (!outcome.ok) throw new Error(outcome.reason);
    await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(root, recycled))).toEqual(bytes);
    expect(await writer.restoreFromRecycle(recycled, outcome)).toMatchObject({ ok: true, size: bytes.length });
    expect(await readFile(target)).toEqual(bytes);
  });

  it.each([false, true])('來源無法刪除時清理目的檔，保留來源（複製備援 %s）', async (fallback) => {
    const target = join(root, draft);
    const bytes = await readFile(target);
    if (fallback) vi.mocked(link).mockRejectedValueOnce(ioError('EPERM'));
    vi.mocked(unlink).mockRejectedValueOnce(ioError('EBUSY'));
    expect(await writer.moveToRecycle(draft, await version(target))).toMatchObject({ ok: false, reason: fallback ? 'recycle-io' : 'io' });
    expect(await readFile(target)).toEqual(bytes);
    expect((await stat(target)).nlink).toBe(1);
    await expect(stat(join(root, recycled))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('複製備援驗證內容不一致時清掉副本並保留原卷宗', async () => {
    const target = join(root, draft);
    const bytes = await readFile(target);
    const fs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(link).mockRejectedValueOnce(ioError('ENOTSUP'));
    vi.mocked(open).mockImplementationOnce(fs.open).mockImplementationOnce(async (...args) => {
      const out = await fs.open(...args);
      const realWrite = out.writeFile.bind(out);
      vi.spyOn(out, 'writeFile').mockImplementationOnce(() => realWrite(Buffer.alloc(bytes.length)));
      return out;
    });
    expect(await writer.moveToRecycle(draft, await version(target))).toMatchObject({ ok: false, reason: 'recycle-io' });
    expect(await readFile(target)).toEqual(bytes);
    await expect(stat(join(root, recycled))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['nodes/紙鷺.md', 'nodes/封存/夜苔-2026-11-18.md'])('禁止回收或改狀態：%s', async (key) => {
    const target = join(root, key);
    const bytes = await readFile(target);
    const expected = await version(target);
    expect(await writer.moveToRecycle(key, expected)).toMatchObject({ ok: false, reason: 'io' });
    expect(await writer.setStatus(key, '退回', expected)).toMatchObject({ ok: false, reason: 'io' });
    expect(await readFile(target)).toEqual(bytes);
  });

  it('未編號及 2 至 99 全部被佔用時，拒絕回收並保留來源及所有既有檔案', async () => {
    const target = join(root, draft);
    const prior = await readFile(target);
    const original = await writer.moveToRecycle(draft, await version(target));
    expect(original.ok).toBe(true);
    await writeFile(target, prior);
    for (let index = 2; index <= 99; index++) {
      await writeFile(join(root, recycled.replace(/\.md$/, ' (' + index + ').md')), '已回收 ' + index);
    }
    expect(await writer.moveToRecycle(draft, await version(target))).toMatchObject({ ok: false, reason: 'occupied' });
    expect(await readFile(target)).toEqual(prior);
    expect(await readdir(dirname(join(root, recycled)))).toHaveLength(99);
  });
});
