import { describe, expect, it } from 'vitest';
import type { GalaxyBridge } from './galaxies';
import { arrangeGalaxies, galaxyLayout, placeGalaxies } from './galaxy-layout';
import type { Point2 } from './galaxy-layout';

const bridge = (a: string, b: string, count: number): GalaxyBridge =>
  ({ a: a < b ? a : b, b: a < b ? b : a, delegations: count, meetings: 0, dual: 0, count, weight: 1 });
const distance = (p: Point2, q: Point2) => Math.hypot(p[0] - q[0], p[1] - q[1]);
const { spacing, minGap } = galaxyLayout;

function noOverlap(points: Iterable<Point2>) {
  const list = [...points];
  for (const [index, point] of list.entries()) {
    expect(Math.hypot(point[0], point[1])).toBeGreaterThanOrEqual(spacing * minGap - 0.01);
    for (const other of list.slice(index + 1)) expect(distance(point, other)).toBeGreaterThanOrEqual(spacing * minGap - 0.01);
  }
}

describe('星系座標(DESIGN.md §6.10)', () => {
  it('決定式:同樣的輸入得到同樣的位置', () => {
    const keys = ['p_a', 'p_b', 'p_c', 'p_d'];
    const bridges = [bridge('p_a', 'p_b', 5), bridge('p_c', 'p_d', 1)];
    expect(placeGalaxies(new Map(), keys, bridges)).toEqual(placeGalaxies(new Map(), [...keys].reverse(), bridges));
  });

  it('新星系放在合作最多的已存在星系旁邊;沒有合作就放在中樞周圍;都不重疊', () => {
    const first = placeGalaxies(new Map(), ['p_a', 'p_x'], []);
    noOverlap(first.values());
    const next = placeGalaxies(first, ['p_a', 'p_x', 'p_b'], [bridge('p_a', 'p_b', 1), bridge('p_x', 'p_b', 7)]);
    expect(distance(next.get('p_b')!, next.get('p_x')!)).toBeCloseTo(spacing, 0);
    noOverlap(next.values());
  });

  it('已放好的星系永不移動:之後加入多少星系、合作怎麼變,舊座標都不變', () => {
    let positions = placeGalaxies(new Map(), ['p_a', 'p_b'], [bridge('p_a', 'p_b', 1)]);
    const original = new Map(positions);
    for (let round = 0; round < 12; round++) {
      const key = 'p_n' + round;
      positions = placeGalaxies(positions, [...positions.keys(), key], [bridge('p_a', key, round + 1), bridge('p_a', 'p_b', 100)]);
      for (const [group, point] of original) expect(positions.get(group)).toEqual(point);
    }
    noOverlap(positions.values());
  });

  it('整理一次:從零重排,合作最多的彼此相鄰,結果決定式', () => {
    const keys = ['p_a', 'p_b', 'p_c', 'p_d', 'p_e'];
    const bridges = [bridge('p_a', 'p_b', 9), bridge('p_b', 'p_c', 4), bridge('p_d', 'p_e', 2)];
    const arranged = arrangeGalaxies(keys, bridges);
    expect(arranged).toEqual(arrangeGalaxies(keys, bridges));
    expect(distance(arranged.get('p_a')!, arranged.get('p_b')!)).toBeCloseTo(spacing, 0);
    expect(distance(arranged.get('p_d')!, arranged.get('p_e')!)).toBeCloseTo(spacing, 0);
    noOverlap(arranged.values());
  });
});
