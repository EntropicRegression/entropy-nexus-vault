import { browserFrameClock } from '../sky/frame-clock';
import type { FrameClock } from '../sky/frame-clock';

/**
 * Development-mode builds only (main.tsx): a frame clock that window acceptance can freeze at a chosen time, so a
 * floor transition can be captured at a given progress. Frames keep being scheduled while frozen.
 */
export function createAcceptanceClock() {
  let offset = 0;
  let frozen: number | null = null;
  const now = () => frozen ?? performance.now() + offset;
  const clock: FrameClock = { now, schedule: browserFrameClock.schedule, cancel: browserFrameClock.cancel };
  const control = {
    pause() { frozen = now(); return frozen; },
    set(ms: number) { frozen = ms; },
    resume() {
      if (frozen === null) return;
      offset = frozen - performance.now();
      frozen = null;
    },
  };
  return { clock, control };
}
