/**
 * Project galaxies, data and logic layer (DESIGN.md §6.10, docs/架構.md §9.4). Pure functions: no file access.
 * All project identifiers here are opaque p_ keys; raw 專案ID values never reach this module.
 */

export type ProjectType = 'git' | '資料夾';
export type GroupKind = 'galaxy' | 'nebula';
/** How a node's place was decided, in the order the rules are tried. */
export type PlacementRule = 'chief' | 'recent-tasks' | 'recent-project' | 'cases' | 'none';

export interface GalaxyProject { key: string; name: string; type: ProjectType }

export interface GalaxyNodeInput {
  nodeId: string;
  /** Current chief (統計檔 總管: true): sits in the hub, belongs to no group. */
  chief: boolean;
  /** Projects from the stats in their order (most recent first), with 專案任務數 (last 90 days) when present. */
  projects: { key: string; recentTasks: number | null }[];
  /** Project keys of the cases this node handled (節點ID), one entry per case; rejected cases are left out. */
  handledCaseProjects: string[];
}

export interface GalaxyInput {
  /** 專案表 by opaque key. */
  projects: ReadonlyMap<string, GalaxyProject>;
  /** Folder projects the user promoted to galaxies. */
  promoted: ReadonlySet<string>;
  nodes: GalaxyNodeInput[];
  /** 協作不含總管 (last 30 days). */
  delegations: { from: string; to: string; count: number }[];
  /** 同席不含總管 (last 30 days); one entry per participant set, count = number of meetings. */
  meetings: { nodeIds: string[]; count: number }[];
}

export interface GalaxyMembership { group: string | null; place: 'galaxy' | 'nebula' | 'outer' | 'hub'; rule: PlacementRule }

export interface GalaxyGroup { key: string; name: string; kind: GroupKind; projectType: ProjectType; promoted: boolean; members: string[] }

export interface GalaxyBridge {
  /** Group keys, a < b. */
  a: string;
  b: string;
  delegations: number;
  meetings: number;
  dual: number;
  count: number;
  /** Line weight step: 1 → 1.5px, 2 → 3px, 3 → 5px (DESIGN.md §6.10). */
  weight: 1 | 2 | 3;
}

export interface GalaxyAssignment {
  groups: GalaxyGroup[];
  hub: string[];
  outer: string[];
  membership: Map<string, GalaxyMembership>;
  bridges: GalaxyBridge[];
}

/** A node in both projects with at least this share of its 專案任務數 in each counts as a dual-resident link. */
export const dualShare = 0.2;
/** Collaboration counts at which a bridge becomes 3px and 5px (1–3 → 1.5px, 4–9 → 3px, 10+ → 5px). */
export const bridgeWeightSteps = { medium: 4, heavy: 10 } as const;

export function bridgeWeight(count: number): 1 | 2 | 3 {
  return count >= bridgeWeightSteps.heavy ? 3 : count >= bridgeWeightSteps.medium ? 2 : 1;
}

function kindOf(project: GalaxyProject, promoted: ReadonlySet<string>): GroupKind {
  return project.type === 'git' || promoted.has(project.key) ? 'galaxy' : 'nebula';
}

/**
 * The node's home group:
 * (1) the project with the most tasks in the last 90 days (ties: the more recent one, i.e. earlier in the list);
 * (2) the most recent project in the stats list; (3) the project of most handled cases (ties: smaller key);
 * (4) none → outer belt. Only projects in 專案表 qualify.
 */
export function homeProject(node: GalaxyNodeInput, projects: ReadonlyMap<string, GalaxyProject>): { key: string | null; rule: PlacementRule } {
  const known = node.projects.filter(({ key }) => projects.has(key));
  let best: { key: string; tasks: number } | null = null;
  for (const { key, recentTasks } of known) {
    if (recentTasks !== null && recentTasks > 0 && (!best || recentTasks > best.tasks)) best = { key, tasks: recentTasks };
  }
  if (best) return { key: best.key, rule: 'recent-tasks' };
  if (known.length) return { key: known[0].key, rule: 'recent-project' };
  const cases = new Map<string, number>();
  for (const key of node.handledCaseProjects) if (projects.has(key)) cases.set(key, (cases.get(key) ?? 0) + 1);
  const top = [...cases].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))[0];
  return top ? { key: top[0], rule: 'cases' } : { key: null, rule: 'none' };
}

