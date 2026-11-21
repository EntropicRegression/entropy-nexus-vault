import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initialPoint } from '../../shared/crystal-layout';
import { CrystalLayoutStore } from './crystal-layout-store';
import { opaqueKey } from './privacy';

const firstVault = opaqueKey('v', 'C:\\Users\\Synthetic\\First');
const secondVault = opaqueKey('v', 'C:\\Users\\Synthetic\\Second');
const iris = 'fixture-sky-iris', dawn = 'fixture-sky-dawn';

describe('水晶座標持久化', () => {
  let root: string;
  let file: string;
  let time: number;
  const store = () => new CrystalLayoutStore(file, () => time);

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'nexus-crystal-layout-'));
    file = join(root, 'crystal-layout.json');
    time = Date.parse('2026-01-01');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('新增排序更前且碰撞的節點後，舊座標在重開時逐值一致', async () => {
    const original = await store().positions(firstVault, [iris]);
    const added = await store().positions(firstVault, [dawn, iris]);
    expect(added.get(iris)).toEqual(original.get(iris));
    expect(added.get(dawn)).not.toEqual(initialPoint(dawn, 220));
    expect(await store().positions(firstVault, [iris, dawn])).toEqual(added);
    expect(await readdir(root)).toEqual(['crystal-layout.json']);
  });

  it('同時查兩個記憶庫互不擠位，代號和舊節點 ID 不記錄本機路徑', async () => {
    const layout = store();
    const legacy = 'legacy:nodes/Private/Synthetic.md';
    await layout.positions(firstVault, [iris]);
    const [first, second] = await Promise.all([
      layout.positions(firstVault, [dawn, iris, legacy]),
      layout.positions(secondVault, [dawn, iris]),
    ]);
    expect(second.get(dawn)).toEqual(initialPoint(dawn, 220));
    expect(first.get(dawn)).not.toEqual(second.get(dawn));
    const json = await readFile(file, 'utf8');
    expect(json).not.toMatch(/Users|Synthetic|[a-z]:[\\/]|nodes\//i);
    const data = JSON.parse(json);
    expect(Object.keys(data.記憶庫)).toEqual([firstVault, secondVault]);
    expect(data.記憶庫[firstVault][iris].座標).toEqual(first.get(iris));
    expect(Object.keys(data.記憶庫[firstVault]).some((id) => /^n_[a-f0-9]{64}$/.test(id))).toBe(true);
  });

  it.each(['{ malformed', '{"版本":1,"記憶庫":{"not-a-vault":{}}}'])('毀損檔可重建 %s', async (bad) => {
    await writeFile(file, bad);
    const points = await store().positions(firstVault, [iris]);
    expect(points.get(iris)).toEqual(initialPoint(iris, 220));
    expect(JSON.parse(await readFile(file, 'utf8')).版本).toBe(1);
    expect(await store().positions(firstVault, [iris])).toEqual(points);
  });

  it('只移除超過 180 天未出現的節點，近期出現的節點保留座標', async () => {
    await store().positions(firstVault, [dawn, iris]);
    time += 179 * 86_400_000;
    const seen = await store().positions(firstVault, [iris]);
    time += 2 * 86_400_000;
    expect(await store().positions(firstVault, [iris])).toEqual(seen);
    const data = JSON.parse(await readFile(file, 'utf8'));
    expect(Object.keys(data.記憶庫[firstVault])).toEqual([iris]);
  });

  it('過期清理只作用在目前的記憶庫；久未開啟的另一個記憶庫重開後座標不變', async () => {
    const second = await store().positions(secondVault, [dawn, iris]);
    await store().positions(firstVault, [iris]);
    time += 400 * 86_400_000;
    await store().positions(firstVault, [iris]);
    const data = JSON.parse(await readFile(file, 'utf8'));
    expect(Object.keys(data.記憶庫[secondVault]).sort()).toEqual([dawn, iris].sort());
    expect(await store().positions(secondVault, [dawn, iris])).toEqual(second);
  });

  it('單筆壞資料只略過該筆並修正檔案，其餘座標保留；上限依最大半徑推得', async () => {
    const kept = await store().positions(firstVault, [iris]);
    const data = JSON.parse(await readFile(file, 'utf8'));
    data.記憶庫[firstVault][dawn] = { 座標: [0, 0, 'x'], 最後出現: '2026-01-01T00:00:00.000Z' };
    data.記憶庫[firstVault]['fixture-sky-far'] = { 座標: [400, 0, 0], 最後出現: '2026-01-01T00:00:00.000Z' };
    data.記憶庫[firstVault]['fixture-sky-time'] = { 座標: [1, 2, 3], 最後出現: 'not a date' };
    data.記憶庫['not-a-vault'] = { [iris]: { 座標: [1, 1, 1], 最後出現: '2026-01-01T00:00:00.000Z' } };
    await writeFile(file, JSON.stringify(data));
    expect((await store().positions(firstVault, [iris])).get(iris)).toEqual(kept.get(iris));
    const repaired = JSON.parse(await readFile(file, 'utf8'));
    expect(Object.keys(repaired.記憶庫)).toEqual([firstVault]);
    expect(Object.keys(repaired.記憶庫[firstVault])).toEqual([iris]);

    // A larger outer shell accepts the same far coordinate that the default limit (340) rejects.
    data.記憶庫 = { [firstVault]: { 'fixture-sky-far': { 座標: [400, 0, 0], 最後出現: '2026-01-01T00:00:00.000Z' } } };
    await writeFile(file, JSON.stringify(data));
    const wide = new CrystalLayoutStore(file, () => time, { params: { radii: [220, 320, 420], minGap: [90, 70, 55], minScreenGap: [0, 0, 0], candidates: 64 } });
    expect((await wide.positions(firstVault, ['fixture-sky-far'])).get('fixture-sky-far')).toEqual([400, 0, 0]);
  });

  it('暫時鎖檔會遞增間隔重試，成功後沿用既有座標', async () => {
    const saved = await store().positions(firstVault, [iris]);
    const waits: number[] = [];
    let attempts = 0;
    const read = async (path: string) => {
      if (++attempts < 3) throw Object.assign(new Error('locked'), { code: 'EBUSY' });
      return readFile(path, 'utf8');
    };
    const retrying = new CrystalLayoutStore(file, () => time, { read, sleep: async (ms) => { waits.push(ms); } });
    expect(await retrying.positions(firstVault, [iris])).toEqual(saved);
    expect(waits).toEqual([50, 100]);
  });

  it('重試後仍鎖住：本次照算但不覆寫檔案，也不把暫算結果記成正式座標', async () => {
    await store().positions(firstVault, [iris]);
    const before = await readFile(file, 'utf8');
    let locked = true;
    const read = async (path: string) => {
      if (locked) throw Object.assign(new Error('locked'), { code: 'EPERM' });
      return readFile(path, 'utf8');
    };
    const waits: number[] = [];
    const layout = new CrystalLayoutStore(file, () => time, { read, sleep: async (ms) => { waits.push(ms); } });
    const temporary = await layout.positions(firstVault, [dawn, iris]);
    expect(temporary.size).toBe(2);
    expect(waits).toEqual([50, 100, 200]);
    expect(await readFile(file, 'utf8')).toBe(before);

    locked = false;
    const recovered = await layout.positions(firstVault, [dawn, iris]);
    expect(recovered.get(iris)).toEqual((await store().positions(firstVault, [iris])).get(iris));
    expect(JSON.parse(await readFile(file, 'utf8')).記憶庫[firstVault][dawn].座標).toEqual(recovered.get(dawn));
  });

  it('同一天內重讀不重寫檔案', async () => {
    await store().positions(firstVault, [iris]);
    const first = await readFile(file, 'utf8');
    time += 60_000;
    await store().positions(firstVault, [iris]);
    expect(await readFile(file, 'utf8')).toBe(first);
  });

  it('寫檔暫時失敗時先提供記憶體座標，下一次可補寫', async () => {
    const dir = join(root, 'not-yet-created');
    file = join(dir, 'crystal-layout.json');
    const layout = store();
    const before = await layout.positions(firstVault, [iris]);
    await mkdir(dir);
    expect((await layout.positions(firstVault, [iris, dawn])).get(iris)).toEqual(before.get(iris));
    expect((await store().positions(firstVault, [iris])).get(iris)).toEqual(before.get(iris));
  });
});
