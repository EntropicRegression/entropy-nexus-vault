import { describe, expect, it } from 'vitest';
import type { CrystalList, GalaxyMap } from '../../shared/types';
import { alsoInProjects, baseStage, beltPositions, bridgeCurve, closestCenters, diameterOf, interiorData, galaxyExits, outerRingShare, placeOnScreen, quadPoint, viewportScale } from './galaxy-geometry';
import type { PlacedGroup } from './galaxy-geometry';

type EnabledMap = Extract<GalaxyMap, { enabled: true }>;
const group = (key: string, position: [number, number], members: string[], kind: 'galaxy' | 'nebula' = 'galaxy') =>
  ({ key, name: key.toUpperCase(), kind, projectType: kind === 'galaxy' ? 'git' as const : '資料夾' as const, promoted: false, members, position });
const map = (groups: EnabledMap['groups'], patch: Partial<EnabledMap> = {}): EnabledMap =>
  ({ enabled: true, groups, hub: [], outer: [], membership: {}, bridges: [], ...patch });
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe('星系座標 → 畫面(1600×900 基準)', () => {
  it('中樞在舞台中心;相鄰(100 單位)在基準尺寸相距 260px;直徑 150–210px', () => {
    const { groups, unit } = placeOnScreen(map([group('pa', [100, 0], ['n1']), group('pb', [-100, 0], ['n1', 'n2', 'n3'])]), baseStage);
    expect(unit).toBeCloseTo(2.6);
    expect(groups.get('pa')!.center).toEqual({ x: baseStage.width / 2 + 260, y: baseStage.height / 2 });
    expect(distance(groups.get('pa')!.center, groups.get('pb')!.center)).toBeCloseTo(520);
    expect(groups.get('pa')!.size).toBe(150);
    expect(groups.get('pb')!.size).toBe(180);
    expect(diameterOf(20, 1)).toBe(210);
    expect(groups.get('pa')!.ring).toBeCloseTo(150 * outerRingShare);
  });

  it('1280×760 依舞台縮小;放不下時再縮,所有星系都留在舞台內', () => {
    const small = { width: 1224, height: 652 };
    const scale = viewportScale(small);
    expect(scale).toBeCloseTo(Math.min(1224 / baseStage.width, 652 / baseStage.height));
    const far = map([group('pa', [400, 0], ['a']), group('pb', [0, -300], ['b']), group('pc', [-200, 200], ['c'])]);
    const { groups, unit } = placeOnScreen(far, small);
    expect(unit).toBeLessThan(2.6 * scale);
    for (const placed of groups.values()) {
      expect(placed.center.x - placed.size / 2).toBeGreaterThanOrEqual(0);
      expect(placed.center.x + placed.size / 2).toBeLessThanOrEqual(small.width);
      expect(placed.center.y - placed.size / 2).toBeGreaterThanOrEqual(0);
      expect(placed.center.y + placed.size / 2).toBeLessThanOrEqual(small.height);
    }
  });

  it('擁擠時(6 星系 + 1 星雲、抽象座標擠在兩圈內)排開:互不重疊、中心距 ≥ 260px、避開中樞、留在舞台內、結果決定式', () => {
    const members = (n: number) => Array.from({ length: n }, (_, i) => 'm' + i);
    const crowded = map([
      group('p1', [100, 0], members(6)), group('p2', [50, 87], members(5)), group('p3', [-50, 87], members(5)),
      group('p4', [-100, 0], members(4)), group('p5', [-50, -87], members(3)), group('p6', [50, -87], members(3)),
      group('pf', [0, 200], members(2), 'nebula'),
    ], { hub: ['boss'] });
    const { groups } = placeOnScreen(crowded, baseStage);
    expect(closestCenters(groups)).toBeGreaterThanOrEqual(260 - 0.5);
    const list = [...groups.values()];
    for (const [i, a] of list.entries()) {
      expect(Math.hypot(a.center.x - baseStage.width / 2, a.center.y - baseStage.height / 2)).toBeGreaterThan(a.size / 2 + 70);
      expect(a.center.x - a.size / 2).toBeGreaterThanOrEqual(0);
      expect(a.center.x + a.size / 2).toBeLessThanOrEqual(baseStage.width);
      expect(a.center.y - a.size / 2).toBeGreaterThanOrEqual(0);
      for (const b of list.slice(i + 1)) {
        expect(distance(a.center, b.center)).toBeGreaterThan((a.size + b.size) / 2);
        // A group directly above another leaves room for its nameplate (46px) before the lower ring.
        const [upper, lower] = a.center.y < b.center.y ? [a, b] : [b, a];
        if (Math.abs(upper.center.x - lower.center.x) < (upper.size + lower.size) / 2) {
          expect(lower.center.y - lower.size / 2).toBeGreaterThan(upper.center.y + upper.size / 2 + 40);
        }
      }
    }
    expect(placeOnScreen(crowded, baseStage).groups).toEqual(groups);
  });

  it('外環節點平均分布在 88% × 82% 的橢圓上,順序決定式', () => {
    const points = beltPositions(['z', 'a', 'm'], baseStage);
    expect([...points.keys()]).toEqual(['a', 'm', 'z']);
    for (const point of points.values()) {
      const nx = (point.x - baseStage.width / 2) / (baseStage.width * 0.44);
      const ny = (point.y - baseStage.height / 2) / (baseStage.height * 0.41);
      expect(Math.hypot(nx, ny)).toBeCloseTo(1);
    }
    expect(beltPositions(['m', 'z', 'a'], baseStage)).toEqual(points);
  });
});

