import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import { crystalStyle, project } from '../../shared/projection';
import type { Camera, Point3, Projection, Viewport } from '../../shared/projection';
import { observeSize } from './canvas';
import { createAnimator } from './frame-clock';
import type { FrameClock } from './frame-clock';
import { drawLinks } from './LinkCanvas';
import type { LinkKind, LinkSegment } from './link-styles';
import { autoZoom, boundingRadius, densityScale, fitViewport, placeLabels, sphereExtent } from './screen-layout';

interface Options {
  active: boolean;
  stage: RefObject<HTMLDivElement | null>;
  armillary: RefObject<HTMLDivElement | null>;
  canvas: RefObject<HTMLCanvasElement | null>;
  nodes: RefObject<Map<string, HTMLDivElement>>;
  camera: RefObject<Camera>;
  /** True once the user has rotated or zoomed; auto-fit then stops overriding the camera until a reset. */
  adjusted: RefObject<boolean>;
  positions: ReadonlyMap<string, Point3>;
  connections: LinkSegment[];
  visible: ReadonlySet<LinkKind>;
  selected: string | null;
  clock: FrameClock;
}

interface Measurements { viewport: Viewport; panelWidth: number; labels: Map<string, number> }

/** One batch of layout reads. Badges hidden for crowding are restored first so widths stay natural. */
export function measure(element: HTMLElement, anchors: ReadonlyMap<string, HTMLElement>): Measurements {
  for (const anchor of anchors.values()) anchor.removeAttribute('data-crowded-label');
  const viewport = { width: element.clientWidth, height: element.clientHeight };
  const panelWidth = element.parentElement?.querySelector<HTMLElement>('[data-sky-detail]')?.offsetWidth ?? 0;
  const labels = new Map<string, number>();
  for (const [id, anchor] of anchors) {
    const width = anchor.querySelector<HTMLElement>('[data-crystal-label]')?.offsetWidth;
    if (width) labels.set(id, width);
  }
  return { viewport, panelWidth, labels };
}

export function useStarMapFrame(options: Options): () => void {
  const { active, stage, armillary, canvas, nodes, camera, adjusted, positions, connections, visible, selected, clock } = options;
  const radius = useMemo(() => boundingRadius(positions.values()), [positions]);
  const points = useMemo(() => [...positions.values()], [positions]);
  const density = densityScale(positions.size);
  const draw = useRef(() => {});
  const animator = useMemo(() => createAnimator(clock, () => draw.current()), [clock]);
  // Layout reads (sizes, label widths) are cached and refreshed only when data, selection or size change,
  // so dragging writes styles every frame without forcing a synchronous reflow.
  const measured = useRef<Measurements | null>(null);

  useLayoutEffect(() => {
    draw.current = () => {
      const element = stage.current;
      if (!active || !element || !canvas.current) return;
      measured.current ??= measure(element, nodes.current);
      const { viewport, panelWidth, labels } = measured.current;
      if (!viewport.width || !viewport.height) {
        measured.current = null;
        return;
      }
      // Default view: fit the bounding sphere into the stage (zoom out only) until the user takes over.
      if (!adjusted.current) camera.current = { ...camera.current, zoom: autoZoom(points, viewport, density) };
      const view = camera.current;
      const projected = new Map<string, Projection>();
      for (const [id, point] of positions) projected.set(id, project(point, view, viewport));
      const layout = fitViewport(projected, viewport, selected !== null || panelWidth > 0, sphereExtent(radius, view.zoom, density));
      if (armillary.current) {
        armillary.current.style.transform = 'translate(' + layout.dx + 'px, ' + layout.dy + 'px) scale(' +
          (view.zoom * layout.factor) + ') rotateX(' + (-view.pitch * 57.3) +
          'deg) rotateY(' + (view.yaw * 57.3) + 'deg)';
      }
      const nameplates = placeLabels(layout.positions, viewport.width, layout.factor, selected, labels, density);
      element.toggleAttribute('data-dense', density < 1);
      for (const { id, zIndex, badgeHidden, labelOffset } of nameplates) {
        const anchor = nodes.current.get(id);
        if (!anchor) continue;
        const { left, top, scale, opacity } = crystalStyle(layout.positions.get(id)!);
        anchor.style.left = left + 'px';
        anchor.style.top = top + 'px';
        anchor.style.transform = 'translate(-50%, -50%) scale(' + (scale * layout.factor * density) + ')';
        anchor.style.zIndex = String(zIndex);
        anchor.style.opacity = String(opacity);
        anchor.style.visibility = 'visible';
        anchor.style.setProperty('--label-offset', labelOffset + 'px');
        anchor.toggleAttribute('data-crowded-label', badgeHidden);
      }
      drawLinks(canvas.current, viewport, layout.positions, connections, visible, selected, layout.center, nameplates.map(({ box }) => box), density < 1);
    };
    measured.current = null;
    if (active) animator.request();
    else animator.cancel();
  }, [active, stage, armillary, canvas, nodes, camera, positions, connections, visible, selected, animator]);

  useEffect(() => {
    const element = stage.current;
    if (!element || !active) return;
    const stop = observeSize(element, () => {
      measured.current = null;
      animator.request();
    });
    return () => { stop(); animator.cancel(); };
  }, [active, stage, animator]);

  return animator.request;
}
