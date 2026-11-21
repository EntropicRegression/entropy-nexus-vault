import { initialCamera, project } from './projection';
import type { Point3 } from './projection';

/**
 * minGap: 3D distance; minScreenGap: on-screen distance (px) under the default camera, relaxed in step with minGap.
 * Screen distances do not depend on the viewport size (only the projection centre moves), so no viewport is needed.
 */
export interface LayoutParams { radii: number[]; minGap: number[]; minScreenGap: number[]; candidates: number }

export const defaultLayoutParams: LayoutParams = {
  radii: [220, 280, 340], minGap: [90, 70, 55], minScreenGap: [110, 90, 70], candidates: 512,
};
const referenceViewport = { width: 1000, height: 800 };

function screenOf(point: Point3) {
  const { x, y } = project(point, initialCamera, referenceViewport);
  return [x, y] as const;
}

export function hashNodeId(id: string): number {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(id)) hash = Math.imul(hash ^ byte, 0x01000193);
  return hash >>> 0;
}

function directionOf(id: string): Point3 {
  const hash = hashNodeId(id);
  const theta = 2 * Math.PI * (hash & 0xffff) / 65535;
  const phi = Math.acos(1 - 2 * (hash >>> 16) / 65535);
  return [Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta)];
}

function onShell([x, y, z]: Point3, radius: number): Point3 {
  return [x * radius, y * radius * 0.6, z * radius];
}

export function initialPoint(nodeId: string, radius: number): Point3 {
  return onShell(directionOf(nodeId), radius);
}

function fibonacciDirections(count: number): Point3[] {
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: count }, (_, i) => {
    const y = 1 - 2 * (i + 0.5) / count;
    const spread = Math.sqrt(1 - y ** 2);
    return [spread * Math.cos(i * goldenAngle), y, spread * Math.sin(i * goldenAngle)];
  });
}

function nearestSquared([x, y, z]: Point3, placed: readonly Point3[]): number {
  let nearest = Infinity;
  for (const [px, py, pz] of placed) {
    nearest = Math.min(nearest, (x - px) ** 2 + (y - py) ** 2 + (z - pz) ** 2);
  }
  return nearest;
}

function nearestScreen([x, y]: readonly [number, number], placed: readonly (readonly [number, number])[]): number {
  let nearest = Infinity;
  for (const [px, py] of placed) nearest = Math.min(nearest, Math.hypot(x - px, y - py));
  return nearest;
}

/** Minimum on-screen distance between any two points under the default camera. */
export function minimumScreenGap(points: readonly Point3[]): number {
  const screens = points.map(screenOf);
  let nearest = Infinity;
  for (const [i, point] of screens.entries()) nearest = Math.min(nearest, nearestScreen(point, screens.slice(i + 1)));
  return nearest;
}

export function placeNew(fixed: ReadonlyMap<string, Point3>, newIds: readonly string[],
  params = defaultLayoutParams): Map<string, Point3> {
  const placed = [...fixed.values()];
  const placedScreens = placed.map(screenOf);
  const added = new Map<string, Point3>();
  const directions = fibonacciDirections(params.candidates);
  for (const id of [...new Set(newIds)].sort()) {
    if (fixed.has(id)) continue;
    const origin = directionOf(id);
    const initial = onShell(origin, params.radii[0]);
    let position = initial;
    if (nearestSquared(initial, placed) < params.minGap[0] ** 2 ||
      nearestScreen(screenOf(initial), placedScreens) < params.minScreenGap[0]) {
      const ranked = directions.map((direction) => {
        const [x, y, z] = direction;
        return { direction, similarity: x * origin[0] + y * origin[1] + z * origin[2] };
      }).sort((a, b) => b.similarity - a.similarity);
      const points = params.radii.flatMap((radius) => [origin, ...ranked.map(({ direction }) => direction)]
        .map((direction) => onShell(direction, radius)));
      const distances = points.map((point) => Math.sqrt(nearestSquared(point, placed)));
      const screens = points.map((point) => nearestScreen(screenOf(point), placedScreens));
      // Relax both thresholds together; a candidate must satisfy the 3D gap and the screen gap of the same level.
      const gap = params.minGap.map((value, level) => distances.findIndex((distance, i) =>
        distance >= value && screens[i] >= params.minScreenGap[level])).find((i) => i >= 0);
      const screenTerm = (i: number) => params.minScreenGap[0] > 0 ? screens[i] / params.minScreenGap[0] : Infinity;
      const score = (i: number) => Math.min(distances[i] / params.minGap[0], screenTerm(i));
      const best = gap ?? distances.reduce((best, _value, i) => score(i) > score(best) ? i : best, 0);
      position = points[best];
    }
    added.set(id, position);
    placed.push(position);
    placedScreens.push(screenOf(position));
  }
  return added;
}
