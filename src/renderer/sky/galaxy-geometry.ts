/**
 * Screen geometry of the galaxy overview (DESIGN.md §6.10, visual base docs/設計稿/premium/galaxy.html).
 * Pure functions: positions come from listGalaxies() in abstract units (spacing 100 between neighbours).
 */
import type { GalaxyBridge } from '../../shared/galaxies';
import type { CrystalLink, CrystalList, GalaxyMap } from '../../shared/types';

export interface ScreenPoint { x: number; y: number }
export interface Viewport { width: number; height: number }
type EnabledMap = Extract<GalaxyMap, { enabled: true }>;

/** Map stage size at the 1600×900 reference window with the detail panel closed. */
export const baseStage: Viewport = { width: 1544, height: 792 };
/** At the reference size, neighbours (100 units apart) sit 260px apart. */
export const pixelsPerUnit = 2.6;
/** Galaxy diameter at the reference size: 150px for one member, +15px each, at most 210px. */
export const galaxyDiameter = { min: 150, perMember: 15, max: 210 } as const;
/** Nebula box at the reference size. */
export const nebulaSize = { width: 132, height: 84 } as const;
/** Outer ring radius as a share of the galaxy diameter (the armillary SVG draws R = 0.44 × size). */
export const outerRingShare = 0.44;
/** Space kept for a nameplate under each group, at the reference size. */
const plateSpace = 46;
/** The control point bows out by this share of the distance between the two ring edges. */
export const bridgeBow = 0.14;
export const bridgeWidths: Record<1 | 2 | 3, number> = { 1: 1.5, 2: 3, 3: 5 };
const beadSpots: Record<1 | 2 | 3, number[]> = { 1: [0.5], 2: [0.47, 0.53], 3: [0.44, 0.5, 0.56] };

export function viewportScale(viewport: Viewport): number {
  return Math.min(viewport.width / baseStage.width, viewport.height / baseStage.height);
}

export function diameterOf(members: number, scale: number): number {
  const base = Math.min(galaxyDiameter.max, galaxyDiameter.min + galaxyDiameter.perMember * Math.max(0, members - 1));
  return base * scale;
}

export interface PlacedGroup {
  key: string;
  center: ScreenPoint;
  /** Galaxy diameter, or the nebula box width. */
  size: number;
  /** Outer ring radius (galaxies); half the box width for nebulae. */
  ring: number;
}

/** Clear space between two groups' outlines, and around the hub, at the reference size. */
const groupGap = 24;
const hubRadius = 70;
/** Separation passes; deterministic, so the same input always gives the same screen. */
const relaxPasses = 120;

/**
 * Abstract positions → stage pixels. The hub (origin) stays at the stage centre. x and y are scaled separately (the
 * stage is wide), each at most 260px per 100 units at the reference size. Groups that would still overlap, or sit
 * closer than 260px × scale, are then pushed apart in a fixed number of deterministic passes and kept inside the
 * stage (best effort when the stage is too small for that). The abstract positions never change; only this mapping
 * depends on the stage size and on which groups exist.
 */
