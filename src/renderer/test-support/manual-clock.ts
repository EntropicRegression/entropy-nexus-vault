import type { FrameClock } from '../sky/frame-clock';

/** A frame clock that only advances when a test says so. */
export function manualClock() {
  let time = 0, next = 0;
  const tasks = new Map<number, () => void>();
  const clock: FrameClock = {
    now: () => time,
    schedule: (draw) => { tasks.set(++next, draw); return next; },
    cancel: (id) => { tasks.delete(id); },
  };
  return {
    clock,
    count: () => tasks.size,
    now: () => time,
    /** Sets the time and runs the frames that were pending. */
    tick(ms: number) {
      time = ms;
      const frame = [...tasks.values()];
      tasks.clear();
      for (const draw of frame) draw();
    },
  };
}
