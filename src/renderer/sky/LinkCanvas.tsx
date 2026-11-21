import type { RefObject } from 'react';
import type { Projection, Viewport } from '../../shared/projection';
import { canvasSurface } from './canvas';
import { linkStyles } from './link-styles';
import type { LinkKind, LinkSegment } from './link-styles';
import styles from './Sky.module.css';

export function LinkCanvas({ canvasRef }: { canvasRef: RefObject<HTMLCanvasElement | null> }) {
  return <canvas ref={canvasRef} className={styles.linkCanvas} aria-hidden="true" />;
}

interface ScreenPoint { x: number; y: number }
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
) {
  const ctx = canvasSurface(canvas, viewport);
  if (!ctx) return;
  const segments = bundleLinks(locations, links, visible).map((link) => ({
    ...link, highlighted: link.from === selected || link.to === selected,
  }));
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
  for (const { kind, label, start, end, labelAt } of segments.sort((a, b) => Number(b.highlighted) - Number(a.highlighted))) {
    const half = ctx.measureText(label).width / 2 + 4;
    const dx = end.x - start.x, dy = end.y - start.y;
    for (const t of [labelAt, 0.2, 0.8, 0.35, 0.65]) {
      const x = start.x + dx * t;
      if (x - half < 0 || x + half > viewport.width) continue;
      const baseline = start.y + dy * t - 7;
      const offset = labelOffsets.find((offset) => {
        const y = baseline + offset;
        return y >= 12 && y < viewport.height && (Math.abs(x - core.x) > 34 + half || Math.abs(y - core.y) > 34) &&
          !placed.some((other) => Math.abs(other.y - y) < 14 && Math.abs(other.x - x) < other.half + half);
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