describe('星橋弧線', () => {
  const a: PlacedGroup = { key: 'a', center: { x: 300, y: 300 }, size: 200, ring: 88 };
  const b: PlacedGroup = { key: 'b', center: { x: 900, y: 300 }, size: 150, ring: 66 };
  const stage = { x: 600, y: 400 };

  it('兩端剛好落在兩個外環上(不留空隙)', () => {
    const curve = bridgeCurve(a, b, 2, stage)!;
    expect(distance(curve.start, a.center)).toBeCloseTo(a.ring, 6);
    expect(distance(curve.end, b.center)).toBeCloseTo(b.ring, 6);
    expect(curve.start).toEqual({ x: 388, y: 300 });
    expect(curve.end).toEqual({ x: 834, y: 300 });
  });

  it('控制點往遠離畫面中心的一側鼓出端點距離的 14%', () => {
    const curve = bridgeCurve(a, b, 1, stage)!;
    // The stage centre is below the line (y 400 > 300), so the arc bows upward.
    expect(curve.control.x).toBeCloseTo((388 + 834) / 2);
    expect(curve.control.y).toBeCloseTo(300 - (834 - 388) * 0.14);
    const flipped = bridgeCurve(a, b, 1, { x: 600, y: 100 })!;
    expect(flipped.control.y).toBeGreaterThan(300);
  });

  it('線寬三階 1.5 / 3 / 5px,中點綴 1–3 顆金珠;重疊的星系不畫', () => {
    expect([1, 2, 3].map((weight) => bridgeCurve(a, b, weight as 1 | 2 | 3, stage)!.width)).toEqual([1.5, 3, 5]);
    expect([1, 2, 3].map((weight) => bridgeCurve(a, b, weight as 1 | 2 | 3, stage)!.beads.length)).toEqual([1, 2, 3]);
    const curve = bridgeCurve(a, b, 1, stage)!;
    expect(curve.beads[0]).toEqual(quadPoint(curve.start, curve.control, curve.end, 0.5));
    expect(curve.path).toMatch(/^M 388 300 Q 611 237\.6 834 300$/);
    expect(bridgeCurve(a, { ...b, center: { x: 400, y: 300 } }, 1, stage)).toBeNull();
  });
});

describe('星系內部的出口', () => {
  const galaxies = map([group('pa', [0, 0], ['a1', 'a2']), group('pb', [100, 0], ['b1']), group('pc', [0, 100], ['c1']), group('pf', [-100, 0], ['f1'], 'nebula')], {
    membership: {
      a1: { group: 'pa', place: 'galaxy', rule: 'recent-tasks' }, a2: { group: 'pa', place: 'galaxy', rule: 'recent-tasks' },
      b1: { group: 'pb', place: 'galaxy', rule: 'recent-tasks' }, c1: { group: 'pc', place: 'galaxy', rule: 'recent-tasks' },
      f1: { group: 'pf', place: 'nebula', rule: 'recent-tasks' }, lost: { group: null, place: 'outer', rule: 'none' },
    },
    bridges: [
      { a: 'pa', b: 'pb', delegations: 2, meetings: 0, dual: 0, count: 2, weight: 1 },
      { a: 'pa', b: 'pc', delegations: 9, meetings: 1, dual: 0, count: 10, weight: 3 },
    ],
  });
  const names = new Map([['a1', '甲'], ['a2', '乙'], ['b1', '丙'], ['c1', '丁'], ['f1', '戊'], ['lost', '己']]);

  it('合作出口依次數排序;傳承出口分「傳承自」「傳承給」;外環不能飛去就不列', () => {
    const exits = galaxyExits(galaxies, 'pa', [
      { kind: 'lineage', from: 'b1', to: 'a1' }, { kind: 'lineage', from: 'a2', to: 'f1' },
      { kind: 'lineage', from: 'lost', to: 'a2' }, { kind: 'lineage', from: 'a1', to: 'a2' },
      { kind: 'delegate', from: 'b1', to: 'a1', count: 3, lastAt: '' },
    ], names);
    expect(exits).toEqual([
      { kind: 'bridge', target: 'pc', count: 10, label: '→ PC(10)' },
      { kind: 'bridge', target: 'pb', count: 2, label: '→ PB(2)' },
      { kind: 'lineage', target: 'pb', nodeId: 'b1', label: '傳承自 → PB 的〈丙〉' },
      { kind: 'lineage', target: 'pf', nodeId: 'f1', label: '傳承給 → PF 的〈戊〉' },
    ]);
    expect(galaxyExits(galaxies, 'pb', [], names)).toEqual([{ kind: 'bridge', target: 'pa', count: 2, label: '→ PA(2)' }]);
  });
});

