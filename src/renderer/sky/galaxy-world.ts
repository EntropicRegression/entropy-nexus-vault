/**
 * The galaxy overview as a map (DESIGN.md §6.10.2, user ruling 2026-11-22): galaxies sit at fixed world positions and
 * the screen is only a camera (centre + zoom). Pure functions, so the camera rules are testable without a DOM.
 *
 * World units are pixels at zoom 1.0 = the reference density (neighbours 260px apart, galaxies 150–210px wide). The
 * chief hub is the origin.
 */
import type { GalaxyMap } from '../../shared/types';
import { diameterOf, nebulaSize, outerRingShare, pixelsPerUnit } from './galaxy-geometry';
import type { PlacedGroup, ScreenPoint, Viewport } from './galaxy-geometry';

type EnabledMap = Extract<GalaxyMap, { enabled: true }>;

export const zoomLimits = { min: 0.45, max: 1.6 } as const;
/** Detail thresholds (§6.10.2 point 3): full ≥ 0.8, reduced 0.55–0.8, far below 0.55. */
export const detailThresholds = { full: 0.8, far: 0.55 } as const;
/** Programmatic camera moves (search, jumps, 回到全覽, minimap clicks); user drags and wheel follow at once. */
export const cameraMoveMs = 350;
/** will-change is dropped this long after the last camera change so text redraws sharply at the new zoom. */
export const settleMs = 150;
/** A press must move this far before it counts as a drag (so a click stays a click). */
export const dragThreshold = 4;
export const keyPan = { step: 80, shift: 240 } as const;
export const minimapSize = { width: 180, height: 110 } as const;

const spacing = pixelsPerUnit * 100;
const plateSpace = 46;
const groupGap = 24;
const hubRadius = 70;
const relaxPasses = 120;
/**
 * Outer belt (§6.10.2 point 4, revised): an ellipse around the outermost galaxy edges — 0.9 spacing left/right, 40px
 * above/below — in the same wide proportions as the old stage-fitted belt. The draft's circle (farthest distance +
 * 1.6 spacings) made even a three-project map open below zoom 0.55, contradicting the ruling 「開場維持目前」.
 */
const beltGap = { x: 0.9 * spacing, y: 40 } as const;
const beltMin = { x: 300, y: 200 } as const;
/** Retired projects (§6.10.3): drawn at this share of their size, on a ring this far outside the belt. */
export const retiredScale = 0.7;
const retiredGap = 110;
/** Room kept around the world when fitting. */
const fitMargin = 24;

export type DetailLevel = 'full' | 'mid' | 'far';

export interface Camera { x: number; y: number; zoom: number }
export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

export interface WorldLayout {
  groups: Map<string, PlacedGroup>;
  belt: Map<string, ScreenPoint>;
  /** Belt ellipse radii. */
  beltRadius: { x: number; y: number };
  bounds: Bounds;
}

/**
 * World positions: stored galaxy-layout positions × 2.6 (never squeezed to fit a window), then the same deterministic
 * separation as before so galaxies, nameplates and the hub do not overlap at zoom 1.0. The outer belt is a circle
 * around everything, its nodes sorted by ID and spread evenly (first at the upper left).
 */
