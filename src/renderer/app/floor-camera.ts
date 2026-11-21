import { createAnimator } from '../sky/frame-clock';
import type { FrameClock } from '../sky/frame-clock';

export type Floor = 'library' | 'sky';

/** DESIGN.md §8. */
export const floorTiming = { duration: 980, swapAt: 0.45, maxBlur: 14, maxTilt: 2.4, quietFade: 120 } as const;
const libraryParallax = 35;
const starParallax = 24;

export interface FloorFrame {
  /** World offset: 0 shows the sky (upper half), 1 shows the library (lower half). */
  offset: number;
  tiltDeg: number;
  blurY: number;
  libraryShiftPx: number;
  starShiftPx: number;
  swapped: boolean;
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Every value of a transition frame, computed only from progress t (0–1) and the destination. */
export function floorFrame(t: number, to: Floor): FloorFrame {
  const progress = Math.min(1, Math.max(0, t));
  const from = to === 'sky' ? 1 : 0;
  const target = to === 'sky' ? 0 : 1;
  const offset = from + (target - from) * easeInOutCubic(progress);
  const velocity = progress <= 0 || progress >= 1 ? 0 : Math.sin(Math.PI * progress);
  return {
    offset,
    tiltDeg: (to === 'sky' ? floorTiming.maxTilt : -floorTiming.maxTilt) * velocity,
    blurY: floorTiming.maxBlur * velocity,
    // The library background trails the camera; the star field moves the other way at a different speed.
    libraryShiftPx: (1 - offset) * libraryParallax,
    starShiftPx: -offset * starParallax,
    swapped: progress >= floorTiming.swapAt,
  };
}

export function restingFrame(floor: Floor): FloorFrame {
  return { ...floorFrame(1, floor), blurY: 0, tiltDeg: 0, libraryShiftPx: 0, starShiftPx: 0, swapped: true };
}

export interface FloorElements {
  world: HTMLElement | null;
  blur: SVGFEGaussianBlurElement | null;
  libraryBackground: HTMLElement | null;
  stars: HTMLElement | null;
}

/** Writes one frame to the DOM. A resting frame removes the filter entirely so text stays sharp. */
export function applyFloorFrame(elements: FloorElements, frame: FloorFrame, filterId: string) {
  const { world, blur, libraryBackground, stars } = elements;
  if (world) {
    world.style.transform = frame.tiltDeg
      ? 'translateY(' + (-50 * frame.offset) + '%) rotateX(' + frame.tiltDeg.toFixed(3) + 'deg)'
      : 'translateY(' + (-50 * frame.offset) + '%)';
    world.style.filter = frame.blurY > 0 ? 'url(#' + filterId + ')' : '';
  }
  blur?.setAttribute('stdDeviation', '0 ' + frame.blurY.toFixed(2));
  if (libraryBackground) libraryBackground.style.transform = frame.libraryShiftPx ? 'translateY(' + frame.libraryShiftPx.toFixed(1) + 'px)' : '';
  if (stars) stars.style.transform = frame.starShiftPx ? 'translateY(' + frame.starShiftPx.toFixed(1) + 'px)' : '';
}

export interface FloorCameraOptions {
  clock: FrameClock;
  elements: () => FloorElements;
  filterId: string;
  onSwap: (to: Floor) => void;
  onFinish: (to: Floor, quiet: boolean) => void;
}

/**
 * Drives a floor transition. Starting while another transition runs jumps straight to the requested floor's
 * resting state (never a half-way frame). The quiet path (reduced motion) skips the camera entirely.
 */
export function createFloorCamera({ clock, elements, filterId, onSwap, onFinish }: FloorCameraOptions) {
  let running: { to: Floor; start: number; swapped: boolean } | null = null;
  let resting: Floor | null = null;
  const animator = createAnimator(clock, (now) => {
    if (!running) return;
    const t = (now - running.start) / floorTiming.duration;
    const frame = floorFrame(t, running.to);
    applyFloorFrame(elements(), frame, filterId);
    if (frame.swapped && !running.swapped) {
      running.swapped = true;
      onSwap(running.to);
    }
    if (t >= 1) finish(running.to, false);
    else animator.request();
  });

  function finish(to: Floor, quiet: boolean) {
    animator.cancel();
    const wasSwapped = running?.swapped ?? false;
    running = null;
    resting = to;
    applyFloorFrame(elements(), restingFrame(to), filterId);
    if (!wasSwapped) onSwap(to);
    onFinish(to, quiet);
  }

  return {
    get running() { return running !== null; },
    start(to: Floor, quiet: boolean) {
      if (running || quiet || resting === to) {
        finish(to, quiet);
        return;
      }
      running = { to, start: clock.now(), swapped: false };
      resting = null;
      animator.request();
    },
    /** Places the world at a floor without any transition (first render, vault change). */
    rest(floor: Floor) {
      animator.cancel();
      running = null;
      resting = floor;
      applyFloorFrame(elements(), restingFrame(floor), filterId);
    },
    cancel() {
      animator.cancel();
      running = null;
    },
  };
}
