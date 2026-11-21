import { afterEach, expect, it, vi } from 'vitest';
import { bundleLinks, drawLinks, trimToBody } from './LinkCanvas';
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

it('連線標籤避開水晶銘牌:預設位置被銘牌佔住時改放別處,絕不畫在銘牌框內', () => {
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  const edges: LinkSegment[] = [{ kind: 'meeting', from: 'a', to: 'b', label: '會議同席 ×3' }];
  const points = new Map([
    ['a', { x: 60, y: 120, scale: 1, depth: 0 }],
    ['b', { x: 540, y: 120, scale: 1, depth: 0 }],
  ]);
  const fillText = vi.fn();
  const ctx = {
    setTransform: vi.fn(), clearRect: vi.fn(), setLineDash: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(),
    lineTo: vi.fn(), stroke: vi.fn(), strokeText: vi.fn(), fillText, measureText: (text: string) => ({ width: text.length * 7 }),
  };
  const canvas = { width: 600, height: 300, getContext: () => ctx } as unknown as HTMLCanvasElement;
  const visible = new Set(['meeting' as const]);
  const core = { x: 300, y: 260 };
  drawLinks(canvas, { width: 600, height: 300 }, points, edges, visible, null, core);
  const [, freeX, freeY] = fillText.mock.calls[0] as [string, number, number];
  expect([freeX, freeY]).toEqual([300, 113]);

  fillText.mockClear();
  const plate = { x: 300, y: 112, width: 120, height: 48 };
  drawLinks(canvas, { width: 600, height: 300 }, points, edges, visible, null, core, [plate]);
  expect(fillText).toHaveBeenCalledTimes(1);
  const [text, x, y] = fillText.mock.calls[0] as [string, number, number];
  const half = text.length * 3.5 + 4;
  const overlaps = Math.abs(plate.x - x) < plate.width / 2 + half && Math.abs(plate.y - (y - 4)) < plate.height / 2 + 6;
  expect(overlaps).toBe(false);
});

it('密集模式:沒有選取時不畫連線標籤,選取後只畫相關連線的標籤', () => {
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  const edges: LinkSegment[] = [
    { kind: 'meeting', from: 'a', to: 'b', label: '會議同席 ×3' },
    { kind: 'delegate', from: 'b', to: 'c', label: '交辦 ×1' },
  ];
  const points = new Map([
    ['a', { x: 60, y: 60, scale: 1, depth: 0 }],
    ['b', { x: 300, y: 200, scale: 1, depth: 0 }],
    ['c', { x: 540, y: 60, scale: 1, depth: 0 }],
  ]);
  const fillText = vi.fn();
  const ctx = {
    setTransform: vi.fn(), clearRect: vi.fn(), setLineDash: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(),
    lineTo: vi.fn(), stroke: vi.fn(), strokeText: vi.fn(), fillText, measureText: (text: string) => ({ width: text.length * 7 }),
  };
  const canvas = { width: 600, height: 300, getContext: () => ctx } as unknown as HTMLCanvasElement;
  const visible = new Set(['meeting', 'delegate'] as const);
  drawLinks(canvas, { width: 600, height: 300 }, points, edges, visible, null, undefined, [], true);
  expect(fillText).not.toHaveBeenCalled();
  expect(ctx.stroke).toHaveBeenCalledTimes(2);
  drawLinks(canvas, { width: 600, height: 300 }, points, edges, visible, 'a', undefined, [], true);
  expect(fillText.mock.calls.map(([text]) => text)).toEqual(['會議同席 ×3']);
});

it('金級留空:傳承線停在六角本體外 5px;沒碰到本體或長度為 0 時不變', () => {
  // Hexagon 96×136 centred at (100, 100): bottom tip at y = 168, right edge at x = 100 + 0.42 × 96 ≈ 140.3.
  const body = { cx: 100, cy: 100, width: 96, height: 136, gap: 5 };
  expect(trimToBody({ x: 100, y: 300 }, { x: 100, y: 100 }, body)).toEqual({ x: 100, y: 173 });
  const side = trimToBody({ x: 300, y: 100 }, { x: 100, y: 100 }, body);
  expect(side.x).toBeCloseTo(100 + 0.42 * 96 + 5);
  expect(side.y).toBe(100);
  expect(trimToBody({ x: 300, y: 300 }, { x: 320, y: 320 }, body)).toEqual({ x: 320, y: 320 });
  expect(trimToBody({ x: 100, y: 100 }, { x: 100, y: 100 }, body)).toEqual({ x: 100, y: 100 });
});

it('drawLinks 只對有本體的端點裁切傳承線,其他關係不裁', () => {
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  const calls: [string, number, number][] = [];
  const ctx = {
    globalAlpha: 1, strokeStyle: '', fillStyle: '', font: '', textAlign: '', lineWidth: 0, lineJoin: '',
    setTransform() {}, clearRect() {}, beginPath() {}, setLineDash() {}, stroke() {}, fillText() {}, strokeText() {},
    measureText: (text: string) => ({ width: 7 * text.length }),
    moveTo: (x: number, y: number) => calls.push(['move', x, y]), lineTo: (x: number, y: number) => calls.push(['line', x, y]),
  };
  const canvas = { width: 0, height: 0, style: {}, getContext: () => ctx } as unknown as HTMLCanvasElement;
  const at = (x: number, y: number) => ({ x, y, scale: 1, depth: 0 });
  drawLinks(canvas, { width: 600, height: 600 }, new Map([['a', at(100, 500)], ['g', at(100, 100)]]),
    [{ kind: 'lineage', from: 'a', to: 'g', label: '接回自' }], new Set(['lineage']), null, undefined, [], false,
    new Map([['g', { cx: 100, cy: 100, width: 96, height: 136, gap: 5 }]]));
  expect(calls).toEqual([['move', 100, 500], ['line', 100, 173]]);
});
