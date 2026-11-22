import { useId, useLayoutEffect, useRef } from 'react';
import type { KeyboardEvent, PointerEvent as ReactPointerEvent, RefObject } from 'react';
import type { GalaxyMap } from '../../shared/types';
import type { GlowTier } from '../../shared/glow';
import type { ScreenPoint, Viewport } from './galaxy-geometry';
import { keyPan, minimapSize, minimapTransform, viewBox } from './galaxy-world';
import type { Camera, WorldLayout } from './galaxy-world';
import styles from './Galaxy.module.css';

type EnabledMap = Extract<GalaxyMap, { enabled: true }>;

/** Glow colours (same values as tokens.css); rainbow uses an inline SVG gradient, never an image URL. */
const tierColors: Record<Exclude<GlowTier, 'rainbow'>, string> = {
  white: '#e2e8f0', green: '#4ade80', blue: '#3b82f6', violet: '#c084fc', gold: '#f59e0b', red: '#f43f5e',
};

interface Props {
  layout: WorldLayout;
  map: EnabledMap;
  camera: Camera;
  viewport: Viewport;
  /** The view frame; the overview moves it directly during live camera changes. */
  rect: RefObject<SVGRectElement | null>;
  /** Per-group brightness while a colour filter is on (same rule as the overview). */
  brightness: ReadonlyMap<string, number> | null;
  /** Each group's strongest member glow (the dot colour). */
  tiers: ReadonlyMap<string, GlowTier>;
  onCenter: (point: ScreenPoint, animate: boolean) => void;
  onPan: (dx: number, dy: number) => void;
  onZoom: (factor: number) => void;
  onReset: () => void;
  /** Focus target when the minimap disappears while it holds focus (after ⌂ or zooming out until everything fits). */
  onFocusOut: () => void;
}

/** The cyan lining sits 1.5px inside the gold frame. */
export function liningOf(x: number, y: number, width: number, height: number) {
  return { x: x + 1.5, y: y + 1.5, width: Math.max(0, width - 3), height: Math.max(0, height - 3) };
}

function hexagon(x: number, y: number, r: number): string {
  return [[0, -r], [r * 0.86, -r * 0.5], [r * 0.86, r * 0.5], [0, r], [-r * 0.86, r * 0.5], [-r * 0.86, -r * 0.5]]
    .map(([dx, dy]) => (x + dx).toFixed(1) + ',' + (y + dy).toFixed(1)).join(' ');
}

/**
 * Minimap (DESIGN.md §6.10.2 point 5; Hagemi's sketch test/vault-demo/meeting/vault-minimap.html, M6d): 180 × 110 at
 * the lower right with 8px cut corners, a warm-gold frame and a thin cyan inner line, faint armillary rings, bridges
 * as hairline arcs, galaxies as tiny hexagons in their strongest glow colour, the hub as a gold star, and the view as
 * a bright gold frame with a pale cyan lining. 「星域圖」 and the zoom % sit at the top, − / ⌂ / + at the lower right.
 * Click to move there, drag to pan, Tab + arrow keys to move the view. Static: no transitions (low motion unaffected).
 */
