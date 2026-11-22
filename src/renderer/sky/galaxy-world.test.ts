import { describe, expect, it } from 'vitest';
import type { GalaxyMap } from '../../shared/types';
import { beltLabels, bridgeStyle, clampCamera, contains, detailLevel, fitBoxes, fitCamera, fitZoom, groupBox, lerpCamera, minimapTransform,
  panBy, revealBox, toScreen, toWorld, viewBox, worldLayout, zoomAt, zoomRange } from './galaxy-world';

type EnabledMap = Extract<GalaxyMap, { enabled: true }>;

function grid(count: number, nebulae = 0, outer = 0): EnabledMap {
  const groups = Array.from({ length: count }, (_, index) => ({
    key: 'p_' + String(index).padStart(24, '0'), name: '專案' + index, kind: (index < nebulae ? 'nebula' : 'galaxy') as 'nebula' | 'galaxy',
    projectType: 'git' as const, promoted: false, members: ['n' + index + 'a', 'n' + index + 'b', 'n' + index + 'c'],
    position: [((index % 8) - 3.5) * 100, (Math.floor(index / 8) - 2) * 100] as [number, number],
  }));
  return {
    enabled: true, groups, hub: ['boss'], outer: Array.from({ length: outer }, (_, index) => 'o' + String(index).padStart(2, '0')),
    membership: {}, bridges: [],
  };
}
const stage = { width: 1544, height: 792 };

describe('星圖總覽地圖化:世界座標(DESIGN.md §6.10.2)', () => {
  it('位置 = 存檔座標 × 2.6,不為塞進視窗而壓縮;縮放 1.0 時星系與銘牌互不重疊', () => {
    const layout = worldLayout(grid(40, 8, 60));
    expect(layout.groups.size).toBe(40);
    const list = [...layout.groups.values()];
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = groupBox(list[i]), b = groupBox(list[j]);
      const overlap = a.minX < b.maxX - 0.5 && a.maxX > b.minX + 0.5 && a.minY < b.maxY - 0.5 && a.maxY > b.minY + 0.5;
      expect(overlap, list[i].key + ' / ' + list[j].key).toBe(false);
    }
    // 40 projects spread far wider than one window: the world is larger than the stage at zoom 1.
    expect(layout.bounds.maxX - layout.bounds.minX).toBeGreaterThan(stage.width);
    expect(worldLayout(grid(40, 8, 60))).toEqual(layout);
  });

  it('外環是一圈橢圓:依 ID 排序、等角度,在所有星系外緣之外', () => {
    const layout = worldLayout(grid(6, 0, 4));
    expect([...layout.belt.keys()]).toEqual(['o00', 'o01', 'o02', 'o03']);
    for (const point of layout.belt.values()) {
      expect((point.x / layout.beltRadius.x) ** 2 + (point.y / layout.beltRadius.y) ** 2).toBeCloseTo(1, 2);
    }
    for (const group of layout.groups.values()) {
      expect(Math.abs(group.center.x) + group.size / 2).toBeLessThan(layout.beltRadius.x);
    }
  });

  it('星系少時開場全覽仍是完整細節(≥ 0.8),多時全覽倍率低於下限也能看完', () => {
    const small = grid(3, 1, 1);
    small.groups = small.groups.map((group, index) => ({ ...group, position: ([[-100, 0], [100, 0], [0, 100]] as [number, number][])[index] }));
    const few = worldLayout(small);
    expect(fitZoom(few.bounds, stage)).toBeGreaterThanOrEqual(0.8);
    const many = worldLayout(grid(40, 8, 60));
    expect(zoomRange(many.bounds, stage)).toEqual({ min: Math.min(0.45, fitZoom(many.bounds, stage)), max: 1.6 });
    const wide = grid(40, 8, 60);
    wide.groups = wide.groups.map((group) => ({ ...group, position: [group.position[0] * 3, group.position[1] * 3] as [number, number] }));
    const huge = worldLayout(wide);
    const fit = fitZoom(huge.bounds, stage);
    expect(fit).toBeLessThan(0.45);
    expect(zoomRange(huge.bounds, stage)).toEqual({ min: fit, max: 1.6 });
    expect(contains(viewBox(fitCamera(many.bounds, stage), stage), many.bounds, 1)).toBe(true);
  });
});