export function placeOnScreen(map: EnabledMap, viewport: Viewport): { groups: Map<string, PlacedGroup>; unit: number } {
  const scale = viewportScale(viewport);
  const center = { x: viewport.width / 2, y: viewport.height / 2 };
  const sizes = new Map(map.groups.map((group) => [group.key,
    group.kind === 'galaxy' ? diameterOf(group.members.length, scale) : nebulaSize.width * scale]));
  const largest = Math.max(0, ...sizes.values());
  const room = { x: viewport.width / 2 - largest / 2 - 12 * scale, y: viewport.height / 2 - largest / 2 - plateSpace * scale };
  const extent = { x: 0, y: 0 };
  for (const group of map.groups) {
    extent.x = Math.max(extent.x, Math.abs(group.position[0]));
    extent.y = Math.max(extent.y, Math.abs(group.position[1]));
  }
  const limit = pixelsPerUnit * scale;
  const unitX = extent.x ? Math.min(limit, Math.max(0, room.x) / extent.x) : limit;
  const unitY = extent.y ? Math.min(limit, Math.max(0, room.y) / extent.y) : limit;
  const keys = map.groups.map((group) => group.key);
  const points = new Map(map.groups.map((group) => [group.key,
    { x: center.x + group.position[0] * unitX, y: center.y + group.position[1] * unitY }]));
  const minCenter = pixelsPerUnit * 100 * scale;
  const clamp = (key: string) => {
    const point = points.get(key)!;
    const half = sizes.get(key)! / 2;
    point.x = Math.min(viewport.width - half - 12 * scale, Math.max(half + 12 * scale, point.x));
    point.y = Math.min(viewport.height - half - plateSpace * scale, Math.max(half + 12 * scale, point.y));
  };
  for (let pass = 0; pass < relaxPasses; pass++) {
    let moved = false;
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const a = points.get(keys[i])!, b = points.get(keys[j])!;
        let dx = b.x - a.x, dy = b.y - a.y;
        let distance = Math.hypot(dx, dy);
        // Nameplates hang below each graphic, so vertically stacked groups need that much more room.
        const vertical = distance > 0.01 ? Math.abs(dy) / distance : 0;
        const need = Math.max(minCenter, (sizes.get(keys[i])! + sizes.get(keys[j])!) / 2 + (groupGap + plateSpace * vertical) * scale);
        if (distance >= need - 0.01) continue;
        if (distance < 0.01) { dx = Math.cos(i + j); dy = Math.sin(i + j); distance = 1; }
        const push = (need - distance) / 2;
        a.x -= dx / distance * push; a.y -= dy / distance * push;
        b.x += dx / distance * push; b.y += dy / distance * push;
        moved = true;
      }
    }
    for (const key of keys) {
      const point = points.get(key)!;
      let dx = point.x - center.x, dy = point.y - center.y;
      let distance = Math.hypot(dx, dy);
      // A group above the hub hangs its nameplate toward it; keep that clear too.
      const above = distance > 0.01 && dy < 0 ? -dy / distance : 0;
      const keep = sizes.get(key)! / 2 + (hubRadius + groupGap + plateSpace * above) * scale;
      if (map.hub.length && distance < keep) {
        if (distance < 0.01) { dx = 1; dy = 0; distance = 1; }
        point.x = center.x + dx / distance * keep;
        point.y = center.y + dy / distance * keep;
        moved = true;
      }
      clamp(key);
    }
    if (!moved) break;
  }
  const groups = new Map<string, PlacedGroup>();
  for (const group of map.groups) {
    const size = sizes.get(group.key)!;
    const point = points.get(group.key)!;
    groups.set(group.key, {
      key: group.key,
      center: { x: Math.round(point.x * 10) / 10, y: Math.round(point.y * 10) / 10 },
      size,
      ring: group.kind === 'galaxy' ? size * outerRingShare : size / 2,
    });
  }
  return { groups, unit: Math.min(unitX, unitY) };
}

/** Distance between the two closest group centres (0 with fewer than two groups). */
export function closestCenters(groups: ReadonlyMap<string, PlacedGroup>): number {
  const list = [...groups.values()];
  let closest = Infinity;
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    closest = Math.min(closest, Math.hypot(list[i].center.x - list[j].center.x, list[i].center.y - list[j].center.y));
  }
  return Number.isFinite(closest) ? closest : 0;
}

export function quadPoint(start: ScreenPoint, control: ScreenPoint, end: ScreenPoint, t: number): ScreenPoint {
  const u = 1 - t;
  return { x: u * u * start.x + 2 * u * t * control.x + t * t * end.x, y: u * u * start.y + 2 * u * t * control.y + t * t * end.y };
}

export interface BridgeCurve { start: ScreenPoint; control: ScreenPoint; end: ScreenPoint; width: number; beads: ScreenPoint[]; path: string }

/** Smallest clearance between the arc (sampled) and the outlines of the other groups; negative = crossing. */
function clearance(start: ScreenPoint, control: ScreenPoint, end: ScreenPoint, others: readonly PlacedGroup[]): number {
  let least = Infinity;
  for (let step = 1; step < 16; step++) {
    const point = quadPoint(start, control, end, step / 16);
    for (const other of others) least = Math.min(least, Math.hypot(point.x - other.center.x, point.y - other.center.y) - other.size / 2);
  }
  return least;
}

/** Bow steps tried when the default arc would cross another group (share of the edge-to-edge distance). */
const avoidBows = [bridgeBow, 0.24, 0.34];
/** Clear space wanted between an arc and a group it passes, in pixels. */
const passGap = 8;

