export interface FrameClock {
  now(): number;
  schedule(callback: () => void): number;
  cancel(handle: number): void;
}

const timers = new Map<number, ReturnType<typeof setTimeout>>();
let timerId = 0;

export const browserFrameClock: FrameClock = {
  now: () => performance.now(),
  schedule(callback) {
    if (typeof requestAnimationFrame === 'function' && typeof cancelAnimationFrame === 'function') {
      return requestAnimationFrame(callback);
    }
    const id = --timerId;
    const timer = setTimeout(() => { timers.delete(id); callback(); }, 16);
    timers.set(id, timer);
    return id;
  },
  cancel(handle) {
    if (handle < 0) {
      clearTimeout(timers.get(handle));
      timers.delete(handle);
    } else if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle);
  },
};

export function createAnimator(clock: FrameClock, draw: (time: number) => void) {
  let pending: number | undefined;
  return {
    request() {
      if (pending !== undefined) return;
      pending = clock.schedule(() => {
        pending = undefined;
        draw(clock.now());
      });
    },
    cancel() {
      if (pending === undefined) return;
      clock.cancel(pending);
      pending = undefined;
    },
  };
}
