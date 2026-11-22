/**
 * Flying into and out of a galaxy (DESIGN.md §6.10): about 550ms, the overview zooms toward the galaxy and fades
 * while the interior fades and settles in; low motion is a 150ms crossfade. Values come from pure functions of t;
 * the controller takes an injectable clock (same approach as the floor camera, src/renderer/app/floor-camera.ts).
 */
import { createAnimator } from './frame-clock';
import type { FrameClock } from './frame-clock';

export const flyTiming = { duration: 550, quiet: 150, zoom: 1.6, interiorFrom: 0.94 } as const;

export type FlyDirection = 'in' | 'out';

export interface FlyFrame {
  /** 0 = overview fully shown, 1 = interior fully shown. */
  progress: number;
  overviewScale: number;
  overviewOpacity: number;
  interiorScale: number;
  interiorOpacity: number;
}

/** ease-out cubic, close to the visual base's cubic-bezier(0.22, 1, 0.36, 1). */
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** The frame at progress t (0–1) of a fly in or out; quiet frames only crossfade. */
export function flyFrame(t: number, direction: FlyDirection, quiet = false): FlyFrame {
  const clamped = Math.min(1, Math.max(0, t));
  const eased = quiet ? clamped : easeOutCubic(clamped);
  const progress = direction === 'in' ? eased : 1 - eased;
  return {
    progress,
    overviewScale: quiet ? 1 : 1 + (flyTiming.zoom - 1) * progress,
    overviewOpacity: 1 - progress,
    interiorScale: quiet ? 1 : flyTiming.interiorFrom + (1 - flyTiming.interiorFrom) * progress,
    interiorOpacity: progress,
  };
}

export function restFrame(direction: FlyDirection): FlyFrame {
  return flyFrame(1, direction);
}

export interface FlyControllerOptions {
  clock: FrameClock;
  apply: (frame: FlyFrame) => void;
  onFinish: (direction: FlyDirection) => void;
}

/**
 * Starting while a fly runs lands the requested direction's resting frame at once (no half-way state), like the
 * floor camera; quiet flies are short crossfades.
 */
export function createFlyController({ clock, apply, onFinish }: FlyControllerOptions) {
  let running: { direction: FlyDirection; start: number; quiet: boolean } | null = null;
  const animator = createAnimator(clock, (now) => {
    if (!running) return;
    const t = (now - running.start) / (running.quiet ? flyTiming.quiet : flyTiming.duration);
    apply(flyFrame(t, running.direction, running.quiet));
    if (t >= 1) finish(running.direction);
    else animator.request();
  });

  function finish(direction: FlyDirection) {
    animator.cancel();
    running = null;
    apply(restFrame(direction));
    onFinish(direction);
  }

  return {
    get running() { return running !== null; },
    start(direction: FlyDirection, quiet: boolean) {
      if (running) {
        finish(direction);
        return;
      }
      running = { direction, start: clock.now(), quiet };
      apply(flyFrame(0, direction, quiet));
      animator.request();
    },
    rest(direction: FlyDirection) {
      animator.cancel();
      running = null;
      apply(restFrame(direction));
    },
    cancel() {
      animator.cancel();
      running = null;
    },
  };
}
