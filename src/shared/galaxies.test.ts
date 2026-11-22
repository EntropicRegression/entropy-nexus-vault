import { describe, expect, it } from 'vitest';
import { assignGalaxies, bridgeWeight, homeProject } from './galaxies';
import type { GalaxyInput, GalaxyNodeInput, GalaxyProject } from './galaxies';

const git = (key: string): GalaxyProject => ({ key, name: key.toUpperCase(), type: 'git' });
const folder = (key: string): GalaxyProject => ({ key, name: key.toUpperCase(), type: '資料夾' });
const projects = new Map([git('pa'), git('pb'), git('pc'), folder('pf')].map((project) => [project.key, project]));
const node = (nodeId: string, list: [string, number | null][], patch: Partial<GalaxyNodeInput> = {}): GalaxyNodeInput =>
  ({ nodeId, chief: false, projects: list.map(([key, recentTasks]) => ({ key, recentTasks })), handledCaseProjects: [], ...patch });
const input = (nodes: GalaxyNodeInput[], patch: Partial<GalaxyInput> = {}): GalaxyInput =>
  ({ projects, promoted: new Set(), nodes, delegations: [], meetings: [], ...patch });

describe('主星系判定(DESIGN.md §6.10)', () => {
  it('(1) 近 90 天任務數最多;平手取清單中較前(較近)的', () => {
    expect(homeProject(node('n', [['pa', 1], ['pb', 5], ['pc', 2]]), projects)).toEqual({ key: 'pb', rule: 'recent-tasks' });
    expect(homeProject(node('n', [['pa', 4], ['pb', 4]]), projects)).toEqual({ key: 'pa', rule: 'recent-tasks' });
    expect(homeProject(node('n', [['pb', 4], ['pa', 4]]), projects)).toEqual({ key: 'pb', rule: 'recent-tasks' });
  });

  it('(2) 近 90 天沒有任務或沒有任務數欄位:取清單中最近的專案', () => {
    expect(homeProject(node('n', [['pc', 0], ['pa', 0]]), projects)).toEqual({ key: 'pc', rule: 'recent-project' });
    expect(homeProject(node('n', [['pb', null], ['pa', null]]), projects)).toEqual({ key: 'pb', rule: 'recent-project' });
  });

  it('(3) 統計沒有專案:取經手判例最多的專案(平手取代號較小)', () => {
    expect(homeProject(node('n', [], { handledCaseProjects: ['pc', 'pb', 'pc'] }), projects)).toEqual({ key: 'pc', rule: 'cases' });
    expect(homeProject(node('n', [], { handledCaseProjects: ['pc', 'pb'] }), projects)).toEqual({ key: 'pb', rule: 'cases' });
  });

  it('(4) 都沒有 → 外環;不在專案表的專案(舊版名稱代號)不算', () => {
    expect(homeProject(node('n', [['legacy-name', 3]], { handledCaseProjects: ['also-unknown'] }), projects))
      .toEqual({ key: null, rule: 'none' });
    expect(homeProject(node('n', [['legacy-name', 9], ['pa', 0]]), projects)).toEqual({ key: 'pa', rule: 'recent-project' });
  });

  it('資料夾是小星雲,使用者升格後算星系;總管在中樞;外環另列', () => {
    const result = assignGalaxies(input([
      node('a', [['pa', 3]]), node('f', [['pf', 2]]), node('boss', [['pa', 9]], { chief: true }), node('lost', []),
    ]));
    expect(result.membership.get('a')).toEqual({ group: 'pa', place: 'galaxy', rule: 'recent-tasks' });
    expect(result.membership.get('f')).toEqual({ group: 'pf', place: 'nebula', rule: 'recent-tasks' });
    expect(result.membership.get('boss')).toEqual({ group: null, place: 'hub', rule: 'chief' });
    expect(result.membership.get('lost')).toEqual({ group: null, place: 'outer', rule: 'none' });
    expect(result.hub).toEqual(['boss']);
    expect(result.outer).toEqual(['lost']);
    expect(result.groups.map(({ key, kind, members }) => [key, kind, members])).toEqual([['pa', 'galaxy', ['a']], ['pf', 'nebula', ['f']]]);
    const promoted = assignGalaxies(input([node('f', [['pf', 2]])], { promoted: new Set(['pf']) }));
    expect(promoted.groups[0]).toMatchObject({ key: 'pf', kind: 'galaxy', promoted: true, projectType: '資料夾' });
    // Promoting a git project changes nothing.
    expect(assignGalaxies(input([node('a', [['pa', 1]])], { promoted: new Set(['pa']) })).groups[0]).toMatchObject({ kind: 'galaxy', promoted: false });
  });
});

