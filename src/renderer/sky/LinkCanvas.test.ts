import { afterEach, expect, it, vi } from 'vitest';
import { bundleLinks, drawLinks } from './LinkCanvas';
import type { LinkSegment } from './link-styles';

afterEach(() => vi.unstubAllGlobals());

it('同端點三種關係相距 5px，即使方向相反仍分束，標籤也不蓋在一起', () => {
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  const edges: LinkSegment[] = [
    { kind: 'lineage', from: 'a', to: 'b', label: '接回自' },
    { kind: 'delegate', from: 'b', to: 'a', label: '交辦 ×2' },
    { kind: 'meeting', from: 'a', to: 'b', label: '會議同席 ×3' },
  ];
  const points = new Map([
    ['a', { x: 40, y: 100, scale: 1, depth: 0 }],
    ['b', { x: 360, y: 100, scale: 1, depth: 10 }],
  ]);
  const visible = new Set(edges.map((edge) => edge.kind));
  const bundle = bundleLinks(points, edges, visible);
  expect(bundle.map(({ start, end }) => [start.y, end.y])).toEqual([[95, 95], [100, 100], [105, 105]]);
  const fillText = vi.fn();
  const ctx = {
    setTransform: vi.fn(), clearRect: vi.fn(), setLineDash: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(),
    lineTo: vi.fn(), stroke: vi.fn(), strokeText: vi.fn(), fillText, measureText: (text: string) => ({ width: text.length * 7 }),
  };
  const canvas = { width: 400, height: 200, getContext: () => ctx } as unknown as HTMLCanvasElement;
  drawLinks(canvas, { width: 400, height: 200 }, points, edges, visible, null);
  expect(ctx.setLineDash.mock.calls).toEqual([[[]], [[7, 5]], [[3, 5]], [[]]]);
  expect(fillText).toHaveBeenCalledTimes(3);
  expect(ctx.strokeText.mock.calls).toEqual(fillText.mock.calls);
  const labels = fillText.mock.calls as [string, number, number][];
  for (const [[text, x, y], index] of labels.map((label, index) => [label, index] as const)) {
    expect(Math.abs(x - 200) > 34 + text.length * 3.5 || Math.abs(y - 104) > 34).toBe(true);
    for (const [otherText, otherX, otherY] of labels.slice(index + 1)) {
      expect(Math.abs(x - otherX) >= (text.length + otherText.length) * 3.5 ||
        Math.abs(y - otherY) >= 14).toBe(true);
    }
  }
});
