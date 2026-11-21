import { crystalStyle } from '../../shared/projection';
import type { Projection, Viewport } from '../../shared/projection';

const halfWidth = 78;
const halfHeight = 116;
const labelCenterY = 78;
const topControls = 92;

export function fitViewport(
  positions: ReadonlyMap<string, Projection>, viewport: Viewport, fit: boolean,
) {
  const { width, height } = viewport;
  const center = { x: width / 2, y: height * 0.52 };
  if (!fit || !positions.size) return { positions, center, factor: 1, dx: 0, dy: 0 };

  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const point of positions.values()) {
    const { scale } = crystalStyle(point);
    left = Math.min(left, point.x - halfWidth * scale);
    right = Math.max(right, point.x + halfWidth * scale);
    top = Math.min(top, point.y - halfHeight * scale);
    bottom = Math.max(bottom, point.y + halfHeight * scale);
  }

  const padding = 8;
  const safeTop = Math.min(topControls, height * 0.25);
  const factor = Math.min(1, Math.max(1, width - 2 * padding) / (right - left),
    Math.max(1, height - safeTop - padding) / (bottom - top));
  const constrain = (min: number, max: number, oldCenter: number, low: number, high: number) => {
    const first = low - ((min - oldCenter) * factor + oldCenter);
    const last = high - ((max - oldCenter) * factor + oldCenter);
    return Math.min(last, Math.max(first, 0));
  };
  const dx = constrain(left, right, center.x, padding, width - padding);
  const dy = constrain(top, bottom, center.y, safeTop, height - padding);
  return {
    positions: new Map([...positions].map(([id, point]) => [id, {
      ...point, x: center.x + (point.x - center.x) * factor + dx, y: center.y + (point.y - center.y) * factor + dy,
    }])),
    center: { x: center.x + dx, y: center.y + dy }, factor, dx, dy,
  };
}

export function placeLabels(
  positions: ReadonlyMap<string, Projection>, width: number, factor: number, selected: string | null,
  labelWidths: ReadonlyMap<string, number>,
) {
  const ranked = [...positions].sort(([a, first], [b, second]) =>
    Number(b === selected) - Number(a === selected) || first.depth - second.depth || (a < b ? -1 : Number(a > b)));
  const occupied: { x: number; y: number; width: number; height: number }[] = [];
  return ranked.map(([id, point], index) => {
    const scale = crystalStyle(point).scale * factor;
    const naturalWidth = (labelWidths.get(id) || 100) * scale;
    const height = 48 * scale;
    const y = point.y + labelCenterY * scale;
    const offset = [0, -1, 1, -1.7, 1.7].map((step) => step * naturalWidth).find((dx) => {
      const x = point.x + dx;
      return x - naturalWidth / 2 >= 2 && x + naturalWidth / 2 <= width - 2 &&
        !occupied.some((other) => Math.abs(x - other.x) < (other.width + naturalWidth) / 2 + 3 &&
          Math.abs(y - other.y) < (other.height + height) / 2 + 2);
    });
    const x = point.x + (offset ?? 0);
    const crowded = offset === undefined && id !== selected;
    occupied.push({ x, y: crowded ? y - 8 * scale : y, width: naturalWidth, height: crowded ? height / 2 : height });
    return { id, zIndex: ranked.length - index, badgeHidden: crowded, labelOffset: (offset ?? 0) / scale };
  });
}
