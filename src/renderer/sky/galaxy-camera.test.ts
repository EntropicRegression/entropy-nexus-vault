import { describe, expect, it, vi } from 'vitest';
import { manualClock } from '../test-support/manual-clock';
import { createFlyController, easeOutCubic, flyFrame, flyTiming } from './galaxy-camera';

describe('飛入/返回曲線', () => {
  it.each([
    [0, 0, 1, 1, 0.94, 0],
    [0.25, easeOutCubic(0.25), 1 + 0.6 * easeOutCubic(0.25), 1 - easeOutCubic(0.25), 0.94 + 0.06 * easeOutCubic(0.25), easeOutCubic(0.25)],
    [0.5, 0.875, 1.525, 0.125, 0.9925, 0.875],
    [1, 1, 1.6, 0, 1, 1],
  ])('飛入 t=%s', (t, progress, overviewScale, overviewOpacity, interiorScale, interiorOpacity) => {
    const frame = flyFrame(t, 'in');
    expect(frame.progress).toBeCloseTo(progress);
    expect(frame.overviewScale).toBeCloseTo(overviewScale);
    expect(frame.overviewOpacity).toBeCloseTo(overviewOpacity);
    expect(frame.interiorScale).toBeCloseTo(interiorScale);
    expect(frame.interiorOpacity).toBeCloseTo(interiorOpacity);
  });

  it('返回是反向;低動態只淡入淡出不縮放;t 超出範圍被夾住', () => {
    expect(flyFrame(0.3, 'out').progress).toBeCloseTo(1 - flyFrame(0.3, 'in').progress);
    const quiet = flyFrame(0.5, 'in', true);
    expect(quiet).toEqual({ progress: 0.5, overviewScale: 1, overviewOpacity: 0.5, interiorScale: 1, interiorOpacity: 0.5 });
    expect(flyFrame(-2, 'in')).toEqual(flyFrame(0, 'in'));
    expect(flyFrame(9, 'out')).toEqual(flyFrame(1, 'out'));
  });
});

describe('飛行控制器', () => {
  function setup() {
    const manual = manualClock();
    const frames: number[] = [];
    const onFinish = vi.fn();
    const fly = createFlyController({ clock: manual.clock, apply: (frame) => frames.push(frame.progress), onFinish });
    return { manual, frames, onFinish, fly };
  }

  it('550ms 逐幀前進,結束時落在終態並通知一次', () => {
    const { manual, frames, onFinish, fly } = setup();
    fly.start('in', false);
    manual.tick(flyTiming.duration / 2);
    expect(frames.at(-1)).toBeCloseTo(0.875);
    expect(onFinish).not.toHaveBeenCalled();
    manual.tick(flyTiming.duration);
    expect(frames.at(-1)).toBe(1);
    expect(onFinish).toHaveBeenCalledExactlyOnceWith('in');
    expect(manual.count()).toBe(0);
    expect(fly.running).toBe(false);
  });

  it('飛行中再按:直接落到新方向的終態,不留排程', () => {
    const { manual, frames, onFinish, fly } = setup();
    fly.start('in', false);
    manual.tick(100);
    fly.start('out', false);
    expect(frames.at(-1)).toBe(0);
    expect(onFinish).toHaveBeenCalledExactlyOnceWith('out');
    expect(manual.count()).toBe(0);
  });

  it('低動態 150ms 淡換', () => {
    const { manual, frames, onFinish, fly } = setup();
    fly.start('in', true);
    manual.tick(75);
    expect(frames.at(-1)).toBeCloseTo(0.5);
    manual.tick(flyTiming.quiet);
    expect(onFinish).toHaveBeenCalledExactlyOnceWith('in');
  });
});