describe('星橋避開途中的星系', () => {
  it('預設弧線會穿過第三個星系時,改走另一側或加大彎度,直到與它保持距離', () => {
    const a: PlacedGroup = { key: 'a', center: { x: 200, y: 400 }, size: 150, ring: 66 };
    const b: PlacedGroup = { key: 'b', center: { x: 1000, y: 400 }, size: 150, ring: 66 };
    // A third galaxy sits just above the middle: the default bow (away from a centre below) would cut through it.
    const c: PlacedGroup = { key: 'c', center: { x: 600, y: 330 }, size: 150, ring: 66 };
    const plain = bridgeCurve(a, b, 1, { x: 600, y: 700 })!;
    const avoided = bridgeCurve(a, b, 1, { x: 600, y: 700 }, [a, b, c])!;
    const gapOf = (curve: typeof plain) => Math.min(...Array.from({ length: 15 }, (_, i) => {
      const point = quadPoint(curve.start, curve.control, curve.end, (i + 1) / 16);
      return Math.hypot(point.x - c.center.x, point.y - c.center.y) - c.size / 2;
    }));
    expect(gapOf(plain)).toBeLessThan(0);
    expect(gapOf(avoided)).toBeGreaterThanOrEqual(8);
    expect(avoided.start).toEqual(plain.start);
    expect(avoided.end).toEqual(plain.end);
    // Nothing in the way: the default (away from the centre, 14%) is kept.
    expect(bridgeCurve(a, b, 1, { x: 600, y: 700 }, [a, b])).toEqual(plain);
  });
});

describe('星系內部的資料(M5e-b 審查 S1、S4)', () => {
  const data: CrystalList = {
    crystals: [
      { nodeId: 'a1', name: '甲', role: null, status: '線上', canWake: false, projectNames: [], position: [200, 20, 300] },
      { nodeId: 'a2', name: '乙', role: null, status: '線上', canWake: false, projectNames: [], position: [300, -40, 100] },
      { nodeId: 'b1', name: '丙', role: null, status: '線上', canWake: false, projectNames: [], position: [-300, 0, 0] },
    ],
    links: [
      { kind: 'project', nodeIds: ['a1', 'a2'], projectKey: 'p_home', projectName: '星核' },
      { kind: 'project', nodeIds: ['a1', 'a2', 'b1'], projectKey: 'p_other', projectName: '燈塔' },
      { kind: 'project', nodeIds: ['a1', 'a2'], projectKey: 'p_same_name', projectName: '星核' },
      { kind: 'delegate', from: 'a1', to: 'b1', count: 2, lastAt: '' },
      { kind: 'lineage', from: 'a2', to: 'a1' },
    ],
  };

  it('同專案連線:去掉這個星系自己的(依代號),同名但不同代號、其他共同專案的保留;座標以成員中心為原點', () => {
    const inside = interiorData(data, new Set(['a1', 'a2']), 'p_home');
    expect(inside.crystals.map(({ nodeId }) => nodeId)).toEqual(['a1', 'a2']);
    expect(inside.crystals.map(({ position }) => position)).toEqual([[-50, 30, 100], [50, -30, -100]]);
    expect(inside.links).toEqual([data.links[1], data.links[2], data.links[4]]);
  });

  it('同時參與的專案依代號比對:同名不同專案不合併,共用資料夾加註;沒有連線的專案只能用名稱補上', () => {
    const galaxies = map([group('p_home', [0, 0], ['a1']), group('p_other', [100, 0], ['b1'], 'nebula')]);
    expect(alsoInProjects('a1', 'p_home', '星核', ['星核', '燈塔', '獨立專案'], data.links, galaxies))
      .toEqual(['燈塔(共用資料夾)', '星核', '獨立專案']);
    expect(alsoInProjects('b1', 'p_other', '燈塔', ['燈塔'], data.links, galaxies)).toEqual([]);
  });
});
