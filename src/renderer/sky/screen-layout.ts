import { crystalStyle, initialCamera, project } from '../../shared/projection';
import type { Point3, Projection, Viewport } from '../../shared/projection';

const halfWidth = 78;
const halfHeight = 116;
const labelCenterY = 78;
const labelHeight = 48;
const topControls = 92;
const padding = 8;
const minZoom = 0.65;
/** Auto-fit only zooms out; few crystals keep the v9 framing instead of being blown up. */
const maxAutoZoom = 1;

export interface Box { x: number; y: number; width: number; height: number }

/** Radius of the smallest origin-centred sphere that contains every crystal (rotation-independent). */
export function boundingRadius(points: Iterable<Point3>): number {
  let radius = 0;
  for (const [x, y, z] of points) radius = Math.max(radius, Math.hypot(x, y, z));
  return radius;
}

/** Crystals shrink when many share the stage, so 30 crystals stay readable (1 up to 12, down to 0.6). */
export function densityScale(count: number): number {
  return count <= 12 ? 1 : Math.max(0.6, Math.sqrt(12 / count));
}

/**
 * Worst-case on-screen half extent of the bounding sphere, including crystal bodies, at a given zoom.
 * It does not depend on yaw or pitch, so fitting with it never "breathes" while the view rotates.
 */
export function sphereExtent(radius: number, zoom: number, density = 1) {
  let width = halfWidth * density, height = halfHeight * density;
  for (let step = 0; step <= 32; step++) {
    const depth = -radius + (2 * radius * step) / 32;
    const lateral = Math.sqrt(Math.max(0, radius * radius - depth * depth));
    const scale = 620 * zoom / Math.max(140, 560 + depth);
    const crystal = crystalStyle({ x: 0, y: 0, scale, depth }).scale * density;
    width = Math.max(width, lateral * scale + halfWidth * crystal);
    height = Math.max(height, lateral * scale + halfHeight * crystal);
  }
  return { halfWidth: width, halfHeight: height };
}

function available({ width, height }: Viewport) {
  return { width: Math.max(1, width - 2 * padding), height: Math.max(1, height - Math.min(topControls, height * 0.25) - padding) };
}

/**
 * Default-view auto-fit: the largest zoom (0.65–1) at which every crystal, as projected by the default camera,
 * fits the stage. It only zooms out, so a small constellation keeps the v9 framing.
 */
export function autoZoom(points: readonly Point3[], viewport: Viewport, density = 1): number {
  if (!points.length) return maxAutoZoom;
  const fits = (zoom: number) => {
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
    for (const point of points) {
      const projected = project(point, { ...initialCamera, zoom }, viewport);
      const crystal = crystalStyle(projected).scale * density;
      left = Math.min(left, projected.x - halfWidth * crystal);
      right = Math.max(right, projected.x + halfWidth * crystal);
      top = Math.min(top, projected.y - halfHeight * crystal);
      bottom = Math.max(bottom, projected.y + halfHeight * crystal);
    }
    // The default view is not translated, so the box must fit where it is, not just be small enough.
    const safeTop = Math.min(topControls, viewport.height * 0.25);
    return left >= padding && right <= viewport.width - padding && top >= safeTop && bottom <= viewport.height - padding;
  };
  if (fits(maxAutoZoom)) return maxAutoZoom;
  let low = minZoom, high = maxAutoZoom;
  for (let i = 0; i < 24; i++) {
    const middle = (low + high) / 2;
    if (fits(middle)) low = middle;
    else high = middle;
  }
  return low;
}

/**
 * When the detail panel narrows the stage, scale the projected scene about its centre so the bounding sphere fits.
 * The factor comes from the sphere, not from the current projections, so dragging with the panel open is stable.
 */
export function fitViewport(
  positions: ReadonlyMap<string, Projection>, viewport: Viewport, fit: boolean, extent: { halfWidth: number; halfHeight: number },
) {
  const { width, height } = viewport;
  const center = { x: width / 2, y: height * 0.52 };
  if (!fit || !positions.size) return { positions, center, factor: 1, dx: 0, dy: 0 };
  const room = available(viewport);
  const factor = Math.min(1, room.width / (2 * extent.halfWidth), room.height / (2 * extent.halfHeight));
  const safeTop = Math.min(topControls, height * 0.25);
  const top = center.y - extent.halfHeight * factor;
  const bottom = center.y + extent.halfHeight * factor;
  const dy = top < safeTop ? safeTop - top : bottom > height - padding ? height - padding - bottom : 0;
  return {
    positions: new Map([...positions].map(([id, point]) => [id, {
      ...point, x: center.x + (point.x - center.x) * factor, y: center.y + (point.y - center.y) * factor + dy,
    }])),
    center: { x: center.x, y: center.y + dy }, factor, dx: 0, dy,
  };
}

export function placeLabels(
  positions: ReadonlyMap<string, Projection>, width: number, factor: number, selected: string | null,
  labelWidths: ReadonlyMap<string, number>, density = 1,
) {
  const ranked = [...positions].sort(([a, first], [b, second]) =>
    Number(b === selected) - Number(a === selected) || first.depth - second.depth || (a < b ? -1 : Number(a > b)));
  const occupied: Box[] = [];
  return ranked.map(([id, point], index) => {
    const scale = crystalStyle(point).scale * factor * density;
    const naturalWidth = (labelWidths.get(id) || 100) * scale;
    const height = labelHeight * scale;
    const y = point.y + labelCenterY * scale;
    const offset = [0, -1, 1, -1.7, 1.7].map((step) => step * naturalWidth).find((dx) => {
      const x = point.x + dx;
      return x - naturalWidth / 2 >= 2 && x + naturalWidth / 2 <= width - 2 &&
        !occupied.some((other) => Math.abs(x - other.x) < (other.width + naturalWidth) / 2 + 3 &&
          Math.abs(y - other.y) < (other.height + height) / 2 + 2);
    });
    const x = point.x + (offset ?? 0);
    const crowded = offset === undefined && id !== selected;
    const box = { x, y: crowded ? y - 8 * scale : y, width: naturalWidth, height: crowded ? height / 2 : height };
    occupied.push(box);
    return { id, zIndex: ranked.length - index, badgeHidden: crowded, labelOffset: (offset ?? 0) / scale, box };
  });
}
