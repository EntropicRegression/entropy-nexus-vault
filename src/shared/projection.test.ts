import { describe, expect, it } from 'vitest';
import { hashNodeId, initialPoint, minimumScreenGap, placeNew } from './crystal-layout';
import { crystalStyle, initialCamera, project, rotateCamera, zoomCamera } from './projection';

describe('星圖座標與投影', () => {
  const ids = ['fixture-sky-iris', 'fixture-sky-quill', 'fixture-sky-flint', 'fixture-sky-dawn'];
  const separation = (a: readonly number[], b: readonly number[]) => Math.hypot(...a.map((value, i) => value - b[i]));
  it('以 FNV-1a UTF-8 計算，重排或重複輸入不會改變水晶或座標', () => {
    expect(hashNodeId('hello')).toBe(0x4f9f2cab);
    const layout = placeNew(new Map(), ids);
    expect(placeNew(new Map(), [...ids].reverse().concat(ids))).toEqual(layout);
    expect(layout.size).toBe(4);
  });

  it('合成 Iris 與 Dawn 原相距不足 90，較前的節點會在第一層另找位置', () => {
    const iris = ids[0], dawn = ids[3];
    const fixed = placeNew(new Map(), [iris]);
    const original = fixed.get(iris)!;
    const added = placeNew(fixed, [dawn, iris]);
    expect(dawn < iris).toBe(true);
    expect(separation(original, initialPoint(dawn, 220))).toBeLessThan(90);
    expect([...added.keys()]).toEqual([dawn]);
    const [x, y, z] = added.get(dawn)!;
    expect(Math.hypot(x, y / 0.6, z)).toBeCloseTo(220);
    expect(separation([x, y, z], original)).toBeGreaterThanOrEqual(90);
    expect(fixed.get(iris)).toEqual(initialPoint(iris, 220));
    expect(minimumScreenGap([original, [x, y, z]])).toBeGreaterThanOrEqual(110);
  });

  it('新節點在預設相機下與既有水晶的畫面間距至少 110px;既有座標不受影響', () => {
    // Iris and Dawn used to be ~90 apart in 3D but stacked almost exactly on screen at the default camera.
    const iris = ids[0];
    const crowded = new Map([[iris, initialPoint(iris, 220)], ['older', [-172.94, -25.82, 129.0] as const]]);
    expect(minimumScreenGap([...crowded.values()])).toBeLessThan(110);
    const added = placeNew(crowded, ['fixture-sky-new']);
    expect([...added.keys()]).toEqual(['fixture-sky-new']);
    for (const point of crowded.values()) expect(minimumScreenGap([point, added.get('fixture-sky-new')!])).toBeGreaterThanOrEqual(110);
    expect(minimumScreenGap([...placeNew(new Map(), ids).values()])).toBeGreaterThanOrEqual(110);
    const twelve = Array.from({ length: 12 }, (_, i) => 'synthetic-' + i);
    expect(minimumScreenGap([...placeNew(new Map(), twelve).values()])).toBeGreaterThanOrEqual(110);
  });

  it('30 顆水晶的點對間距全部至少 55，多數至少 90', () => {
    const ids = Array.from({ length: 30 }, (_, index) => 'synthetic-node-' + String(index).padStart(2, '0'));
    const layout = [...placeNew(new Map(), ids).values()];
    const gaps = layout.flatMap((point, i) => layout.slice(i + 1).map((next) => separation(point, next)));
    expect(gaps).toHaveLength(435);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(55);
    expect(gaps.filter((gap) => gap >= 90).length).toBeGreaterThan(gaps.length / 2);
  });

  it('同一門檻先試外層才降低間距，最後退回最近鄰距離最大的點', () => {
    const id = 'crowded';
    const fixed = new Map([['older', initialPoint(id, 220)]]);
    const test = (radii: number[], minGap: number[]) =>
      placeNew(fixed, [id], { radii, minGap, minScreenGap: minGap.map(() => 0), candidates: 0 }).get(id);
    expect(test([220, 280, 340], [90, 55])).toEqual(initialPoint(id, 340));
    expect(test([220, 280, 340], [400, 55])).toEqual(initialPoint(id, 280));
    expect(test([220, 280, 340], [400, 399])).toEqual(initialPoint(id, 340));
  });

  it('與 v9 原型的 project3D 逐值一致(期望值由 v9 原始碼獨立計算)', () => {
    // Verbatim port of project3D from docs/設計稿/v9/index.html (camYaw/camPitch/camZoom globals turned into arguments).
    function v9Project3D(pos: readonly number[], w: number, h: number, camYaw: number, camPitch: number, camZoom: number) {
      const [x0, y0, z0] = pos;
      const cy = Math.cos(camYaw), sy = Math.sin(camYaw);
      const cp = Math.cos(camPitch), sp = Math.sin(camPitch);
      const x1 = x0 * cy - z0 * sy;
      const z1 = x0 * sy + z0 * cy;
      const y2 = y0 * cp - z1 * sp;
      const z2 = y0 * sp + z1 * cp;
      const fov = 620 * camZoom;
      const dist = 560;
      const scale = fov / Math.max(140, dist + z2);
      return { sx: w * 0.5 + x1 * scale, sy: h * 0.52 + y2 * scale, scale, z: z2 };
    }
    const cases: [number[], number, number, number, number, number][] = [
      [[-130, -55, 85], 940, 670, 0.25, 0.14, 1],
      [[155, -70, 50], 1600, 900, -1.2, 0.95, 1.65],
      [[95, 110, -120], 764, 652, 3.1, -0.95, 0.65],
      [[0, 0, -500], 800, 600, 0, 0, 1],
    ];
    for (const [pos, w, h, yaw, pitch, zoom] of cases) {
      const reference = v9Project3D(pos, w, h, yaw, pitch, zoom);
      const actual = project(pos as [number, number, number], { yaw, pitch, zoom }, { width: w, height: h });
      expect(actual.x).toBeCloseTo(reference.sx, 10);
      expect(actual.y).toBeCloseTo(reference.sy, 10);
      expect(actual.scale).toBeCloseTo(reference.scale, 10);
      expect(actual.depth).toBeCloseTo(reference.z, 10);
    }
  });

  it('固定座標與相機對應 v9 投影數值；深度控制放大率、排序與透明度', () => {
    const projected = project([120, -30, 90], { ...initialCamera, zoom: 1.15 }, { width: 800, height: 600 });
    expect(projected.x).toBeCloseTo(499.8036969149, 9);
    expect(projected.y).toBeCloseTo(263.1426683872, 9);
    expect(projected.depth).toBeCloseTo(111.5606416199, 9);
    expect(crystalStyle(projected)).toMatchObject({ left: projected.x, top: projected.y, zIndex: 388 });
    expect(crystalStyle({ x: 0, y: 0, scale: 5, depth: -500 })).toMatchObject({ scale: 1.28, opacity: 1 });
    expect(crystalStyle({ x: 0, y: 0, scale: 0.1, depth: 900 })).toMatchObject({ scale: 0.62, opacity: 0.45 });
  });

  it('相機旋轉和縮放沿用靈敏度與限制', () => {
    expect(rotateCamera(initialCamera, 100, 1000).yaw).toBeCloseTo(0.95);
    expect(rotateCamera(initialCamera, 100, 1000).pitch).toBe(0.95);
    expect(rotateCamera(initialCamera, 0, -1000).pitch).toBe(-0.95);
    expect(zoomCamera(initialCamera, -20000).zoom).toBe(1.65);
    expect(zoomCamera(initialCamera, 20000).zoom).toBe(0.65);
  });
});