/**
 * A bridge between two galaxies: a quadratic Bézier whose ends sit exactly on the two outer rings, with the control
 * point bowed away from the stage centre by 14% of the edge-to-edge distance. When that arc would pass through
 * another group, the other side and then larger bows (24%, 34%) are tried, keeping the first that clears every other
 * group; if none does, the one with the most clearance is used (DESIGN.md §6.10, M5e-b review).
 */
export function bridgeCurve(a: PlacedGroup, b: PlacedGroup, weight: 1 | 2 | 3, stageCenter: ScreenPoint,
  others: readonly PlacedGroup[] = []): BridgeCurve | null {
  const dx = b.center.x - a.center.x, dy = b.center.y - a.center.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= a.ring + b.ring) return null;
  const ux = dx / distance, uy = dy / distance;
  const start = { x: a.center.x + ux * a.ring, y: a.center.y + uy * a.ring };
  const end = { x: b.center.x - ux * b.ring, y: b.center.y - uy * b.ring };
  const span = Math.hypot(end.x - start.x, end.y - start.y);
  const middle = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  let nx = -uy, ny = ux;
  if ((middle.x - stageCenter.x) * nx + (middle.y - stageCenter.y) * ny < 0) { nx = -nx; ny = -ny; }
  const candidates = avoidBows.flatMap((bow) => [1, -1].map((side) =>
    ({ x: middle.x + side * nx * span * bow, y: middle.y + side * ny * span * bow })));
  const rest = others.filter((other) => other.key !== a.key && other.key !== b.key);
  let control = candidates[0];
  if (rest.length) {
    let best = -Infinity;
    for (const candidate of candidates) {
      const room = clearance(start, candidate, end, rest);
      if (room >= passGap) { control = candidate; break; }
      if (room > best) { best = room; control = candidate; }
    }
  }
  const round = (value: number) => Math.round(value * 10) / 10;
  return {
    start, control, end, width: bridgeWidths[weight],
    beads: beadSpots[weight].map((t) => quadPoint(start, control, end, t)),
    path: 'M ' + round(start.x) + ' ' + round(start.y) + ' Q ' + round(control.x) + ' ' + round(control.y) + ' ' +
      round(end.x) + ' ' + round(end.y),
  };
}

/** Outer star-dust belt: nodes spread evenly on an ellipse (88% × 82% of the stage), first at the upper left. */
export function beltPositions(nodeIds: readonly string[], viewport: Viewport): Map<string, ScreenPoint> {
  const rx = viewport.width * 0.44, ry = viewport.height * 0.41;
  const sorted = [...nodeIds].sort();
  return new Map(sorted.map((id, index) => {
    const angle = -2.3 + (2 * Math.PI * index) / Math.max(1, sorted.length);
    return [id, { x: viewport.width / 2 + Math.cos(angle) * rx, y: viewport.height / 2 + Math.sin(angle) * ry }];
  }));
}

/** Small specks inside a galaxy, one per member (at most 12), on two radii like the visual base. */
export function galaxySpecks(members: number, size: number): { x: number; y: number; r: number }[] {
  const ring = size * outerRingShare;
  const count = Math.min(12, Math.max(1, members));
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2 - 0.5;
    const radius = ring * (0.34 + (index % 2) * 0.28);
    return { x: size / 2 + Math.cos(angle) * radius, y: size / 2 + Math.sin(angle) * radius, r: 2 + (index % 2) };
  });
}

export interface GalaxyExit {
  kind: 'bridge' | 'lineage';
  target: string;
  label: string;
  /** For lineage exits: the node to select after flying to the target galaxy. */
  nodeId?: string;
  count?: number;
}

/**
 * Exits shown at the edge of a galaxy interior: one per bridge ("→ 星系 B(N)", most collaboration first), then one per
 * lineage link that crosses into another group ("傳承自 → 星系 B 的〈節點名〉" when this galaxy's node inherited
 * from B, "傳承給 → …" the other way). Lineage to the hub or the outer belt has no galaxy to fly to and is left out.
 */