export function worldLayout(map: EnabledMap): WorldLayout {
  const sizes = new Map(map.groups.map((group) => [group.key,
    (group.kind === 'galaxy' ? diameterOf(group.members.length, 1) : nebulaSize.width) * (group.retired ? retiredScale : 1)]));
  // Retired groups (§6.10.3) do not take part in the inner arrangement; they sit on a ring outside the belt.
  const keys = map.groups.filter((group) => !group.retired).map((group) => group.key);
  const points = new Map(map.groups.map((group) => [group.key, { x: group.position[0] * pixelsPerUnit, y: group.position[1] * pixelsPerUnit }]));
  for (let pass = 0; pass < relaxPasses; pass++) {
    let moved = false;
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const a = points.get(keys[i])!, b = points.get(keys[j])!;
        let dx = b.x - a.x, dy = b.y - a.y;
        let distance = Math.hypot(dx, dy);
        const vertical = distance > 0.01 ? Math.abs(dy) / distance : 0;
        const need = Math.max(spacing, (sizes.get(keys[i])! + sizes.get(keys[j])!) / 2 + groupGap + plateSpace * vertical);
        if (distance >= need - 0.01) continue;
        if (distance < 0.01) { dx = Math.cos(i + j); dy = Math.sin(i + j); distance = 1; }
        const push = (need - distance) / 2;
        a.x -= dx / distance * push; a.y -= dy / distance * push;
        b.x += dx / distance * push; b.y += dy / distance * push;
        moved = true;
      }
    }
    if (map.hub.length) {
      for (const key of keys) {
        const point = points.get(key)!;
        let dx = point.x, dy = point.y;
        let distance = Math.hypot(dx, dy);
        const above = distance > 0.01 && dy < 0 ? -dy / distance : 0;
        const keep = sizes.get(key)! / 2 + hubRadius + groupGap + plateSpace * above;
        if (distance < keep) {
          if (distance < 0.01) { dx = 1; dy = 0; distance = 1; }
          point.x = dx / distance * keep;
          point.y = dy / distance * keep;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
  const groups = new Map<string, PlacedGroup>();
  const edge = { x: hubRadius, y: hubRadius + plateSpace };
  for (const group of map.groups) {
    if (group.retired) continue;
    const size = sizes.get(group.key)!;
    const point = points.get(group.key)!;
    const center = { x: Math.round(point.x * 10) / 10, y: Math.round(point.y * 10) / 10 };
    edge.x = Math.max(edge.x, Math.abs(center.x) + size / 2);
    edge.y = Math.max(edge.y, Math.abs(center.y) + size / 2 + plateSpace);
    groups.set(group.key, { key: group.key, center, size, ring: group.kind === 'galaxy' ? size * outerRingShare : size / 2 });
  }
  const beltRadius = { x: Math.round(Math.max(beltMin.x, edge.x + beltGap.x)), y: Math.round(Math.max(beltMin.y, edge.y + beltGap.y)) };
  const retired = map.groups.filter((group) => group.retired).sort((x, y) => (x.key < y.key ? -1 : 1));
  retired.forEach((group, index) => {
    const size = sizes.get(group.key)!;
    const angle = -0.8 + (2 * Math.PI * index) / retired.length;
    const center = {
      x: Math.round(Math.cos(angle) * (beltRadius.x + retiredGap + size / 2) * 10) / 10,
      y: Math.round(Math.sin(angle) * (beltRadius.y + retiredGap + size / 2) * 10) / 10,
    };
    groups.set(group.key, { key: group.key, center, size, ring: group.kind === 'galaxy' ? size * outerRingShare : size / 2 });
  });
  const sorted = [...map.outer].sort();
  const belt = new Map(sorted.map((id, index) => {
    const angle = -2.3 + (2 * Math.PI * index) / Math.max(1, sorted.length);
    return [id, { x: Math.round(Math.cos(angle) * beltRadius.x * 10) / 10, y: Math.round(Math.sin(angle) * beltRadius.y * 10) / 10 }];
  }));
  const bounds: Bounds = { minX: -hubRadius, minY: -hubRadius, maxX: hubRadius, maxY: hubRadius + plateSpace };
  const grow = (x0: number, y0: number, x1: number, y1: number) => {
    bounds.minX = Math.min(bounds.minX, x0); bounds.minY = Math.min(bounds.minY, y0);
    bounds.maxX = Math.max(bounds.maxX, x1); bounds.maxY = Math.max(bounds.maxY, y1);
  };
  for (const group of groups.values()) {
    const half = group.size / 2;
    grow(group.center.x - half, group.center.y - half, group.center.x + half, group.center.y + half + plateSpace);
  }
  if (sorted.length) grow(-beltRadius.x - 60, -beltRadius.y - 16, beltRadius.x + 60, beltRadius.y + 30);
  return { groups, belt, beltRadius, bounds };
}

/** The zoom that just fits the whole world (with a small margin) into the viewport. */
export function fitZoom(bounds: Bounds, viewport: Viewport, margin = fitMargin): number {
  const width = bounds.maxX - bounds.minX + margin * 2, height = bounds.maxY - bounds.minY + margin * 2;
  if (viewport.width <= 0 || viewport.height <= 0) return 1;
  return Math.min(zoomLimits.max, viewport.width / width, viewport.height / height);
}

/** Lower limit = min(0.45, the fit zoom) so the whole world can always be seen; upper limit 1.6. */
export function zoomRange(bounds: Bounds, viewport: Viewport): { min: number; max: number } {
  return { min: Math.min(zoomLimits.min, fitZoom(bounds, viewport)), max: zoomLimits.max };
}

/** Camera that shows the whole world (開場與「回到全覽」). */
export function fitCamera(bounds: Bounds, viewport: Viewport): Camera {
  return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2, zoom: fitZoom(bounds, viewport) };
}

/** Camera that fits a set of world boxes (「看亮著的星系」); falls back to the whole world when empty. */
export function fitBoxes(boxes: readonly Bounds[], world: Bounds, viewport: Viewport): Camera {
  if (!boxes.length) return fitCamera(world, viewport);
  const box = boxes.reduce((all, item) => ({ minX: Math.min(all.minX, item.minX), minY: Math.min(all.minY, item.minY),
    maxX: Math.max(all.maxX, item.maxX), maxY: Math.max(all.maxY, item.maxY) }));
  return clampCamera(fitCamera(box, viewport), world, viewport);
}

/**
 * Zoom within its range; the centre stays inside the world box, so the content can never be dragged out of view
 * (the view's centre is always over the world, §6.10.2 point 1).
 */
export function clampCamera(camera: Camera, bounds: Bounds, viewport: Viewport): Camera {
  const range = zoomRange(bounds, viewport);
  const zoom = Math.min(range.max, Math.max(range.min, camera.zoom));
  return {
    x: Math.min(bounds.maxX, Math.max(bounds.minX, camera.x)),
    y: Math.min(bounds.maxY, Math.max(bounds.minY, camera.y)),
    zoom,
  };
}

export function toScreen(point: ScreenPoint, camera: Camera, viewport: Viewport): ScreenPoint {
  return { x: viewport.width / 2 + (point.x - camera.x) * camera.zoom, y: viewport.height / 2 + (point.y - camera.y) * camera.zoom };
}

export function toWorld(point: ScreenPoint, camera: Camera, viewport: Viewport): ScreenPoint {
  return { x: camera.x + (point.x - viewport.width / 2) / camera.zoom, y: camera.y + (point.y - viewport.height / 2) / camera.zoom };
}

/** Zoom by a factor keeping the world point under the cursor fixed (wheel and pinch). */
export function zoomAt(camera: Camera, factor: number, cursor: ScreenPoint, bounds: Bounds, viewport: Viewport): Camera {
  const range = zoomRange(bounds, viewport);
  const zoom = Math.min(range.max, Math.max(range.min, camera.zoom * factor));
  const anchor = toWorld(cursor, camera, viewport);
  return clampCamera({
    x: anchor.x - (cursor.x - viewport.width / 2) / zoom,
    y: anchor.y - (cursor.y - viewport.height / 2) / zoom,
    zoom,
  }, bounds, viewport);
}

/** Pan by a screen-pixel distance (drags move with the pointer, arrow keys move the view). */
export function panBy(camera: Camera, dx: number, dy: number, bounds: Bounds, viewport: Viewport): Camera {
  return clampCamera({ x: camera.x - dx / camera.zoom, y: camera.y - dy / camera.zoom, zoom: camera.zoom }, bounds, viewport);
}

/** The world rectangle the camera shows. */
export function viewBox(camera: Camera, viewport: Viewport): Bounds {
  const halfW = viewport.width / 2 / camera.zoom, halfH = viewport.height / 2 / camera.zoom;
  return { minX: camera.x - halfW, minY: camera.y - halfH, maxX: camera.x + halfW, maxY: camera.y + halfH };
}

export function contains(outer: Bounds, inner: Bounds, slack = 0.5): boolean {
  return inner.minX >= outer.minX - slack && inner.minY >= outer.minY - slack && inner.maxX <= outer.maxX + slack && inner.maxY <= outer.maxY + slack;
}

/** Camera that brings a box into view, moving as little as possible (focus follow, search, jumps); keeps the zoom. */
export function revealBox(camera: Camera, box: Bounds, bounds: Bounds, viewport: Viewport, padding = 24): Camera {
  const view = viewBox(camera, viewport);
  const pad = padding / camera.zoom;
  let { x, y } = camera;
  const width = view.maxX - view.minX, height = view.maxY - view.minY;
  if (box.maxX - box.minX + pad * 2 > width) x = (box.minX + box.maxX) / 2;
  else if (box.minX - pad < view.minX) x += box.minX - pad - view.minX;
  else if (box.maxX + pad > view.maxX) x += box.maxX + pad - view.maxX;
  if (box.maxY - box.minY + pad * 2 > height) y = (box.minY + box.maxY) / 2;
  else if (box.minY - pad < view.minY) y += box.minY - pad - view.minY;
  else if (box.maxY + pad > view.maxY) y += box.maxY + pad - view.maxY;
  return clampCamera({ x, y, zoom: camera.zoom }, bounds, viewport);
}

/** The box of a group including its nameplate (for reveal, fit-the-lit and the minimap). */
export function groupBox(group: PlacedGroup): Bounds {
  const half = group.size / 2;
  return { minX: group.center.x - half, minY: group.center.y - half, maxX: group.center.x + half, maxY: group.center.y + half + plateSpace };
}

export function detailLevel(zoom: number): DetailLevel {
  return zoom >= detailThresholds.full ? 'full' : zoom >= detailThresholds.far ? 'mid' : 'far';
}

/** Bridges at each level: full keeps every weight; reduced thins each line one step and drops the beads; far keeps only the strongest. */
export function bridgeStyle(level: DetailLevel, weight: 1 | 2 | 3): { show: boolean; width: number; beads: boolean } {
  const widths = { 1: 1.5, 2: 3, 3: 5 } as const;
  if (level === 'full') return { show: true, width: widths[weight], beads: true };
  if (level === 'mid') return { show: true, width: weight === 1 ? 1 : widths[(weight - 1) as 1 | 2], beads: false };
  return { show: weight === 3, width: widths[3], beads: false };
}

/**
 * Which belt names fit without overlapping at this zoom (§6.10.2 point 4): walking the belt in ID order, a name is
 * kept when its on-screen box does not touch the last kept one; the dots always stay. Widths are estimated from the
 * character count at 11px.
 */
export function beltLabels(belt: ReadonlyMap<string, ScreenPoint>, names: ReadonlyMap<string, string>, zoom: number): Set<string> {
  const kept = new Set<string>();
  const boxes: Bounds[] = [];
  for (const [id, point] of belt) {
    const width = (Array.from(names.get(id) ?? id).length * 11 + 28) / zoom;
    const height = 20 / zoom;
    const box = { minX: point.x - width / 2, minY: point.y - height / 2, maxX: point.x + width / 2, maxY: point.y + height / 2 };
    if (boxes.some((other) => box.minX < other.maxX && box.maxX > other.minX && box.minY < other.maxY && box.maxY > other.minY)) continue;
    boxes.push(box);
    kept.add(id);
  }
  return kept;
}

/** Ease-out used by programmatic camera moves. */
export function easeOut(t: number): number {
  return 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
}

export function lerpCamera(from: Camera, to: Camera, t: number): Camera {
  const k = easeOut(t);
  return { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k, zoom: from.zoom + (to.zoom - from.zoom) * k };
}

/** Minimap scale and offset: the whole world fitted into 180 × 110 with a 6px inset. */
export function minimapTransform(bounds: Bounds): { scale: number; x: number; y: number } {
  const inset = 6;
  const width = bounds.maxX - bounds.minX, height = bounds.maxY - bounds.minY;
  const scale = Math.min((minimapSize.width - inset * 2) / Math.max(1, width), (minimapSize.height - inset * 2) / Math.max(1, height));
  return {
    scale,
    x: (minimapSize.width - width * scale) / 2 - bounds.minX * scale,
    y: (minimapSize.height - height * scale) / 2 - bounds.minY * scale,
  };
}
