import { useEffect, useRef } from 'react';
import { canvasSurface, observeSize } from './canvas';
import { browserFrameClock, createAnimator } from './frame-clock';
import type { FrameClock } from './frame-clock';
import styles from './Sky.module.css';

function createStars() {
  let seed = 0x15431eb1;
  function random() {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  }
  return Array.from({ length: 130 }, () => ({
    x: random(), y: random(), radius: 0.4 + random() * 1.6,
    phase: random() * 2 * Math.PI, speed: 0.008 + random() * 0.02,
  }));
}
const stars = createStars();

export function StarField({ active, reduced, clock = browserFrameClock }: {
  active: boolean; reduced: boolean; clock?: FrameClock;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const elapsed = useRef(0);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !active) return;
    const start = clock.now() - elapsed.current;
    let viewport = { width: canvas.clientWidth, height: canvas.clientHeight };
    const animation = createAnimator(clock, (time) => {
      if (!reduced) elapsed.current = time - start;
      const ctx = canvasSurface(canvas, viewport);
      if (ctx) {
        for (const star of stars) {
          const alpha = 0.25 + 0.6 * (0.5 + 0.5 * Math.sin(star.phase + elapsed.current * star.speed * 0.06));
          ctx.fillStyle = 'rgba(196,225,255,' + alpha + ')';
          ctx.beginPath();
          ctx.arc(star.x * viewport.width, star.y * viewport.height, star.radius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (!reduced) animation.request();
    });
    animation.request();
    const disconnect = observeSize(canvas, () => {
      viewport = { width: canvas.clientWidth, height: canvas.clientHeight };
      animation.request();
    });
    return () => {
      animation.cancel();
      disconnect();
    };
  }, [active, reduced, clock]);
  return <canvas ref={ref} className={styles.starCanvas} data-star-field="" aria-hidden="true" />;
}
