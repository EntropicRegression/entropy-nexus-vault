import type { Point3 } from './projection';

export interface LayoutParams { radii: number[]; minGap: number[]; candidates: number }

export const defaultLayoutParams: LayoutParams = { radii: [220, 280, 340], minGap: [90, 70, 55], candidates: 512 };

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

export function placeNew(fixed: ReadonlyMap<string, Point3>, newIds: readonly string[],
  params = defaultLayoutParams): Map<string, Point3> {
  const placed = [...fixed.values()];
  const added = new Map<string, Point3>();
  const directions = fibonacciDirections(params.candidates);
  for (const id of [...new Set(newIds)].sort()) {
    if (fixed.has(id)) continue;
    const origin = directionOf(id);
    const initial = onShell(origin, params.radii[0]);
    let position = initial;
    if (nearestSquared(initial, placed) < params.minGap[0] ** 2) {
      const ranked = directions.map((direction) => {
        const [x, y, z] = direction;
        return { direction, similarity: x * origin[0] + y * origin[1] + z * origin[2] };
      }).sort((a, b) => b.similarity - a.similarity);
      const points = params.radii.flatMap((radius) => [origin, ...ranked.map(({ direction }) => direction)]
        .map((direction) => onShell(direction, radius)));
      const distances = points.map((point) => nearestSquared(point, placed));
      const gap = params.minGap.map((value) => distances.findIndex((distance) => distance >= value ** 2)).find((i) => i >= 0);
      const best = gap ?? distances.reduce((best, value, i) => value > distances[best] ? i : best, 0);
      position = points[best];
    }
    added.set(id, position);
    placed.push(position);
  }
  return added;
}
