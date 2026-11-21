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
