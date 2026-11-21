import { describe, expect, it } from 'vitest';
import { crystalStyle } from '../../shared/projection';
import { fitViewport, placeLabels } from './screen-layout';

describe('星圖可視區及水晶銘牌', () => {
  const positions = new Map([
    ['left', { x: -120, y: 20, scale: 1.2, depth: -150 }],
    ['right', { x: 810, y: 612, scale: 1.1, depth: 50 }],
  ]);
  const viewport = { width: 764, height: 652 };

  it('開欄時縮放與平移讓兩端的水晶完整進場，關欄重新使用原始投影', () => {
    const fitted = fitViewport(positions, viewport, true);
    expect(fitted.factor).toBeLessThan(1);
    expect(fitted.positions.get('left')?.x).toBeGreaterThan(0);
    expect(fitted.positions.get('right')?.x).toBeLessThan(viewport.width);
    for (const point of fitted.positions.values()) {
      const scale = crystalStyle(point).scale * fitted.factor;
      expect(point.x - 78 * scale).toBeGreaterThanOrEqual(7.9);
      expect(point.x + 78 * scale).toBeLessThanOrEqual(756.1);
      expect(point.y - 116 * scale).toBeGreaterThanOrEqual(91.9);
      expect(point.y + 116 * scale).toBeLessThanOrEqual(644.1);
    }
    expect(fitViewport(positions, viewport, false)).toMatchObject({ positions, factor: 1, dx: 0, dy: 0 });
  });

  it('銘牌由近到遠避讓，空間不足才收起較遠徽章，選中優先', () => {
    const colliding = new Map([
      ['far', { x: 180, y: 120, scale: 1, depth: 90 }],
      ['near', { x: 180, y: 120, scale: 1, depth: -90 }],
    ]);
    const shifted = placeLabels(colliding, 400, 1, null, new Map());
    expect(shifted).toMatchObject([{ id: 'near', zIndex: 2, labelOffset: 0 }, { id: 'far', zIndex: 1, badgeHidden: false }]);
    expect(shifted[1].labelOffset).not.toBe(0);

    const crowded = new Map([...colliding].map(([id, point]) => [id, { ...point, x: 60 }]));
    const kept = placeLabels(crowded, 120, 1, 'far', new Map());
    expect(kept).toMatchObject([{ id: 'far', zIndex: 2, badgeHidden: false }, { id: 'near', zIndex: 1, badgeHidden: true }]);
  });
});
