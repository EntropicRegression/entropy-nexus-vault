import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { GalaxyBridge } from '../../shared/galaxies';
import { GalaxyLayoutStore, GalaxySettingsStore } from './galaxy-store';

const vaultA = 'v_' + 'a'.repeat(24);
const vaultB = 'v_' + 'b'.repeat(24);
const p = (letter: string) => 'p_' + letter.repeat(24);
const bridge = (a: string, b: string, count: number): GalaxyBridge =>
  ({ a: a < b ? a : b, b: a < b ? b : a, delegations: count, meetings: 0, dual: 0, count, weight: 1 });
const scratch: string[] = [];
const now = () => Date.parse('2026-11-22T10:00:00.000Z');
const noSleep = { sleep: async () => {} };

async function dir() {
  const path = await mkdtemp(join(tmpdir(), 'vault-galaxy-store-'));
  scratch.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(scratch.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('userData/galaxy-layout.json', () => {
  it('第一次放置後寫檔;新程序讀回同樣座標,之後新增星系也不移動舊的', async () => {
    const file = join(await dir(), 'galaxy-layout.json');
    const first = await new GalaxyLayoutStore(file, now).positions(vaultA, [p('a'), p('b')], [bridge(p('a'), p('b'), 2)]);
    const reread = await new GalaxyLayoutStore(file, now).positions(vaultA, [p('a'), p('b'), p('c')], [bridge(p('c'), p('a'), 9)]);
    expect(reread.get(p('a'))).toEqual(first.get(p('a')));
    expect(reread.get(p('b'))).toEqual(first.get(p('b')));
    expect(reread.has(p('c'))).toBe(true);
    const saved = JSON.parse(await readFile(file, 'utf8'));
    expect(Object.keys(saved.記憶庫[vaultA]).sort()).toEqual([p('a'), p('b'), p('c')]);
    expect(saved.記憶庫[vaultA][p('a')]).toEqual({ 座標: first.get(p('a')), 放置時間: '2026-11-22T10:00:00.000Z' });
  });

  it('沒有新星系時不改寫檔案;不同記憶庫各自記錄', async () => {
    const file = join(await dir(), 'galaxy-layout.json');
    const store = new GalaxyLayoutStore(file, now);
    await store.positions(vaultA, [p('a')], []);
    const text = await readFile(file, 'utf8');
    await store.positions(vaultA, [p('a')], []);
    expect(await readFile(file, 'utf8')).toBe(text);
    await store.positions(vaultB, [p('d')], []);
    const saved = JSON.parse(await readFile(file, 'utf8'));
    expect(Object.keys(saved.記憶庫).sort()).toEqual([vaultA, vaultB]);
    expect(Object.keys(saved.記憶庫[vaultB])).toEqual([p('d')]);
  });

  it('整理一次覆寫這個記憶庫的座標,其他記憶庫不動', async () => {
    const file = join(await dir(), 'galaxy-layout.json');
    const store = new GalaxyLayoutStore(file, now);
    await store.positions(vaultB, [p('d')], []);
    const before = JSON.parse(await readFile(file, 'utf8')).記憶庫[vaultB];
    const arranged = await store.arrange(vaultA, [p('a'), p('b')], [bridge(p('a'), p('b'), 5)]);
    const saved = JSON.parse(await readFile(file, 'utf8'));
    expect(saved.記憶庫[vaultA][p('a')].座標).toEqual(arranged.get(p('a')));
    expect(saved.記憶庫[vaultB]).toEqual(before);
  });

  it('整理一次會丟掉當下沒有成員的群;它之後回來時被當成新群重新放置(B5 的現行行為)', async () => {
    const file = join(await dir(), 'galaxy-layout.json');
    const store = new GalaxyLayoutStore(file, now);
    const first = await store.positions(vaultA, [p('a'), p('b'), p('c')], [bridge(p('a'), p('b'), 3)]);
    await store.arrange(vaultA, [p('a'), p('b')], [bridge(p('a'), p('b'), 3)]);
    expect(Object.keys(JSON.parse(await readFile(file, 'utf8')).記憶庫[vaultA]).sort()).toEqual([p('a'), p('b')]);
    const back = await store.positions(vaultA, [p('a'), p('b'), p('c')], [bridge(p('a'), p('b'), 3), bridge(p('c'), p('a'), 9)]);
    expect(back.has(p('c'))).toBe(true);
    expect(back.get(p('c'))).not.toEqual(first.get(p('c')));
  });

  it('損毀的檔重建;壞掉的項目略過,好的保留', async () => {
    const file = join(await dir(), 'galaxy-layout.json');
    await writeFile(file, '{ 壞掉');
    expect((await new GalaxyLayoutStore(file, now).positions(vaultA, [p('a')], [])).has(p('a'))).toBe(true);
    expect(JSON.parse(await readFile(file, 'utf8')).版本).toBe(1);
    await writeFile(file, JSON.stringify({ 版本: 1, 記憶庫: {
      [vaultA]: { [p('a')]: { 座標: [300, -100], 放置時間: '2026-11-20T00:00:00.000Z' }, [p('b')]: { 座標: ['x', 1], 放置時間: 'x' },
        'C:/not-a-key': { 座標: [1, 1], 放置時間: '2026-11-20T00:00:00.000Z' } },
      'not-a-vault': {},
    } }));
    const positions = await new GalaxyLayoutStore(file, now).positions(vaultA, [p('a'), p('b')], []);
    expect(positions.get(p('a'))).toEqual([300, -100]);
    const saved = JSON.parse(await readFile(file, 'utf8'));
    expect(Object.keys(saved.記憶庫)).toEqual([vaultA]);
    expect(Object.keys(saved.記憶庫[vaultA]).sort()).toEqual([p('a'), p('b')]);
  });

  it('鎖檔:暫時讀不到會重試;一直讀不到時照算但不覆寫', async () => {
    const file = join(await dir(), 'galaxy-layout.json');
    await writeFile(file, JSON.stringify({ 版本: 1, 記憶庫: { [vaultA]: { [p('a')]: { 座標: [0, 200], 放置時間: '2026-11-20T00:00:00.000Z' } } } }));
    let attempts = 0;
    const flaky = new GalaxyLayoutStore(file, now, { ...noSleep, read: async (path) => {
      if (++attempts < 3) throw Object.assign(new Error('locked'), { code: 'EBUSY' });
      return readFile(path, 'utf8');
    } });
    expect((await flaky.positions(vaultA, [p('a')], [])).get(p('a'))).toEqual([0, 200]);
    expect(attempts).toBe(3);
    const before = await readFile(file, 'utf8');
    const locked = new GalaxyLayoutStore(file, now, { ...noSleep, read: async () => { throw Object.assign(new Error('locked'), { code: 'EPERM' }); } });
    expect((await locked.positions(vaultA, [p('a'), p('b')], [])).size).toBe(2);
    expect(await readFile(file, 'utf8')).toBe(before);
  });

  it('內容沒有路徑:只有 v_/p_ 代號、座標與時間', async () => {
    const file = join(await dir(), 'galaxy-layout.json');
    const store = new GalaxyLayoutStore(file, now);
    await store.positions(vaultA, [p('a'), p('b')], [bridge(p('a'), p('b'), 1)]);
    // Keys that are not opaque project keys are never stored.
    await store.positions(vaultA, ['C:/Users/someone/project'], []);
    const text = await readFile(file, 'utf8');
    expect(text).not.toMatch(/[a-z]:[\\/]|Users|\/home\//i);
  });
});

describe('userData/galaxy-settings.json(資料夾升格)', () => {
  it('升格、取消升格,依記憶庫分開;不合法的代號不收', async () => {
    const file = join(await dir(), 'galaxy-settings.json');
    const store = new GalaxySettingsStore(file);
    expect([...await store.setPromoted(vaultA, p('f'), true) ?? []]).toEqual([p('f')]);
    expect([...await new GalaxySettingsStore(file).promoted(vaultA)]).toEqual([p('f')]);
    expect([...await store.promoted(vaultB)]).toEqual([]);
    expect([...await store.setPromoted(vaultA, p('f'), false) ?? []]).toEqual([]);
    expect(await store.setPromoted(vaultA, 'C:/folder', true)).toBeNull();
    expect(await store.setPromoted('C:/vault', p('f'), true)).toBeNull();
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ 版本: 1, 記憶庫: { [vaultA]: { 升格: [] } } });
  });

  it('損毀時重建;清單裡壞的項目略過', async () => {
    const file = join(await dir(), 'galaxy-settings.json');
    await writeFile(file, JSON.stringify({ 版本: 1, 記憶庫: { [vaultA]: { 升格: [p('f'), 'D:/x', 7] } } }));
    expect([...await new GalaxySettingsStore(file).promoted(vaultA)]).toEqual([p('f')]);
    await writeFile(file, 'nope');
    const store = new GalaxySettingsStore(file);
    expect([...await store.promoted(vaultA)]).toEqual([]);
    await store.setPromoted(vaultA, p('e'), true);
    expect(JSON.parse(await readFile(file, 'utf8')).記憶庫[vaultA].升格).toEqual([p('e')]);
  });
});
