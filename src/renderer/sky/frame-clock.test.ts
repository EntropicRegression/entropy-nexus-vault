import { afterEach, expect, it, vi } from 'vitest';
import { browserFrameClock, createAnimator } from './frame-clock';

afterEach(() => vi.unstubAllGlobals());

it('沒有 rAF 時仍可連續推幀，也能取消備援排程', async () => {
  vi.stubGlobal('requestAnimationFrame', undefined);
  vi.stubGlobal('cancelAnimationFrame', undefined);
  const times: number[] = [];
  await new Promise<void>((resolve) => {
    const animator = createAnimator(browserFrameClock, (time) => {
      times.push(time);
      if (times.length === 1) animator.request();
      else resolve();
    });
    animator.request();
    animator.request();
  });
  expect(times).toHaveLength(2);
  expect(times[1]).toBeGreaterThan(times[0]);
  const draw = vi.fn();
  const cancelled = createAnimator(browserFrameClock, draw);
  cancelled.request();
  cancelled.cancel();
  await new Promise((resolve) => setTimeout(resolve, 32));
  expect(draw).not.toHaveBeenCalled();
});
