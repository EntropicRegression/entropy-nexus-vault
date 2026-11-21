import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VaultReader } from './index';
import { heatFilename } from './sidecars';

const { open } = vi.hoisted(() => ({ open: vi.fn() }));

vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs/promises')>();
  return { ...fs, open, readFile: vi.fn(fs.readFile) };
});

describe('讀取期間檔案有變動', () => {
  const relative = 'preferences/sample.md';
  let root: string;

  beforeEach(async () => {
    open.mockReset();
    root = await mkdtemp(join(tmpdir(), 'entropy-vault-scan-'));
    await mkdir(join(root, 'preferences'));
    await writeFile(join(root, relative), '# 卷宗\n');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function handle(versionChanged: boolean, onRead?: () => Promise<void>) {
    const before = await lstat(join(root, relative));
    const close = vi.fn(async () => {});
    const fake = {
      stat: vi.fn().mockResolvedValueOnce(before).mockResolvedValueOnce(
        versionChanged ? { ...before, mtimeMs: before.mtimeMs + 1, isFile: () => true } : before,
      ),
      readFile: vi.fn(async () => {
        await onRead?.();
        return versionChanged ? '# 讀到一半' : '# 已完成';
      }),
      close,
    };
    open.mockResolvedValueOnce(fake);
    return close;
  }

  it('第一次改寫後重新開檔，使用第二次穩定的內容', async () => {
    const closeFirst = await handle(true);
    const closeSecond = await handle(false);

    const snapshot = await new VaultReader(root).read();

    expect(await snapshot.readEntry(relative)).toMatchObject({ title: '已完成' });
    expect(open).toHaveBeenCalledTimes(2);
    expect(closeFirst).toHaveBeenCalledOnce();
    expect(closeSecond).toHaveBeenCalledOnce();
  });

  it('連續兩次改寫則暫時略過，下次取快照再讀', async () => {
    await handle(true);
    await handle(true);
    const reader = new VaultReader(root);

    expect(await (await reader.read()).readEntry(relative)).toBeNull();
    expect(open).toHaveBeenCalledTimes(2);
    await handle(false);
    expect(await (await reader.read()).readEntry(relative)).toMatchObject({ title: '已完成' });
    expect(open).toHaveBeenCalledTimes(3);
  });

  it('原子換檔時，即使舊 handle 版本穩定，也會重新開啟路徑', async () => {
    const original = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    await handle(false, async () => {
      const target = join(root, relative);
      await writeFile(target + '.tmp', '# 換檔完成');
      await rename(target + '.tmp', target);
    });
    open.mockImplementationOnce(original.open);

    const snapshot = await new VaultReader(root).read();
    expect(await snapshot.readEntry(relative)).toMatchObject({ title: '換檔完成' });
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('併發讀取共用快照，穩定的快照命中時不重新開卷宗', async () => {
    await handle(false);
    const reader = new VaultReader(root);
    const pending = reader.read();
    expect(reader.read()).toBe(pending);
    const snapshot = await pending;
    expect(await reader.read()).toBe(snapshot);
    expect(open).toHaveBeenCalledOnce();
  });

  it('附檔暫時鎖定時，即使版本未變，下次仍會重試讀取', async () => {
    await writeFile(join(root, heatFilename), JSON.stringify({ [relative]: { 召回次數: 7 } }));
    vi.mocked(readFile).mockRejectedValueOnce(Object.assign(new Error('附檔被鎖定'), { code: 'EBUSY' }));
    await handle(false);
    await handle(false);
    const reader = new VaultReader(root);

    expect(await (await reader.read()).readEntry(relative)).toMatchObject({ heat: { count: 0 } });
    expect(await (await reader.read()).readEntry(relative)).toMatchObject({ heat: { count: 7 } });
  });
});