describe('星系間連線(近 30 天)', () => {
  const people = [
    node('a1', [['pa', 5]]), node('a2', [['pa', 3]]), node('b1', [['pb', 4]]), node('c1', [['pc', 2]]),
    node('f1', [['pf', 6]]), node('lost', []), node('boss', [['pa', 9]], { chief: true }),
  ];

  it('交辦:兩端主星系不同才算,次數照計;同星系、星雲、外環、總管都不算', () => {
    const { bridges } = assignGalaxies(input(people, { delegations: [
      { from: 'a1', to: 'b1', count: 3 }, { from: 'b1', to: 'a2', count: 1 }, { from: 'a1', to: 'a2', count: 9 },
      { from: 'a1', to: 'f1', count: 9 }, { from: 'lost', to: 'b1', count: 9 }, { from: 'boss', to: 'c1', count: 9 },
    ] }));
    expect(bridges).toEqual([{ a: 'pa', b: 'pb', delegations: 4, meetings: 0, dual: 0, count: 4, weight: 2 }]);
  });

  it('會議:每場對每一對不同星系只算一次,不論各方來幾人', () => {
    const { bridges } = assignGalaxies(input(people, { meetings: [
      { nodeIds: ['a1', 'a2', 'b1'], count: 2 }, { nodeIds: ['a1', 'b1', 'c1', 'f1'], count: 1 }, { nodeIds: ['a1', 'a2'], count: 7 },
    ] }));
    expect(bridges.map(({ a, b, meetings }) => [a, b, meetings])).toEqual([['pa', 'pb', 3], ['pa', 'pc', 1], ['pb', 'pc', 1]]);
  });

  it('會議次數 > 1 且同一星系多人時,每場每對仍只算一次', () => {
    const { bridges } = assignGalaxies(input(people, { meetings: [{ nodeIds: ['a1', 'a2', 'b1', 'boss'], count: 4 }] }));
    expect(bridges).toEqual([{ a: 'pa', b: 'pb', delegations: 0, meetings: 4, dual: 0, count: 4, weight: 2 }]);
  });

  it('雙棲:兩個星系各佔該節點 專案任務數 ≥ 20% 才算,每個節點每對一次', () => {
    const exactly = node('d1', [['pa', 8], ['pb', 2]]);
    const below = node('d2', [['pa', 801], ['pb', 199]]);
    const three = node('d3', [['pa', 1], ['pb', 1], ['pc', 1]]);
    const viaFolder = node('d4', [['pa', 5], ['pf', 5]]);
    const { bridges } = assignGalaxies(input([exactly, below, three, viaFolder]));
    expect(bridges.map(({ a, b, dual }) => [a, b, dual])).toEqual([['pa', 'pb', 2], ['pa', 'pc', 1], ['pb', 'pc', 1]]);
    // A node living in a nebula does not count, even with shares in two galaxies.
    const nebulaHome = node('d5', [['pf', 6], ['pa', 3], ['pb', 3]]);
    expect(assignGalaxies(input([nebulaHome])).bridges).toEqual([]);
  });

  it('合作次數 = 交辦 + 會議 + 雙棲;粗細三階 1–3 / 4–9 / 10+', () => {
    const { bridges } = assignGalaxies(input([...people, node('d1', [['pa', 5], ['pb', 5]])], {
      delegations: [{ from: 'a1', to: 'b1', count: 6 }], meetings: [{ nodeIds: ['a1', 'b1'], count: 3 }],
    }));
    expect(bridges).toEqual([{ a: 'pa', b: 'pb', delegations: 6, meetings: 3, dual: 1, count: 10, weight: 3 }]);
    expect([0, 1, 3, 4, 9, 10, 99].map(bridgeWeight)).toEqual([1, 1, 1, 2, 2, 3, 3]);
  });

  it('升格的資料夾開始參與連線', () => {
    const delegations = [{ from: 'a1', to: 'f1', count: 2 }];
    expect(assignGalaxies(input(people, { delegations })).bridges).toEqual([]);
    expect(assignGalaxies(input(people, { delegations, promoted: new Set(['pf']) })).bridges)
      .toEqual([{ a: 'pa', b: 'pf', delegations: 2, meetings: 0, dual: 0, count: 2, weight: 1 }]);
  });
});
