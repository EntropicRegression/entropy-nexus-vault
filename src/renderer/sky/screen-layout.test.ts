import { describe, expect, it } from 'vitest';
import { crystalStyle, initialCamera, project } from '../../shared/projection';
import type { Point3 } from '../../shared/projection';
import { autoZoom, boundingRadius, densityScale, fitViewport, placeLabels, sphereExtent } from './screen-layout';

describe('星圖可視區及水晶銘牌', () => {
  const viewport = { width: 764, height: 652 };
  const points: Point3[] = [[-208, -32, 46], [159, 13, -150], [-9, 61, -194], [-173, -26, 129], [300, 40, 120]];
  const radius = boundingRadius(points);

  function projectAll(yaw: number, pitch: number, zoom: number) {
    return new Map(points.map((point, i) => [String(i), project(point, { yaw, pitch, zoom }, viewport)]));
  }

  it('開欄時以包圍球縮放:任何旋轉角度下水晶都完整進場,關欄用原始投影', () => {
    for (const [yaw, pitch] of [[0.25, 0.14], [1.4, -0.9], [-2.6, 0.95], [3.1, 0]]) {
      const fitted = fitViewport(projectAll(yaw, pitch, 1), viewport, true, sphereExtent(radius, 1));
      for (const point of fitted.positions.values()) {
        const scale = crystalStyle(point).scale * fitted.factor;
        expect(point.x - 78 * scale).toBeGreaterThanOrEqual(7.9);
        expect(point.x + 78 * scale).toBeLessThanOrEqual(756.1);
        expect(point.y - 116 * scale).toBeGreaterThanOrEqual(91.9);
        expect(point.y + 116 * scale).toBeLessThanOrEqual(644.1);
      }
    }
    const open = projectAll(0.25, 0.14, 1);
    expect(fitViewport(open, viewport, false, sphereExtent(radius, 1))).toMatchObject({ positions: open, factor: 1, dx: 0, dy: 0 });
  });

  it('B6:開欄拖曳旋轉時縮放倍率不隨角度改變(不會忽大忽小)', () => {
    const extent = sphereExtent(radius, 1.2);
    const factors = [0, 0.4, 0.8, 1.6, 2.4, 3.2].map((yaw) =>
      fitViewport(projectAll(yaw, 0.6, 1.2), viewport, true, extent).factor);
    expect(new Set(factors).size).toBe(1);
    expect(factors[0]).toBeLessThan(1);
  });

  it('自動適配只拉遠:少量水晶維持 1,30 顆在 1280 的舞台會拉遠到放得下(以預設相機投影)', () => {
    expect(autoZoom(points.slice(0, 4), { width: 1084, height: 792 })).toBe(1);
    const many: Point3[] = Array.from({ length: 30 }, (_, i) => {
      const angle = i * 2.4;
      const r = 220 + (i % 3) * 60;
      return [r * Math.cos(angle), r * 0.6 * Math.sin(i * 1.3), r * Math.sin(angle)];
    });
    const room = { width: 764, height: 652 };
    const zoom = autoZoom(many, room, densityScale(30));
    expect(zoom).toBeLessThan(1);
    expect(zoom).toBeGreaterThanOrEqual(0.65);
    const xs = many.map((point) => project(point, { ...initialCamera, zoom }, room));
    for (const p of xs) {
      const half = 78 * crystalStyle(p).scale * densityScale(30);
      expect(p.x - half).toBeGreaterThanOrEqual(-1);
      expect(p.x + half).toBeLessThanOrEqual(room.width + 1);
    }
    expect(autoZoom(many, { width: 300, height: 260 })).toBe(0.65);
  });

  it('密度縮放:12 顆以內不縮,30 顆約 0.63,下限 0.6', () => {
    expect(densityScale(4)).toBe(1);
    expect(densityScale(12)).toBe(1);
    expect(densityScale(30)).toBeCloseTo(0.632, 3);
    expect(densityScale(500)).toBe(0.6);
  });

  it('預設相機下的投影與 v9 公式一致,包圍球半徑取最遠的水晶', () => {
    expect(radius).toBeCloseTo(Math.hypot(300, 40, 120));
    expect(project(points[0], initialCamera, viewport).x).toBeCloseTo(viewport.width / 2 +
      (points[0][0] * Math.cos(0.25) - points[0][2] * Math.sin(0.25)) * project(points[0], initialCamera, viewport).scale);
  });

  it('銘牌由近到遠避讓，空間不足才收起較遠徽章，選中優先;回傳銘牌外框供連線標籤避開', () => {
    const colliding = new Map([
      ['far', { x: 180, y: 120, scale: 1, depth: 90 }],
      ['near', { x: 180, y: 120, scale: 1, depth: -90 }],
    ]);
    const shifted = placeLabels(colliding, 400, 1, null, new Map());
    expect(shifted).toMatchObject([{ id: 'near', zIndex: 2, labelOffset: 0 }, { id: 'far', zIndex: 1, badgeHidden: false }]);
    expect(shifted[1].labelOffset).not.toBe(0);
    expect(shifted[0].box).toMatchObject({ x: 180 });
    expect(shifted[0].box.y).toBeGreaterThan(120);

    const crowded = new Map([...colliding].map(([id, point]) => [id, { ...point, x: 60 }]));
    const kept = placeLabels(crowded, 120, 1, 'far', new Map());
    expect(kept).toMatchObject([{ id: 'far', zIndex: 2, badgeHidden: false }, { id: 'near', zIndex: 1, badgeHidden: true }]);
  });
});
