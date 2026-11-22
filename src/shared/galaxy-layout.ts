/**
 * Galaxy positions on the overview plane (DESIGN.md §6.10). Units are abstract: `spacing` is the distance between two
 * neighbouring groups; the hub sits at the origin. Placed groups never move; only an explicit "arrange once" does.
 */
import { hashNodeId } from './crystal-layout';
import type { GalaxyBridge } from './galaxies';

export type Point2 = [number, number];

export const galaxyLayout = {
  /** Distance from a group to the partner it is placed next to. */
  spacing: 100,
  /** Groups closer than this (× spacing) count as overlapping. */
  minGap: 0.9,
  /** Directions tried around a partner or on a ring. */
  directions: 12,
  /** Rings tried before giving up and using the last candidate. */
  rings: 12,
} as const;

const round = (value: number) => Math.round(value * 100) / 100;

function angleOf(key: string): number {
  return 2 * Math.PI * (hashNodeId(key) % 3600) / 3600;
}

function collaboration(bridges: readonly GalaxyBridge[]) {
  const weights = new Map<string, Map<string, number>>();
  for (const { a, b, count } of bridges) {
    weights.set(a, new Map(weights.get(a)).set(b, count));
    weights.set(b, new Map(weights.get(b)).set(a, count));
  }
  return weights;
}

function free(point: Point2, placed: Iterable<Point2>): boolean {
  const limit = galaxyLayout.spacing * galaxyLayout.minGap;
  // The hub at the origin keeps its own space.
  if (Math.hypot(point[0], point[1]) < limit) return false;
  for (const [x, y] of placed) if (Math.hypot(point[0] - x, point[1] - y) < limit) return false;
  return true;
}

/** First free spot on rings around `center`, starting from the key's own angle; deterministic. */
function spotAround(center: Point2, key: string, placed: Iterable<Point2>, firstRing: number): Point2 {
  const start = angleOf(key);
  const list = [...placed];
  let last: Point2 = center;
  for (let ring = firstRing; ring < firstRing + galaxyLayout.rings; ring++) {
    const steps = galaxyLayout.directions * Math.max(1, ring);
    for (let step = 0; step < steps; step++) {
      const angle = start + 2 * Math.PI * step / steps;
      const point: Point2 = [round(center[0] + Math.cos(angle) * galaxyLayout.spacing * ring),
        round(center[1] + Math.sin(angle) * galaxyLayout.spacing * ring)];
      last = point;
      if (free(point, list)) return point;
    }
  }
  return last;
}

/**
 * Positions for groups not placed yet. Existing positions are returned unchanged. New groups are placed in order of
 * how much they collaborate (then by key); each goes next to the placed group it collaborates with most, or, with no
 * partner, on rings around the hub at a spot derived from its key.
 */
export function placeGalaxies(existing: ReadonlyMap<string, Point2>, keys: readonly string[],
  bridges: readonly GalaxyBridge[]): Map<string, Point2> {
  const positions = new Map(existing);
  const weights = collaboration(bridges);
  const total = (key: string) => [...(weights.get(key)?.values() ?? [])].reduce((sum, value) => sum + value, 0);
  const pending = keys.filter((key) => !positions.has(key))
    .sort((x, y) => total(y) - total(x) || (x < y ? -1 : 1));
  for (const key of pending) {
    let partner: string | null = null;
    let best = 0;
    for (const [other, count] of weights.get(key) ?? []) {
      if (!positions.has(other)) continue;
      if (count > best || (count === best && partner !== null && other < partner)) { partner = other; best = count; }
    }
    positions.set(key, partner ? spotAround(positions.get(partner)!, key, positions.values(), 1)
      : spotAround([0, 0], key, positions.values(), 1));
  }
  return positions;
}

/** "Arrange once": positions for every group from scratch, closest collaborators placed next to each other. */
export function arrangeGalaxies(keys: readonly string[], bridges: readonly GalaxyBridge[]): Map<string, Point2> {
  return placeGalaxies(new Map(), keys, bridges);
}