export function GalaxyMinimap({ layout, map, camera, viewport, rect, brightness, tiers, onCenter, onPan, onZoom, onReset, onFocusOut }: Props) {
  const t = minimapTransform(layout.bounds);
  const container = useRef<HTMLDivElement>(null);
  const focusOut = useRef(onFocusOut);
  focusOut.current = onFocusOut;
  // Layout cleanup runs while the node is still in the document, so focus can be handed on before it is removed.
  useLayoutEffect(() => () => {
    if (container.current?.contains(document.activeElement)) focusOut.current();
  }, []);
  const press = useRef<number | null>(null);
  const gradient = useId().replace(/:/g, '');
  const box = viewBox(camera, viewport);
  const point = (x: number, y: number) => ({ x: x * t.scale + t.x, y: y * t.scale + t.y });
  const hub = point(0, 0);
  const rings = { x: layout.beltRadius.x * t.scale, y: layout.beltRadius.y * t.scale };
  const toWorld = (event: ReactPointerEvent<SVGSVGElement>) => {
    const area = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - area.left - t.x) / t.scale, y: (event.clientY - area.top - t.y) / t.scale };
  };
  function keys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    const step = event.shiftKey ? keyPan.shift : keyPan.step;
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (!moves[event.key]) return;
    event.preventDefault();
    event.stopPropagation();
    onPan(moves[event.key][0], moves[event.key][1]);
  }
  return <div ref={container} className={styles.minimap} data-minimap="" tabIndex={0} role="group"
    aria-label="小地圖星域圖:點擊或拖曳移動視野,方向鍵移動視野" onKeyDown={keys}>
    <svg width={minimapSize.width} height={minimapSize.height} viewBox={'0 0 ' + minimapSize.width + ' ' + minimapSize.height} aria-hidden="true"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        press.current = event.pointerId;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        onCenter(toWorld(event), true);
      }}
      onPointerMove={(event) => { if (press.current === event.pointerId) onCenter(toWorld(event), false); }}
      onPointerUp={() => { press.current = null; }} onPointerCancel={() => { press.current = null; }}>
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
          {['#f43f5e', '#f59e0b', '#4ade80', '#3b82f6', '#c084fc'].map((color, index) => <stop key={color} offset={index / 4} stopColor={color} />)}
        </linearGradient>
      </defs>
      <ellipse cx={hub.x} cy={hub.y} rx={rings.x} ry={rings.y} className={styles.miniRingOuter} data-minimap-ring="" />
      <ellipse cx={hub.x} cy={hub.y} rx={rings.x * 0.62} ry={rings.y * 0.62} className={styles.miniRingInner} />
      {map.bridges.map((bridge) => {
        const a = layout.groups.get(bridge.a), b = layout.groups.get(bridge.b);
        if (!a || !b) return null;
        const p = point(a.center.x, a.center.y), q = point(b.center.x, b.center.y);
        const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
        const c = { x: mx + (mx - hub.x) * 0.25, y: my + (my - hub.y) * 0.25 };
        return <path key={bridge.a + '|' + bridge.b} data-minimap-bridge="" className={styles.miniBridge}
          d={'M' + p.x.toFixed(1) + ' ' + p.y.toFixed(1) + ' Q' + c.x.toFixed(1) + ' ' + c.y.toFixed(1) + ' ' + q.x.toFixed(1) + ' ' + q.y.toFixed(1)} />;
      })}
      {map.groups.map((group) => {
        const placed = layout.groups.get(group.key);
        if (!placed) return null;
        const { x, y } = point(placed.center.x, placed.center.y);
        const r = Math.max(2.6, Math.min(4.2, 2.2 + group.members.length * 0.35));
        const tier = tiers.get(group.key) ?? 'white';
        const color = tier === 'rainbow' ? 'url(#' + gradient + ')' : tierColors[tier];
        const opacity = brightness ? brightness.get(group.key) ?? 0.12 : 1;
        return <g key={group.key} data-minimap-group={group.key} data-tier={tier} data-kind={group.kind} opacity={opacity}>
          {group.kind === 'galaxy' && <circle cx={x} cy={y} r={r * 2.1} fill={color} opacity={0.22} />}
          {group.kind === 'galaxy'
            ? <polygon points={hexagon(x, y, r)} fill={color} className={styles.miniGalaxy} />
            : <ellipse cx={x} cy={y} rx={r * 1.2} ry={r * 0.7} className={styles.miniNebula} />}
        </g>;
      })}
      {map.hub.length > 0 && <path data-minimap-hub="" className={styles.miniHub}
        d={'M' + hub.x + ' ' + (hub.y - 4.5) + ' L' + (hub.x + 1.3) + ' ' + (hub.y - 1.3) + ' L' + (hub.x + 4.5) + ' ' + hub.y + ' L' + (hub.x + 1.3) + ' ' + (hub.y + 1.3) +
          ' L' + hub.x + ' ' + (hub.y + 4.5) + ' L' + (hub.x - 1.3) + ' ' + (hub.y + 1.3) + ' L' + (hub.x - 4.5) + ' ' + hub.y + ' L' + (hub.x - 1.3) + ' ' + (hub.y - 1.3) + ' Z'} />}
      <rect ref={rect} className={styles.miniView} data-minimap-view="" x={box.minX * t.scale + t.x} y={box.minY * t.scale + t.y}
        width={(box.maxX - box.minX) * t.scale} height={(box.maxY - box.minY) * t.scale} />
      {/* Pale cyan lining just inside the gold frame (moved together with it, see minimapFrame). */}
      <rect className={styles.miniViewLining} data-minimap-lining="" {...liningOf(box.minX * t.scale + t.x, box.minY * t.scale + t.y,
        (box.maxX - box.minX) * t.scale, (box.maxY - box.minY) * t.scale)} />
    </svg>
    <div className={styles.miniHud} aria-hidden="true">
      <span className={styles.miniTitle}>星域圖</span>
      <span className={styles.miniZoom} data-minimap-zoom="">{Math.round(camera.zoom * 100)}%</span>
    </div>
    <div className={styles.miniControls}>
      <button type="button" data-minimap-zoom-out="" aria-label="縮小" title="縮小" onClick={() => onZoom(1 / 1.2)}>−</button>
      <button type="button" data-minimap-reset="" aria-label="回到全覽" title="回到全覽" onClick={onReset}>
        <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true"><path d="M1 5.2 5 1.4l4 3.8M2.4 4.2V9h5.2V4.2" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>
      </button>
      <button type="button" data-minimap-zoom-in="" aria-label="放大" title="放大" onClick={() => onZoom(1.2)}>+</button>
    </div>
  </div>;
}
