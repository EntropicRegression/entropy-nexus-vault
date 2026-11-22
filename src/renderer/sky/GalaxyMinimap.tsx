import { useRef } from 'react';
import type { KeyboardEvent, PointerEvent as ReactPointerEvent, RefObject } from 'react';
import type { GalaxyMap } from '../../shared/types';
import type { ScreenPoint, Viewport } from './galaxy-geometry';
import { keyPan, minimapSize, minimapTransform, viewBox } from './galaxy-world';
import type { Camera, WorldLayout } from './galaxy-world';
import styles from './Galaxy.module.css';

type EnabledMap = Extract<GalaxyMap, { enabled: true }>;

interface Props {
  layout: WorldLayout;
  map: EnabledMap;
  camera: Camera;
  viewport: Viewport;
  /** The view frame; the overview moves it directly during live camera changes. */
  rect: RefObject<SVGRectElement | null>;
  /** Per-group brightness while a colour filter is on (same rule as the overview). */
  brightness: ReadonlyMap<string, number> | null;
  onCenter: (point: ScreenPoint, animate: boolean) => void;
  onPan: (dx: number, dy: number) => void;
}

/**
 * Minimap (DESIGN.md §6.10.2 point 5; spec default until Hagemi's sketch): 180 × 110 at the lower right. Galaxies are
 * dots sized by members, the hub a gold dot, the current view a thin gold frame. Click to move there, drag to pan,
 * Tab to focus and arrow keys to move the view. Hidden while everything is already in view.
 */
export function GalaxyMinimap({ layout, map, camera, viewport, rect, brightness, onCenter, onPan }: Props) {
  const t = minimapTransform(layout.bounds);
  const press = useRef<number | null>(null);
  const box = viewBox(camera, viewport);
  const toWorld = (event: ReactPointerEvent<SVGSVGElement>) => {
    const area = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - area.left - t.x) / t.scale, y: (event.clientY - area.top - t.y) / t.scale };
  };
  function keys(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? keyPan.shift : keyPan.step;
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (!moves[event.key]) return;
    event.preventDefault();
    event.stopPropagation();
    onPan(moves[event.key][0], moves[event.key][1]);
  }
  return <div className={styles.minimap} data-minimap="" tabIndex={0} role="group"
    aria-label="小地圖:點擊或拖曳移動視野,方向鍵移動視野" onKeyDown={keys}>
    <svg width={minimapSize.width} height={minimapSize.height} viewBox={'0 0 ' + minimapSize.width + ' ' + minimapSize.height} aria-hidden="true"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        press.current = event.pointerId;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        onCenter(toWorld(event), true);
      }}
      onPointerMove={(event) => { if (press.current === event.pointerId) onCenter(toWorld(event), false); }}
      onPointerUp={() => { press.current = null; }} onPointerCancel={() => { press.current = null; }}>
      {map.groups.map((group) => {
        const placed = layout.groups.get(group.key);
        if (!placed) return null;
        return <circle key={group.key} data-minimap-group={group.key} cx={placed.center.x * t.scale + t.x} cy={placed.center.y * t.scale + t.y}
          r={Math.max(2, Math.min(5, 1.5 + group.members.length * 0.5))} className={group.kind === 'galaxy' ? styles.miniGalaxy : styles.miniNebula}
          opacity={brightness ? brightness.get(group.key) ?? 0.12 : 1} />;
      })}
      {map.hub.length > 0 && <circle cx={t.x} cy={t.y} r={3.5} className={styles.miniHub} data-minimap-hub="" />}
      <rect ref={rect} className={styles.miniView} data-minimap-view="" x={box.minX * t.scale + t.x} y={box.minY * t.scale + t.y}
        width={(box.maxX - box.minX) * t.scale} height={(box.maxY - box.minY) * t.scale} />
    </svg>
  </div>;
}
