import { describe, expect, it } from 'vitest';
import type { GalaxyMap } from '../../shared/types';
import { assignGalaxies } from '../../shared/galaxies';
import { retiredScale, worldLayout } from './galaxy-world';

type EnabledMap = Extract<GalaxyMap, { enabled: true }>;
const key = (index: number) => 'p_' + String(index).padStart(24, '0');

function map(retired: number[]): EnabledMap {
  const groups = Array.from({ length: 5 }, (_, index) => ({
    key: key(index), name: '專案' + index, kind: 'galaxy' as const, projectType: 'git' as const, promoted: false,
    members: ['n' + index + 'a', 'n' + index + 'b'], position: [(index - 2) * 100, 0] as [number, number], retired: retired.includes(index),
  }));
  return { enabled: true, groups, hub: [], outer: ['o1'], membership: {}, bridges: [] };
}

describe('退役專案(DESIGN.md §6.10.3,使用者 2026-11-27)', () => {
  it('退役的群移到外環之外、縮小,不影響其他群的位置與外環大小', () => {
    const plain = worldLayout(map([]));
    const layout = worldLayout(map([1, 3]));
    for (const index of [1, 3]) {
      const group = layout.groups.get(key(index))!;
      expect((group.center.x / layout.beltRadius.x) ** 2 + (group.center.y / layout.beltRadius.y) ** 2).toBeGreaterThan(1);
      expect(group.size).toBeCloseTo(plain.groups.get(key(index))!.size * retiredScale);
    }
    // The belt only wraps the active groups, so it shrinks when outer groups retire and never grows because of them.
    expect(layout.beltRadius.x).toBeLessThanOrEqual(plain.beltRadius.x);
    expect(layout.groups.size).toBe(5);
    expect(worldLayout(map([1, 3]))).toEqual(layout);
  });

  it('分群時帶上退役旗標;成員與所屬群不變', () => {
    const projects = new Map([[key(0), { key: key(0), type: 'git' as const, name: 'A' }], [key(1), { key: key(1), type: '資料夾' as const, name: 'B' }]]);
    const nodes = [
      { nodeId: 'a', chief: false, projects: [{ key: key(0), recentTasks: 3 }], handledCaseProjects: [] },
      { nodeId: 'b', chief: false, projects: [{ key: key(1), recentTasks: 2 }], handledCaseProjects: [] },
    ];
    const result = assignGalaxies({ projects, promoted: new Set(), retired: new Set([key(1)]), nodes, delegations: [], meetings: [] });
    expect(result.groups.map(({ key: k, retired, members }) => [k, retired, members])).toEqual([[key(0), false, ['a']], [key(1), true, ['b']]]);
    expect(assignGalaxies({ projects, promoted: new Set(), nodes, delegations: [], meetings: [] }).groups.every((g) => g.retired === false)).toBe(true);
  });
});
