import { mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FileVersion } from '../../shared/types';
import { awardsFilename, readAwards, writeAward } from './awards';

const scratch: string[] = [];
const now = () => Date.parse('2026-11-22T10:00:00.000Z');

async function vault() {
  const root = await mkdtemp(join(tmpdir(), 'vault-awards-'));
  scratch.push(root);
  return root;
}

async function version(root: string): Promise<FileVersion> {
  const info = await stat(join(root, awardsFilename));
  return { mtime: info.mtimeMs, size: info.size };
}

afterEach(async () => {
  await Promise.all(scratch.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('.vault-awards.json(DESIGN.md §6.9、docs/架構.md §9.3)', () => {
  it('頒發與撤回:沒有檔時 expected 為 null;撤回刪掉該筆', async () => {
    const root = await vault();
    expect(await readAwards(root, ['n1'])).toEqual({ awards: new Map(), version: null, corrupt: false });
    const granted = await writeAward(root, 'n1', { reason: '  主導安全\n設計 ' }, null, now);
    expect(granted).toMatchObject({ ok: true, award: { awardedAt: '2026-11-22T10:00:00.000Z', reason: '主導安全 設計' } });
    expect(JSON.parse(await readFile(join(root, awardsFilename), 'utf8')))
      .toEqual({ 版本: 1, 頒發: { n1: { 等級: '彩虹', 頒發時間: '2026-11-22T10:00:00.000Z', 理由: '主導安全 設計' } } });
    const state = await readAwards(root, ['n1', 'n2']);
    expect([...state.awards.keys()]).toEqual(['n1']);
    const withdrawn = await writeAward(root, 'n1', null, state.version, now);
    expect(withdrawn).toMatchObject({ ok: true, award: null });
    expect(JSON.parse(await readFile(join(root, awardsFilename), 'utf8'))).toEqual({ 版本: 1, 頒發: {} });
  });

  it('版本不符(外部先改了檔)回 conflict,檔案不動', async () => {
    const root = await vault();
    await writeAward(root, 'n1', { reason: '' }, null, now);
    const read = await version(root);
    await writeFile(join(root, awardsFilename), JSON.stringify({ 版本: 1, 頒發: { other: { 等級: '彩虹', 頒發時間: '2026-11-21T00:00:00.000Z', 理由: '外部' } } }));
    await utimes(join(root, awardsFilename), new Date(), new Date(Date.now() + 5000));
    const before = await readFile(join(root, awardsFilename), 'utf8');
    const result = await writeAward(root, 'n2', { reason: '' }, read, now);
    expect(result).toMatchObject({ ok: false, reason: 'conflict' });
    expect(await readFile(join(root, awardsFilename), 'utf8')).toBe(before);
    // Expecting "no file" while one exists is also a conflict.
    expect(await writeAward(root, 'n2', { reason: '' }, null, now)).toMatchObject({ ok: false, reason: 'conflict' });
  });

  it('損毀的檔視為沒有頒發,寫入回 corrupt 且不覆寫', async () => {
    const root = await vault();
    await writeFile(join(root, awardsFilename), '{ 壞掉');
    const state = await readAwards(root, ['n1']);
    expect(state).toMatchObject({ corrupt: true, awards: new Map() });
    expect(await writeAward(root, 'n1', { reason: '' }, state.version, now)).toMatchObject({ ok: false, reason: 'corrupt' });
    expect(await readFile(join(root, awardsFilename), 'utf8')).toBe('{ 壞掉');
    await writeFile(join(root, awardsFilename), JSON.stringify({ 版本: 2, 頒發: {} }));
    expect((await readAwards(root, ['n1'])).corrupt).toBe(true);
  });

  it('理由超過 80 字、壞的 expected 或空節點 ID 回 invalid', async () => {
    const root = await vault();
    expect(await writeAward(root, 'n1', { reason: '字'.repeat(81) }, null, now)).toEqual({ ok: false, reason: 'invalid' });
    expect(await writeAward(root, 'n1', { reason: '字'.repeat(80) }, null, now)).toMatchObject({ ok: true });
    expect(await writeAward(root, 'n2', { reason: '' }, { mtime: 'x', size: 1 }, now)).toEqual({ ok: false, reason: 'invalid' });
    expect(await writeAward(root, '', { reason: '' }, null, now)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('不認得的鍵與壞掉的單筆原樣保留,只改自己那筆', async () => {
    const root = await vault();
    const original = { 版本: 1, 備註: '保留', 頒發: { stranger: { 等級: '金', 頒發時間: 'x' }, n1: { 等級: '彩虹', 頒發時間: '2026-11-01T00:00:00.000Z', 理由: '' } } };
    await writeFile(join(root, awardsFilename), JSON.stringify(original));
    const state = await readAwards(root, ['n1', 'stranger']);
    expect([...state.awards.keys()]).toEqual(['n1']);
    await writeAward(root, 'n2', { reason: '新' }, state.version, now);
    const saved = JSON.parse(await readFile(join(root, awardsFilename), 'utf8'));
    expect(saved.備註).toBe('保留');
    expect(saved.頒發.stranger).toEqual(original.頒發.stranger);
    expect(saved.頒發.n1).toEqual(original.頒發.n1);
    expect(saved.頒發.n2).toMatchObject({ 等級: '彩虹', 理由: '新' });
  });

  it('看起來像路徑的節點 ID 存成雜湊,檔案內容沒有路徑', async () => {
    const root = await vault();
    const legacy = 'legacy:nodes/C:/Users/Someone/夜苔.md';
    await writeAward(root, legacy, { reason: '' }, null, now);
    const text = await readFile(join(root, awardsFilename), 'utf8');
    expect(text).not.toMatch(/[a-z]:[\\/]|Users|nodes\//i);
    expect((await readAwards(root, [legacy])).awards.has(legacy)).toBe(true);
  });
});
