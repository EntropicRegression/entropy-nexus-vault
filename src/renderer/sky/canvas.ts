import type { Viewport } from '../../shared/projection';

export function canvasSurface(canvas: HTMLCanvasElement, { width, height }: Viewport) {
  if (!width || !height) return null;
  const density = window.devicePixelRatio || 1;
  const pixelsWide = Math.round(width * density);
  const pixelsHigh = Math.round(height * density);
  if (canvas.width !== pixelsWide || canvas.height !== pixelsHigh) {
    canvas.width = pixelsWide;
    canvas.height = pixelsHigh;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(density, 0, 0, density, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return ctx;
}

export function observeSize(element: HTMLElement, change: () => void) {
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(change) : null;
  observer?.observe(element);
  window.addEventListener('resize', change);
  return () => {
    observer?.disconnect();
    window.removeEventListener('resize', change);
  };
}