export function galaxyExits(map: EnabledMap, key: string, links: readonly CrystalLink[],
  names: ReadonlyMap<string, string>): GalaxyExit[] {
  const groupName = new Map(map.groups.map((group) => [group.key, group.name]));
  const bridges: GalaxyExit[] = map.bridges
    .filter((bridge: GalaxyBridge) => bridge.a === key || bridge.b === key)
    .sort((x, y) => y.count - x.count || (x.a + x.b < y.a + y.b ? -1 : 1))
    .map((bridge) => {
      const target = bridge.a === key ? bridge.b : bridge.a;
      return { kind: 'bridge', target, count: bridge.count, label: '→ ' + (groupName.get(target) ?? '星系') + '(' + bridge.count + ')' };
    });
  const lineage: GalaxyExit[] = [];
  for (const link of links) {
    if (link.kind !== 'lineage') continue;
    const fromGroup = map.membership[link.from]?.group ?? null;
    const toGroup = map.membership[link.to]?.group ?? null;
    if (toGroup === key && fromGroup && fromGroup !== key && groupName.has(fromGroup)) {
      lineage.push({ kind: 'lineage', target: fromGroup, nodeId: link.from,
        label: '傳承自 → ' + groupName.get(fromGroup) + ' 的〈' + (names.get(link.from) ?? '節點') + '〉' });
    } else if (fromGroup === key && toGroup && toGroup !== key && groupName.has(toGroup)) {
      lineage.push({ kind: 'lineage', target: toGroup, nodeId: link.to,
        label: '傳承給 → ' + groupName.get(toGroup) + ' 的〈' + (names.get(link.to) ?? '節點') + '〉' });
    }
  }
  return [...bridges, ...lineage];
}

/**
 * The crystals and links shown inside a group. Positions are moved so the members' bounding box is centred on the
 * origin (the global layout spreads a group over the whole shell), letting the interior rotate around its own centre
 * and zoom to fill the stage. Same-project links for this group itself are dropped: inside it every member shares
 * that project, so the lines and labels carry nothing (M5e-b review S1). Links for another shared project stay.
 * The match is by project key, so a different project with the same name is kept.
 */
export function interiorData(data: CrystalList, members: ReadonlySet<string>, groupKey: string): CrystalList {
  const crystals = data.crystals.filter((node) => members.has(node.nodeId));
  const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
  for (const { position } of crystals) {
    for (let axis = 0; axis < 3; axis++) {
      low[axis] = Math.min(low[axis], position[axis]);
      high[axis] = Math.max(high[axis], position[axis]);
    }
  }
  const middle = crystals.length ? low.map((value, axis) => (value + high[axis]) / 2) : [0, 0, 0];
  return {
    ...data,
    crystals: crystals.map((node) => ({ ...node, position: [node.position[0] - middle[0], node.position[1] - middle[1],
      node.position[2] - middle[2]] as [number, number, number] })),
    links: data.links.filter((link) => {
      if (link.kind === 'lineage' || link.kind === 'delegate') return members.has(link.from) && members.has(link.to);
      if (link.kind === 'project' && link.projectKey === groupKey) return false;
      return link.nodeIds.filter((id) => members.has(id)).length > 1;
    }),
  };
}

/**
 * "Also works in" for the detail panel (M5e-b review S4): the node's other projects, matched by project key so two
 * projects with the same name stay apart. Keys come from the same-project links (projects with at least two
 * members); a project only this node works in has no link, so for those only the names left over from
 * `projectNames` are added (they cannot be told apart by key until the IPC provides per-node project keys).
 * Shared folders are marked.
 */
export function alsoInProjects(nodeId: string, homeKey: string | null, homeName: string | undefined, projectNames: readonly string[],
  links: readonly CrystalLink[], map: EnabledMap): string[] {
  const kinds = new Map(map.groups.map((group) => [group.key, group.kind]));
  const byKey = new Map<string, string>();
  for (const link of links) {
    if (link.kind === 'project' && link.nodeIds.includes(nodeId) && link.projectKey !== homeKey) byKey.set(link.projectKey, link.projectName);
  }
  const named = [...byKey].map(([key, name]) => name + (kinds.get(key) === 'nebula' ? '(共用資料夾)' : ''));
  const linkedNames = new Set([...byKey.values(), ...(homeName ? [homeName] : [])]);
  const unlinked = projectNames.filter((name) => !linkedNames.has(name));
  return [...named, ...unlinked];
}
