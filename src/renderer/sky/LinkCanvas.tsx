import type { RefObject } from 'react';
import type { Projection, Viewport } from '../../shared/projection';
import { canvasSurface } from './canvas';
import { linkStyles } from './link-styles';
import type { LinkKind, LinkSegment } from './link-styles';
import type { Box } from './screen-layout';
import styles from './Sky.module.css';

export function LinkCanvas({ canvasRef }: { canvasRef: RefObject<HTMLCanvasElement | null> }) {
  return <canvas ref={canvasRef} className={styles.linkCanvas} aria-hidden="true" />;
}

interface ScreenPoint { x: number; y: number }
/** A crystal's hexagon on screen: centre and size after scaling, and the clear space to keep around it. */
export interface CrystalBody { cx: number; cy: number; width: number; height: number; gap: number }

/** Hexagon outline as fractions of the shape box (Sky.module.css .crystalShape clip-path). */
const hexagon: readonly [number, number][] = [[0.5, 0], [0.92, 0.24], [0.92, 0.76], [0.5, 1], [0.08, 0.76], [0.08, 0.24]];

/**
 * Cuts the segment from `outside` towards `inside` where it meets the hexagon, then backs off by the gap, so the line
 * stops short of the crystal (DESIGN.md §6.9: gold crystals keep about 5px clear of the gold lineage line).
 */
export function trimToBody(outside: ScreenPoint, inside: ScreenPoint, body: CrystalBody): ScreenPoint {
  const dx = inside.x - outside.x, dy = inside.y - outside.y;
  const length = Math.hypot(dx, dy);
  if (!length) return inside;
  const left = body.cx - body.width / 2, top = body.cy - body.height / 2;
  const points = hexagon.map(([x, y]) => ({ x: left + x * body.width, y: top + y * body.height }));
  let hit = Infinity;
  for (let index = 0; index < points.length; index++) {
    const a = points[index], b = points[(index + 1) % points.length];
    const ex = b.x - a.x, ey = b.y - a.y;
    const denominator = dx * ey - dy * ex;
    if (!denominator) continue;
    const t = ((a.x - outside.x) * ey - (a.y - outside.y) * ex) / denominator;
    const u = ((a.x - outside.x) * dy - (a.y - outside.y) * dx) / denominator;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) hit = Math.min(hit, t);
  }
  if (!Number.isFinite(hit)) return inside;
  const t = Math.max(0, hit - body.gap / length);
  return { x: outside.x + dx * t, y: outside.y + dy * t };
}

interface LabelBounds extends ScreenPoint { half: number }
const labelColors: Record<LinkKind, string> = {
  lineage: '#fde69f', delegate: '#b9e8ff', meeting: '#e4d5ff', project: '#a7f3d0',
};
const labelOffsets = [0, -15, 15, -30, 30, -45, 45];

export function bundleLinks(
  locations: ReadonlyMap<string, Projection>, links: readonly LinkSegment[], visible: ReadonlySet<LinkKind>,
) {
  const bundles = new Map<string, { a: ScreenPoint; b: ScreenPoint; segments: LinkSegment[] }>();
  for (const link of links) {
    if (!visible.has(link.kind)) continue;
    const from = link.from < link.to ? link.from : link.to;
    const to = from === link.from ? link.to : link.from;
    const a = locations.get(from), b = locations.get(to);
    if (!a || !b) continue;
    const key = JSON.stringify([from, to]);
    const bundle = bundles.get(key);
    if (bundle) bundle.segments.push(link);
    else bundles.set(key, { a, b, segments: [link] });
  }
  return [...bundles.values()].flatMap(({ a, b, segments }) => {
    const dx = b.x - a.x, dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    const normal = length ? { x: -dy / length, y: dx / length } : { x: 0, y: 1 };
    return segments.map((link, index) => {
      const offset = (index - (segments.length - 1) / 2) * 5;
      const start = { x: a.x + normal.x * offset, y: a.y + normal.y * offset };
      const end = { x: b.x + normal.x * offset, y: b.y + normal.y * offset };
      const labelAt = segments.length === 1 ? 0.5 : 0.26 + 0.48 * index / (segments.length - 1);
      return { ...link, start, end, labelAt };
    });
  });
}

export function drawLinks(
  canvas: HTMLCanvasElement, viewport: Viewport, locations: ReadonlyMap<string, Projection>,
  links: readonly LinkSegment[], visible: ReadonlySet<LinkKind>, selected: string | null,
  core: ScreenPoint = { x: viewport.width / 2, y: viewport.height * 0.52 },
  nameplates: readonly Box[] = [],
  /** Dense maps: draw only the labels of links touching the selected crystal (none without a selection). */
  labelsForSelectionOnly = false,
  /** Crystals whose lineage lines stop at the body edge plus a gap (gold tier). */
  bodies: ReadonlyMap<string, CrystalBody> = new Map(),
) {
  const ctx = canvasSurface(canvas, viewport);
  if (!ctx) return;
  const segments = bundleLinks(locations, links, visible).map((link) => {
    let { start, end } = link;
    if (link.kind === 'lineage' && bodies.size) {
      const startId = link.from < link.to ? link.from : link.to;
      const endId = startId === link.from ? link.to : link.from;
      const endBody = bodies.get(endId), startBody = bodies.get(startId);
      if (endBody) end = trimToBody(start, end, endBody);
      if (startBody) start = trimToBody(end, start, startBody);
    }
    return { ...link, start, end, highlighted: link.from === selected || link.to === selected };
  });
  for (const { kind, start, end, highlighted } of segments) {
    const { color, width, dash } = linkStyles[kind];
    ctx.globalAlpha = selected && !highlighted ? 0.42 : 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = width + (highlighted ? 0.8 : 0);
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  ctx.font = '600 10.5px "Segoe UI", "Noto Sans TC", sans-serif';
  ctx.textAlign = 'center';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#080e22';
  const placed: LabelBounds[] = [];
  for (const { kind, label, start, end, labelAt, highlighted } of segments.sort((a, b) => Number(b.highlighted) - Number(a.highlighted))) {
    if (labelsForSelectionOnly && !highlighted) continue;
    const half = ctx.measureText(label).width / 2 + 4;
    const dx = end.x - start.x, dy = end.y - start.y;
    for (const t of [labelAt, 0.2, 0.8, 0.35, 0.65]) {
      const x = start.x + dx * t;
      if (x - half < 0 || x + half > viewport.width) continue;
      const baseline = start.y + dy * t - 7;
      const offset = labelOffsets.find((offset) => {
        const y = baseline + offset;
        return y >= 12 && y < viewport.height && (Math.abs(x - core.x) > 34 + half || Math.abs(y - core.y) > 34) &&
          !placed.some((other) => Math.abs(other.y - y) < 14 && Math.abs(other.x - x) < other.half + half) &&
          // Keep link labels off crystal nameplates (text box is ~12px tall, baseline at y).
          !nameplates.some((plate) => Math.abs(plate.x - x) < plate.width / 2 + half + 2 &&
            Math.abs(plate.y - (y - 4)) < plate.height / 2 + 9);
      });
      if (offset === undefined) continue;
      const y = baseline + offset;
      placed.push({ x, y, half });
      ctx.fillStyle = labelColors[kind];
      ctx.strokeText(label, x, y);
      ctx.fillText(label, x, y);
      break;
    }
  }
}