describe('鏡頭', () => {
  const layout = worldLayout(grid(40, 8, 60));
  const world = layout.bounds;

  it('倍率上下限與中心限制在世界外框內', () => {
    expect(clampCamera({ x: 0, y: 0, zoom: 9 }, world, stage).zoom).toBe(1.6);
    expect(clampCamera({ x: 0, y: 0, zoom: 0.01 }, world, stage).zoom).toBe(zoomRange(world, stage).min);
    const far = clampCamera({ x: 1e6, y: -1e6, zoom: 1 }, world, stage);
    expect(far).toEqual({ x: world.maxX, y: world.minY, zoom: 1 });
  });

  it('以游標為中心縮放:游標下的世界點不動', () => {
    const camera = { x: 100, y: 50, zoom: 1 };
    const cursor = { x: 300, y: 200 };
    const before = toWorld(cursor, camera, stage);
    const next = zoomAt(camera, 1.3, cursor, world, stage);
    expect(next.zoom).toBeCloseTo(1.3);
    const after = toWorld(cursor, next, stage);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    expect(toScreen(toWorld(cursor, next, stage), next, stage).x).toBeCloseTo(cursor.x, 6);
  });

  it('拖曳平移跟著指標移動(螢幕像素 ÷ 倍率)', () => {
    expect(panBy({ x: 0, y: 0, zoom: 0.5 }, 80, -40, world, stage)).toEqual({ x: -160, y: 80, zoom: 0.5 });
  });

  it('把畫面外的星系帶進視野,移動最少;已在視野內就不動', () => {
    const camera = { x: 0, y: 0, zoom: 1 };
    const target = [...layout.groups.values()].reduce((a, b) => (b.center.x > a.center.x ? b : a));
    const box = groupBox(target);
    expect(contains(viewBox(camera, stage), box)).toBe(false);
    const moved = revealBox(camera, box, world, stage);
    expect(contains(viewBox(moved, stage), box)).toBe(true);
    expect(moved.y).toBe(0);
    expect(revealBox(moved, box, world, stage)).toEqual(moved);
  });

  it('看亮著的星系:縮放到剛好包住;沒有就回到全覽', () => {
    const boxes = [...layout.groups.values()].slice(0, 2).map(groupBox);
    const camera = fitBoxes(boxes, world, stage);
    for (const box of boxes) expect(contains(viewBox(camera, stage), box, 1)).toBe(true);
    expect(fitBoxes([], world, stage)).toEqual(fitCamera(world, stage));
  });

  it('程式移動用 ease-out,t=1 到位', () => {
    const from = { x: 0, y: 0, zoom: 1 }, to = { x: 100, y: -50, zoom: 0.5 };
    expect(lerpCamera(from, to, 1)).toEqual(to);
    expect(lerpCamera(from, to, 0.5).x).toBeGreaterThan(50);
  });
});

describe('減量呈現與小地圖', () => {
  it('門檻 0.8 / 0.55;星橋依層級減量', () => {
    expect([1, 0.8, 0.79, 0.55, 0.54].map(detailLevel)).toEqual(['full', 'full', 'mid', 'mid', 'far']);
    expect(bridgeStyle('full', 2)).toEqual({ show: true, width: 3, beads: true });
    expect(bridgeStyle('mid', 2)).toEqual({ show: true, width: 1.5, beads: false });
    expect(bridgeStyle('mid', 1)).toEqual({ show: true, width: 1, beads: false });
    expect(bridgeStyle('far', 2).show).toBe(false);
    expect(bridgeStyle('far', 3)).toEqual({ show: true, width: 5, beads: false });
  });

  it('外環名字重疊時隱藏較晚排到的;倍率越大留下越多', () => {
    const layout = worldLayout(grid(40, 8, 60));
    const names = new Map([...layout.belt.keys()].map((id) => [id, '節點' + id]));
    const far = beltLabels(layout.belt, names, 0.3);
    const near = beltLabels(layout.belt, names, 1.6);
    expect(far.has('o00')).toBe(true);
    expect(far.size).toBeLessThan(60);
    expect(near.size).toBeGreaterThan(far.size);
  });

  it('小地圖把整個世界放進 180 × 110', () => {
    const layout = worldLayout(grid(40, 8, 60));
    const t = minimapTransform(layout.bounds);
    const corner = (x: number, y: number) => ({ x: x * t.scale + t.x, y: y * t.scale + t.y });
    const low = corner(layout.bounds.minX, layout.bounds.minY), high = corner(layout.bounds.maxX, layout.bounds.maxY);
    expect(low.x).toBeGreaterThanOrEqual(5.9);
    expect(low.y).toBeGreaterThanOrEqual(5.9);
    expect(high.x).toBeLessThanOrEqual(174.1);
    expect(high.y).toBeLessThanOrEqual(104.1);
  });
});
