export type Point3 = readonly [x: number, y: number, z: number];

export interface Camera { yaw: number; pitch: number; zoom: number }
export interface Viewport { width: number; height: number }
export interface Projection { x: number; y: number; scale: number; depth: number }

export const initialCamera: Camera = { yaw: 0.25, pitch: 0.14, zoom: 1 };
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

export function project([x, y, z]: Point3, camera: Camera, viewport: Viewport): Projection {
  const cy = Math.cos(camera.yaw), sy = Math.sin(camera.yaw);
  const cp = Math.cos(camera.pitch), sp = Math.sin(camera.pitch);
  const x1 = x * cy - z * sy;
  const z1 = x * sy + z * cy;
  const y2 = y * cp - z1 * sp;
  const depth = y * sp + z1 * cp;
  const scale = 620 * camera.zoom / Math.max(140, 560 + depth);

  return { x: viewport.width / 2 + x1 * scale, y: viewport.height * 0.52 + y2 * scale, scale, depth };
}

export function crystalStyle({ x, y, scale, depth }: Projection) {
  return {
    left: x, top: y, scale: clamp(scale * 0.92, 0.62, 1.28),
    zIndex: Math.round(500 - depth), opacity: clamp(1.05 - (depth + 180) / 720, 0.45, 1),
  };
}

export function rotateCamera(camera: Camera, dx: number, dy: number): Camera {
  return { ...camera, yaw: camera.yaw + dx * 0.007, pitch: clamp(camera.pitch + dy * 0.007, -0.95, 0.95) };
}

export function zoomCamera(camera: Camera, distance: number): Camera {
  return { ...camera, zoom: clamp(camera.zoom - distance * 0.0008, 0.65, 1.65) };
}