const pairKey = (x: string, y: string) => (x < y ? x + '\n' + y : y + '\n' + x);

export function assignGalaxies(input: GalaxyInput): GalaxyAssignment {
  const membership = new Map<string, GalaxyMembership>();
  const members = new Map<string, string[]>();
  const hub: string[] = [];
  const outer: string[] = [];
  for (const node of input.nodes) {
    if (node.chief) {
      membership.set(node.nodeId, { group: null, place: 'hub', rule: 'chief' });
      hub.push(node.nodeId);
      continue;
    }
    const { key, rule } = homeProject(node, input.projects);
    if (!key) {
      membership.set(node.nodeId, { group: null, place: 'outer', rule });
      outer.push(node.nodeId);
      continue;
    }
    const kind = kindOf(input.projects.get(key)!, input.promoted);
    membership.set(node.nodeId, { group: key, place: kind, rule });
    members.set(key, [...(members.get(key) ?? []), node.nodeId]);
  }

  // Only groups with members are drawn; the order is stable (by key).
  const groups: GalaxyGroup[] = [...members].sort(([x], [y]) => (x < y ? -1 : 1)).map(([key, ids]) => {
    const project = input.projects.get(key)!;
    return { key, name: project.name, kind: kindOf(project, input.promoted), projectType: project.type,
      promoted: project.type !== 'git' && input.promoted.has(key), members: ids };
  });

  // Bridges join galaxies only; nebulae, the outer belt and the hub never count.
  const galaxyOf = (nodeId: string) => {
    const place = membership.get(nodeId);
    return place?.place === 'galaxy' ? place.group : null;
  };
  const tally = new Map<string, { delegations: number; meetings: number; dual: number }>();
  const add = (x: string, y: string, field: 'delegations' | 'meetings' | 'dual', amount: number) => {
    if (x === y || amount <= 0) return;
    const key = pairKey(x, y);
    const entry = tally.get(key) ?? { delegations: 0, meetings: 0, dual: 0 };
    entry[field] += amount;
    tally.set(key, entry);
  };
  for (const { from, to, count } of input.delegations) {
    const a = galaxyOf(from), b = galaxyOf(to);
    if (a && b) add(a, b, 'delegations', count);
  }
  for (const { nodeIds, count } of input.meetings) {
    // Each meeting counts once per pair of different galaxies, however many members each side brought.
    const sides = [...new Set(nodeIds.map(galaxyOf).filter((group): group is string => Boolean(group)))].sort();
    for (let i = 0; i < sides.length; i++) for (let j = i + 1; j < sides.length; j++) add(sides[i], sides[j], 'meetings', count);
  }
  const isGalaxy = (key: string) => {
    const project = input.projects.get(key);
    return Boolean(project && kindOf(project, input.promoted) === 'galaxy');
  };
  for (const node of input.nodes) {
    // Only nodes that live in a galaxy count; nebula and outer-belt nodes do not (DESIGN.md §6.10).
    if (membership.get(node.nodeId)?.place !== 'galaxy') continue;
    const total = node.projects.reduce((sum, { recentTasks }) => sum + (recentTasks ?? 0), 0);
    if (!total) continue;
    const resident = [...new Set(node.projects.filter(({ key, recentTasks }) => isGalaxy(key) && (recentTasks ?? 0) / total >= dualShare)
      .map(({ key }) => key))].sort();
    for (let i = 0; i < resident.length; i++) for (let j = i + 1; j < resident.length; j++) add(resident[i], resident[j], 'dual', 1);
  }
  const bridges: GalaxyBridge[] = [...tally].map(([key, parts]) => {
    const [a, b] = key.split('\n');
    const count = parts.delegations + parts.meetings + parts.dual;
    return { a, b, ...parts, count, weight: bridgeWeight(count) };
  }).sort((x, y) => (x.a + x.b < y.a + y.b ? -1 : 1));
  return { groups, hub, outer, membership, bridges };
}
