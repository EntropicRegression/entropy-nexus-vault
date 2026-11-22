import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, FocusEvent, KeyboardEvent, MouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import type { CrystalList, GalaxyMap } from '../../shared/types';
import { StarMap } from './StarMap';
import type { FrameClock } from './frame-clock';
import type { LinkKind } from './link-styles';
import { createFlyController } from './galaxy-camera';
import type { FlyDirection, FlyFrame } from './galaxy-camera';
import { bridgeCurve, galaxyExits, galaxySpecks, interiorData, outerRingShare } from './galaxy-geometry';
import type { GalaxyExit, Viewport } from './galaxy-geometry';
import { createAnimator } from './frame-clock';
import { beltLabels, bridgeStyle, cameraMoveMs, clampCamera, contains, detailLevel, dragThreshold, fitBoxes, fitCamera, groupBox,
  keyPan, lerpCamera, minimapTransform, panBy, revealBox, settleMs, toScreen, viewBox, worldLayout, zoomAt } from './galaxy-world';
import type { Bounds, Camera } from './galaxy-world';
import { GalaxyMinimap } from './GalaxyMinimap';
import { observeSize } from './canvas';
import { glowNames, glowTiers } from '../../shared/glow';
import type { AutoGlowTier } from '../../shared/glow';
import { glowFilterView, glowTotals } from './glow-filter';
import { GalaxyFinder } from './GalaxyFinder';
import { RainbowShowcase } from './RainbowShowcase';
import skyStyles from './Sky.module.css';
import styles from './Galaxy.module.css';

type EnabledMap = Extract<GalaxyMap, { enabled: true }>;

/** Exact wording required by DESIGN.md §6.10 (M5e-a review B5). */
export const arrangeText = '依目前的合作程度重新排列所有星系。目前不在星圖上的專案(暫時沒有成員)位置會一併清除,之後它們再出現時會重新放置。';
const arrangeMs = 650;
/** Inside a galaxy the default view may zoom in up to this much to fill the stage (M5e-b review S2). */
export const interiorMaxZoom = 1.6;

interface Props {
  map: EnabledMap;
  data: CrystalList;
  active: boolean;
  reduced: boolean;
  clock: FrameClock;
  selected: string | null;
  onSelect: (nodeId: string | null) => void;
  visible: ReadonlySet<LinkKind>;
  onToggle: (kind: LinkKind) => void;
  /** The galaxy (or nebula) shown inside; null = overview. Controlled by Sky so jumps can fly in. */
  target: string | null;
  onTarget: (key: string | null) => void;
  /** A fly finished at this target (null = overview); jumps select their crystal now. */
  onArrived: (key: string | null) => void;
  onExit: (exit: GalaxyExit) => void;
  onMapChange: (map: GalaxyMap) => void;
  /** Go to a node from the finder or the rainbow showcase: fly to its galaxy (if any) and open its profile. */
  onJump?: (nodeId: string) => void;
}

/**
 * The overview camera is remembered while the app stays open (flying in and back, switching floors) but not across
 * restarts — user ruling 2026-11-22 (DESIGN.md §6.10.2).
 */
let rememberedCamera: { camera: Camera; signature: string } | null = null;
/** Test hook: forget the remembered camera. */
export function resetGalaxyCamera() { rememberedCamera = null; }
/** Which map a remembered camera belongs to (another vault or project set opens at 全覽 again). */
const mapSignature = (map: EnabledMap) => map.groups.map((group) => group.key).join('|') + '#' + map.outer.length;

const hubBox: Bounds = { minX: -70, minY: -70, maxX: 70, maxY: 116 };
const dustBox = (point: { x: number; y: number }): Bounds => ({ minX: point.x - 70, minY: point.y - 14, maxX: point.x + 70, maxY: point.y + 14 });

/** One-character tier names for the filter buttons (the diamond colour is never the only cue). */
const tierShort: Record<AutoGlowTier, string> = { white: '白', green: '綠', blue: '藍', violet: '紫', gold: '金', red: '紅' };

function ConfirmDialog({ title, children, confirmLabel, saving, failure, onConfirm, onCancel }: {
  title: string; children: ReactNode; confirmLabel: string; saving: boolean; failure: string | null;
  onConfirm: () => void; onCancel: () => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => { cancel.current?.focus(); }, []);
  function keys(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (!saving) onCancel();
      return;
    }
    if (event.key !== 'Tab' || !card.current) return;
    const items = [...card.current.querySelectorAll<HTMLElement>('button:not([disabled])')];
    const index = items.indexOf(document.activeElement as HTMLElement);
    event.preventDefault();
    items[event.shiftKey ? (index <= 0 ? items.length - 1 : index - 1) : (index + 1) % items.length]?.focus();
  }
  return <div className={skyStyles.dialogVeil} onKeyDown={keys}
    onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onCancel(); }}>
    <div ref={card} className={skyStyles.dialogCard} role="dialog" aria-modal="true" aria-labelledby="galaxy-dialog-title" data-galaxy-dialog="">
      <h2 id="galaxy-dialog-title">✦ {title}</h2>
      {children}
      {failure && <p className={skyStyles.dialogError} role="alert"><strong>未儲存</strong> · {failure}</p>}
      <div className={skyStyles.dialogActions}>
        <button ref={cancel} type="button" onClick={onCancel} disabled={saving}>取消</button>
        <button type="button" className={skyStyles.dialogPrimary} onClick={onConfirm} disabled={saving}>
          {saving ? '正在寫入…' : failure ? '重試' : confirmLabel}
        </button>
      </div>
    </div>
  </div>;
}

export function GalaxyView({ map, data, active, reduced, clock, selected, onSelect, visible, onToggle, target, onTarget,
  onArrived, onExit, onMapChange, onJump }: Props) {
  const stage = useRef<HTMLDivElement>(null);
  const overview = useRef<HTMLDivElement>(null);
  const interior = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Viewport>({ width: 0, height: 0 });
  /** The group rendered inside; it stays during the fly back out. */
  const [shown, setShown] = useState<string | null>(target);
  const [moving, setMoving] = useState(false);
  const [chiefHover, setChiefHover] = useState(false);
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const [arranging, setArranging] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [dialog, setDialog] = useState<{ kind: 'promote'; key: string; name: string } | { kind: 'arrange' } | null>(null);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  /** Colour quick filter (one tier at a time; pressing it again clears) and the rainbow showcase (DESIGN.md §6.10.1). */
  const [filter, setFilter] = useState<AutoGlowTier | null>(null);
  const [showcase, setShowcase] = useState(false);
  const showcaseTrigger = useRef<HTMLButtonElement | null>(null);
  const world = useRef<HTMLDivElement>(null);
  const camera = useRef<Camera | null>(null);
  /** The camera as last rendered by React (detail level, belt names, zoom %, minimap); live moves only touch styles. */
  const [settled, setSettled] = useState<Camera | null>(null);
  const settleTimer = useRef<number | undefined>(undefined);
  /** True while the view is the automatic 全覽 (it refits when the stage or the map changes). */
  const following = useRef(true);
  const fitAfterMapChange = useRef(false);
  const minimapRect = useRef<SVGRectElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const motion = useRef<{ from: Camera; to: Camera; start: number; done?: () => void } | null>(null);
  const targetRef = useRef(target);
  const lastGroup = useRef<string | null>(target);
  const dialogTrigger = useRef<HTMLElement | null>(null);
  const arrangeTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => {
    window.clearTimeout(arrangeTimer.current);
    window.clearTimeout(settleTimer.current);
    motion.current = null;
    cameraAnimator.current?.cancel();
  }, []);
  const names = useMemo(() => new Map(data.crystals.map((node) => [node.nodeId, node.name])), [data.crystals]);
  const groupName = useMemo(() => new Map(map.groups.map((group) => [group.key, group.name])), [map.groups]);
  const filterView = useMemo(() => filter ? glowFilterView(map, data.crystals, filter) : null, [filter, map, data.crystals]);
  const totals = useMemo(() => glowTotals(data.crystals), [data.crystals]);
  const rainbowNodes = useMemo(() => data.crystals.filter((node) => node.glow === 'rainbow'), [data.crystals]);
  /** Where a node lives, for search results. */
  const placeOf = (nodeId: string) => {
    if (map.hub.includes(nodeId)) return '總管中樞';
    const key = map.membership[nodeId]?.group;
    const group = key ? map.groups.find((item) => item.key === key) : undefined;
    if (group) return (group.kind === 'nebula' ? '共用資料夾 · ' : '星系 · ') + group.name;
    return '外環星塵帶';
  };
  function toggleFilter(tier: AutoGlowTier) {
    const next = filter === tier ? null : tier;
    setFilter(next);
    if (!next) { setAnnouncement('已取消顏色篩選'); return; }
    const view = glowFilterView(map, data.crystals, next);
    const lit = [...view.groups.values()].filter((group) => group.count > 0).length;
    setAnnouncement('篩選' + glowNames[next] + ':共 ' + view.total + ' 個節點,分布在 ' + lit + ' 個星系或共用資料夾');
  }
  /** Closing returns focus to the 彩虹 button — after the commit, once the overview is no longer inert. */
  const restoreShowcaseFocus = useRef(false);
  function closeShowcase() {
    restoreShowcaseFocus.current = true;
    setShowcase(false);
  }
  useEffect(() => {
    if (showcase || !restoreShowcaseFocus.current) return;
    restoreShowcaseFocus.current = false;
    const trigger = showcaseTrigger.current;
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
  }, [showcase]);

  useLayoutEffect(() => {
    const element = stage.current;
    if (!element) return;
    const measure = () => setViewport({ width: element.clientWidth, height: element.clientHeight });
    measure();
    return observeSize(element, measure);
  }, []);

  const apply = (frame: FlyFrame) => {
    if (overview.current) {
      overview.current.style.transform = frame.overviewScale === 1 ? '' : 'scale(' + frame.overviewScale.toFixed(4) + ')';
      overview.current.style.opacity = String(frame.overviewOpacity);
      overview.current.style.visibility = frame.overviewOpacity <= 0 ? 'hidden' : '';
    }
    if (interior.current) {
      interior.current.style.transform = frame.interiorScale === 1 ? '' : 'scale(' + frame.interiorScale.toFixed(4) + ')';
      interior.current.style.opacity = String(frame.interiorOpacity);
      interior.current.style.visibility = frame.interiorOpacity <= 0 ? 'hidden' : '';
    }
  };
  const onFinish = useRef<(direction: FlyDirection) => void>(() => {});
  onFinish.current = (direction) => {
    setMoving(false);
    if (direction === 'out') {
      setShown(null);
      const from = lastGroup.current;
      queueMicrotask(() => stage.current?.querySelector<HTMLElement>('[data-group="' + from + '"]')?.focus({ preventScroll: true }));
    } else {
      queueMicrotask(() => interior.current?.querySelector<HTMLElement>('[data-galaxy-back]')?.focus({ preventScroll: true }));
    }
    onArrived(direction === 'in' ? targetRef.current : null);
  };
  const controller = useRef<ReturnType<typeof createFlyController>>(null);
  if (!controller.current) {
    controller.current = createFlyController({ clock, apply: (frame) => apply(frame), onFinish: (direction) => onFinish.current(direction) });
  }

  useLayoutEffect(() => {
    controller.current?.rest(targetRef.current ? 'in' : 'out');
    return () => controller.current?.cancel();
  }, []);

  // A new target starts a fly; a second press while flying lands at once (the controller's rule).
  const previous = useRef(target);
  useLayoutEffect(() => {
    if (previous.current === target) return;
    const from = previous.current;
    previous.current = target;
    targetRef.current = target;
    const fly = controller.current!;
    // A new target drops any camera move still running for the previous one (its fly must not start late).
    motion.current = null;
    if (target) {
      lastGroup.current = target;
      setShown(target);
      const name = groupName.get(target) ?? '星系';
      setAnnouncement('進入〈' + name + '〉' + (map.groups.find((group) => group.key === target)?.kind === 'nebula' ? '小星雲' : '星系'));
      if (from && !fly.running) fly.rest('out');
      setMoving(true);
      // Pan the camera until the galaxy is in view (seen before flying in), then fly from where it now sits.
      const placedGroup = layout.groups.get(target);
      const startFly = () => {
        if (targetRef.current !== target) return;
        setOrigin(target);
        fly.start('in', reduced);
      };
      const cam = camera.current;
      if (placedGroup && cam && !contains(viewBox(cam, viewport), groupBox(placedGroup))) {
        const reveal = revealBox(cam, groupBox(placedGroup), layout.bounds, viewport);
        following.current = false;
        // From another galaxy (an exit) the overview is hidden: move the camera at once, then fly.
        if (from) { applyCamera(reveal); startFly(); }
        else moveCamera(reveal, startFly);
      } else startFly();
    } else {
      setAnnouncement('返回星系總覽');
      setMoving(true);
      if (lastGroup.current) setOrigin(lastGroup.current);
      fly.start('out', reduced);
    }
  }, [target, reduced, groupName, map.groups]); // eslint-disable-line react-hooks/exhaustive-deps

  const layout = useMemo(() => worldLayout(map), [map]);
  const placed = layout;
  const belt = layout.belt;
  const statusOf = useMemo(() => new Map(data.crystals.map((node) => [node.nodeId, node.status])), [data.crystals]);

  /** The fly zooms around the galaxy's current point on screen (computed when the fly starts, never stale). */
  function setOrigin(key: string) {
    const group = layout.groups.get(key);
    const cam = camera.current;
    if (!overview.current || !group || !cam) return;
    const point = toScreen(group.center, cam, viewport);
    overview.current.style.transformOrigin = point.x.toFixed(1) + 'px ' + point.y.toFixed(1) + 'px';
  }
  /**
   * Stop a programmatic move. A pending fly (pan-before-fly) is never dropped: the camera lands where the pan was
   * going and the fly starts (map refreshes or resizes during the pan used to leave the view stuck; M6c review).
   */
  function interruptMotion() {
    const run = motion.current;
    motion.current = null;
    if (run?.done) { applyCamera(run.to); run.done(); }
  }
  /** Live camera change: one transform on the world layer (and the minimap frame); React catches up after 150ms. */
  function applyCamera(next: Camera) {
    camera.current = next;
    const layer = world.current;
    if (layer) {
      layer.style.transform = 'translate(' + (viewport.width / 2).toFixed(1) + 'px, ' + (viewport.height / 2).toFixed(1) + 'px) scale(' +
        next.zoom.toFixed(4) + ') translate(' + (-next.x).toFixed(1) + 'px, ' + (-next.y).toFixed(1) + 'px)';
      layer.style.willChange = 'transform';
    }
    const frame = minimapRect.current;
    if (frame) {
      const t = minimapTransform(layout.bounds);
      const box = viewBox(next, viewport);
      frame.setAttribute('x', (box.minX * t.scale + t.x).toFixed(1));
      frame.setAttribute('y', (box.minY * t.scale + t.y).toFixed(1));
      frame.setAttribute('width', ((box.maxX - box.minX) * t.scale).toFixed(1));
      frame.setAttribute('height', ((box.maxY - box.minY) * t.scale).toFixed(1));
    }
    rememberedCamera = following.current ? null : { camera: next, signature: mapSignature(map) };
    window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      if (world.current) world.current.style.willChange = '';
      setSettled(camera.current);
    }, settleMs);
  }
  // The animator is created once; it must call this render's applyCamera (current viewport and layout), not the first.
  const applyLatest = useRef(applyCamera);
  applyLatest.current = applyCamera;
  const reducedLatest = useRef(reduced);
  reducedLatest.current = reduced;
  const cameraAnimator = useRef<ReturnType<typeof createAnimator> | null>(null);
  if (!cameraAnimator.current) {
    cameraAnimator.current = createAnimator(clock, (now) => {
      const run = motion.current;
      if (!run) return;
      // Low motion switched on mid-move lands at once.
      const t = reducedLatest.current ? 1 : (now - run.start) / cameraMoveMs;
      applyLatest.current(lerpCamera(run.from, run.to, t));
      if (t < 1) cameraAnimator.current!.request();
      else { motion.current = null; run.done?.(); }
    });
  }
  /** Programmatic move (search, jumps, 回到全覽, minimap): 350ms ease-out; low motion lands at once. */
  function moveCamera(to: Camera, done?: () => void) {
    interruptMotion();
    const from = camera.current;
    if (!from || reduced) { applyCamera(to); done?.(); return; }
    motion.current = { from, to, start: clock.now(), done };
    cameraAnimator.current!.request();
  }
  /** A direct (user) change stops any programmatic move and leaves the automatic 全覽. */
  function userCamera(next: Camera) {
    interruptMotion();
    following.current = false;
    applyCamera(next);
  }
  function showAll(announce: boolean) {
    following.current = true;
    moveCamera(fitCamera(layout.bounds, viewport));
    if (announce) setAnnouncement('已移到〈全覽〉');
  }

  // First view: the remembered camera of this session, otherwise 全覽 (user ruling: 開場維持全覽). Stage resizes and map
  // changes refit while following 全覽, otherwise keep the camera inside the new limits.
  useLayoutEffect(() => {
    if (viewport.width <= 0 || viewport.height <= 0) return;
    let next: Camera;
    if (fitAfterMapChange.current) {
      fitAfterMapChange.current = false;
      following.current = true;
      moveCamera(fitCamera(layout.bounds, viewport));
      return;
    }
    // A pan in progress lands first (and starts its pending fly), then the camera is fitted or kept within the new limits.
    interruptMotion();
    const remembered = rememberedCamera?.signature === mapSignature(map) ? rememberedCamera.camera : null;
    if (!camera.current && remembered) { following.current = false; next = clampCamera(remembered, layout.bounds, viewport); }
    else if (!camera.current || following.current) next = fitCamera(layout.bounds, viewport);
    else next = clampCamera(camera.current, layout.bounds, viewport);
    applyCamera(next);
    window.clearTimeout(settleTimer.current);
    if (world.current) world.current.style.willChange = '';
    setSettled(next);
  }, [layout, viewport.width, viewport.height]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (targetRef.current !== null || !camera.current || !(event.target instanceof Element) || !overview.current?.contains(event.target)) return;
      if (event.target.closest('[data-galaxy-finder], [role="dialog"]')) return;
      event.preventDefault();
      const box = element.getBoundingClientRect();
      const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015));
      userCamera(zoomAt(camera.current, factor, { x: event.clientX - box.left, y: event.clientY - box.top }, layout.bounds, viewport));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  });

  function pointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    suppressClick.current = false;
    if (event.button !== 0 || !(event.target instanceof Element)) return;
    if (event.target.closest('button, input, a, [data-minimap], [data-galaxy-finder], [data-galaxy-toolbar], [role="dialog"], [role="tooltip"]')) return;
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
  }
  function pointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const press = drag.current;
    if (!press || press.id !== event.pointerId || !camera.current) return;
    // A missed pointerup (button released outside the window) must not turn hovering into panning.
    if (typeof event.buttons === 'number' && (event.buttons & 1) === 0 && event.pointerType !== 'touch') { drag.current = null; return; }
    const dx = event.clientX - press.x, dy = event.clientY - press.y;
    if (!press.moved) {
      if (Math.hypot(dx, dy) < dragThreshold) return;
      press.moved = true;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      overview.current?.setAttribute('data-dragging', '');
    }
    press.x = event.clientX; press.y = event.clientY;
    userCamera(panBy(camera.current, dx, dy, layout.bounds, viewport));
  }
  function pointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const press = drag.current;
    if (!press || press.id !== event.pointerId) return;
    drag.current = null;
    overview.current?.removeAttribute('data-dragging');
    // Only a real release after a drag is followed by a click to swallow; a cancel is not.
    if (press.moved && event.type === 'pointerup') suppressClick.current = true;
  }

  function cameraKeys(event: KeyboardEvent<HTMLDivElement>) {
    const cam = camera.current;
    if (!cam || !(event.target instanceof Element) || event.target.closest('input, textarea, [data-galaxy-finder], [role="dialog"], [data-minimap]')) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const step = event.shiftKey ? keyPan.shift : keyPan.step;
    const center = { x: viewport.width / 2, y: viewport.height / 2 };
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (moves[event.key]) userCamera(panBy(cam, moves[event.key][0], moves[event.key][1], layout.bounds, viewport));
    else if (event.key === '+' || event.key === '=') userCamera(zoomAt(cam, 1.2, center, layout.bounds, viewport));
    else if (event.key === '-' || event.key === '_') userCamera(zoomAt(cam, 1 / 1.2, center, layout.bounds, viewport));
    else if (event.key === '0') showAll(true);
    else if (event.key === 'Home') {
      following.current = false;
      moveCamera(clampCamera({ x: 0, y: 0, zoom: cam.zoom }, layout.bounds, viewport));
      setAnnouncement('已移到〈總管中樞〉');
    } else return;
    event.preventDefault();
  }

  /** Focus that lands outside the view pans the camera so the focused galaxy, hub or belt node is visible. */
  function followFocus(event: FocusEvent<HTMLDivElement>) {
    const cam = camera.current;
    const element = event.target as HTMLElement;
    // Focus on an off-screen element may scroll the stage; the camera handles visibility, so undo any scroll.
    if (stage.current && (stage.current.scrollLeft || stage.current.scrollTop)) { stage.current.scrollLeft = 0; stage.current.scrollTop = 0; }
    if (!cam) return;
    let box: Bounds | null = null;
    const key = element.dataset.group;
    if (key && layout.groups.has(key)) box = groupBox(layout.groups.get(key)!);
    else if (element.dataset.galaxyHub !== undefined) box = hubBox;
    else if (element.dataset.dust && belt.has(element.dataset.dust)) box = dustBox(belt.get(element.dataset.dust)!);
    if (!box || contains(viewBox(cam, viewport), box)) return;
    following.current = false;
    moveCamera(revealBox(cam, box, layout.bounds, viewport));
  }

  // A jump to a node on the belt or in the hub (search, rainbow showcase) pans the camera to it.
  useEffect(() => {
    const cam = camera.current;
    if (!selected || target !== null || !cam) return;
    const box = map.hub.includes(selected) ? hubBox : belt.has(selected) ? dustBox(belt.get(selected)!) : null;
    const active = document.activeElement as HTMLElement | null;
    if (active && (active.dataset.dust === selected || (active.dataset.galaxyHub !== undefined && map.hub.includes(selected)))) return;
    if (!box || motion.current || contains(viewBox(cam, viewport), box)) return;
    following.current = false;
    moveCamera(revealBox(cam, box, layout.bounds, viewport));
    setAnnouncement('已移到〈' + (map.hub.includes(selected) ? '總管中樞' : names.get(selected) ?? '外環節點') + '〉');
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const view = settled ?? camera.current ?? { x: 0, y: 0, zoom: 1 };
  const level = detailLevel(view.zoom);
  const labels = useMemo(() => beltLabels(belt, names, view.zoom), [belt, names, view.zoom]);
  const allVisible = contains(viewBox(view, viewport), layout.bounds, 2);
  const litBoxes = filterView ? [...filterView.groups].filter(([, group]) => group.count > 0)
    .map(([key]) => layout.groups.get(key)).filter((group) => group !== undefined).map((group) => groupBox(group!)) : [];
  const svgBox = layout.bounds;

  const members = useMemo(() => new Set(shown ? map.groups.find((group) => group.key === shown)?.members ?? [] : []), [shown, map.groups]);
  const inside = useMemo<CrystalList>(() => interiorData(data, members, shown ?? ''), [data, members, shown]);
  const exits = useMemo(() => shown ? galaxyExits(map, shown, data.links, names) : [], [map, shown, data.links, names]);

  function showToast(text: string, undo?: () => void) {
    setToast({ text, undo });
  }
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function openDialog(next: NonNullable<typeof dialog>, trigger: HTMLElement) {
    dialogTrigger.current = trigger;
    setFailure(null);
    setDialog(next);
  }
  function closeDialog() {
    setDialog(null);
    setSaving(false);
    setFailure(null);
    const trigger = dialogTrigger.current;
    queueMicrotask(() => trigger?.isConnected && trigger.focus({ preventScroll: true }));
  }

  async function promote(key: string, promoted: boolean): Promise<boolean> {
    try {
      const next = await window.vault.setGalaxyPromotion(key, promoted);
      const group = next.enabled ? next.groups.find((item) => item.key === key) : undefined;
      if (!group || (group.kind === 'galaxy') !== promoted) return false;
      onMapChange(next);
      return true;
    } catch {
      return false;
    }
  }

  async function confirmDialog() {
    if (!dialog) return;
    setSaving(true);
    setFailure(null);
    if (dialog.kind === 'promote') {
      const { key, name } = dialog;
      if (await promote(key, true)) {
        closeDialog();
        setAnnouncement('已將〈' + name + '〉升格為星系');
        const undo = async () => {
          setToast(null);
          if (await promote(key, false)) showToast('已撤銷升格:「' + name + '」回到共用資料夾。');
          else showToast('未儲存:撤銷升格失敗。', undo);
        };
        showToast('已將「' + name + '」升格為正式星系。', () => void undo());
      } else {
        setSaving(false);
        setFailure('升格沒有寫入,請重試。');
      }
      return;
    }
    try {
      const next = await window.vault.arrangeGalaxies();
      if (!reduced) {
        setArranging(true);
        window.clearTimeout(arrangeTimer.current);
        arrangeTimer.current = window.setTimeout(() => setArranging(false), arrangeMs);
      }
      fitAfterMapChange.current = true;
      onMapChange(next);
      closeDialog();
      setAnnouncement('已依合作程度重新排列星系');
    } catch {
      setSaving(false);
      setFailure('重新排列沒有寫入,請重試。');
    }
  }

  const translate = (x: number, y: number) => 'translate(' + x.toFixed(1) + 'px, ' + y.toFixed(1) + 'px) translate(-50%, -50%)';
  /** Puts the centre of the top graphic (rings, cloud, sun) on the point, with the nameplate hanging below. */
  const anchor = (x: number, y: number, graphicHeight: number) =>
    'translate(' + x.toFixed(1) + 'px, ' + y.toFixed(1) + 'px) translate(-50%, ' + (-(graphicHeight / 2 + 2)).toFixed(1) + 'px)';
  const hubNames = map.hub.map((id) => names.get(id) ?? '總管');
  const insideOverview = target === null;

  return <div ref={stage} className={skyStyles.gameFrame + ' ' + styles.universe} data-galaxy-view="" data-moving={moving}
    data-arranging={arranging} aria-label="專案星系">
    <p className={styles.srOnly} aria-live="polite" data-galaxy-announcement="">{announcement}</p>

    <div ref={overview} className={styles.overview} inert={!insideOverview || showcase} aria-hidden={!insideOverview}
      data-glow-filter={filter ?? undefined} data-detail={level} data-galaxy-overview=""
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}
      onClickCapture={(event) => { if (suppressClick.current) { suppressClick.current = false; event.stopPropagation(); event.preventDefault(); } }}
      onKeyDown={cameraKeys} onFocus={followFocus}>
      <div ref={world} className={styles.world} data-galaxy-world="" style={{ '--zoom': view.zoom.toFixed(3) } as CSSProperties}>
      {map.outer.length > 0 && <div className={styles.belt} aria-hidden="true"
        style={{ width: layout.beltRadius.x * 2, height: layout.beltRadius.y * 2, transform: 'translate(-50%, -50%)' }}>
        <span>外環星塵帶(無專案的節點 · 缺資料的舊封存節點)</span>
      </div>}
      <svg className={styles.bridges} aria-hidden="true" data-chief-hover={chiefHover}
        style={{ left: svgBox.minX, top: svgBox.minY }} width={svgBox.maxX - svgBox.minX} height={svgBox.maxY - svgBox.minY}>
        <g transform={'translate(' + (-svgBox.minX) + ' ' + (-svgBox.minY) + ')'}>
        {map.bridges.map((bridge) => {
          const a = placed.groups.get(bridge.a), b = placed.groups.get(bridge.b);
          const curve = a && b ? bridgeCurve(a, b, bridge.weight, { x: 0, y: 0 }, [...placed.groups.values()]) : null;
          const look = bridgeStyle(level, bridge.weight);
          if (!curve || !look.show) return null;
          const show = (event: MouseEvent) => {
            const box = stage.current!.getBoundingClientRect();
            setTip({ text: '跨專案協作 ' + bridge.count + ' 次', x: event.clientX - box.left, y: event.clientY - box.top });
          };
          return <g key={bridge.a + bridge.b} data-bridge={bridge.a + '|' + bridge.b} data-weight={bridge.weight}>
            <path d={curve.path} className={styles.bridgeLine} strokeWidth={look.width} />
            {look.beads && curve.beads.map((bead, index) => <circle key={index} cx={bead.x} cy={bead.y} r={2} className={styles.bead} />)}
            <path d={curve.path} className={styles.bridgeHit} onMouseEnter={show} onMouseMove={show} onMouseLeave={() => setTip(null)} />
          </g>;
        })}
        {chiefHover && map.groups.filter((group) => group.kind === 'galaxy').map((group) => {
          const point = placed.groups.get(group.key)!;
          return <line key={group.key} x1={0} y1={0} x2={point.center.x} y2={point.center.y} className={styles.command} data-command="" />;
        })}
        </g>
      </svg>

      {map.hub.length > 0 && <button type="button" className={styles.hub} data-galaxy-hub=""
        data-dimmed={filterView && !map.hub.some((id) => filterView.nodes.has(id)) ? '' : undefined}
        style={{ transform: anchor(0, 0, 84) }}
        aria-label={'總管中樞 ' + hubNames.join('、') + ',不屬於任何星系'}
        onMouseEnter={() => setChiefHover(true)} onMouseLeave={() => setChiefHover(false)}
        onFocus={() => setChiefHover(true)} onBlur={() => setChiefHover(false)} onClick={() => onSelect(map.hub[0])}>
        <span className={styles.sun} aria-hidden="true"><span>✦</span></span>
        <span className={styles.plate}>總管中樞 · {hubNames.join('、')}</span>
      </button>}

      {map.groups.map((group) => {
        const point = placed.groups.get(group.key);
        if (!point) return null;
        const active = group.members.filter((id) => statusOf.get(id) !== '封存').length;
        const archived = group.members.length - active;
        const counts = group.members.length + ' 節點(' + active + ' 活躍 / ' + archived + ' 封存)';
        const size = point.size;
        const lit = filterView?.groups.get(group.key);
        // While filtering, brightness follows how many members have the tier; a text count says the same in words.
        const filterStyle = lit ? { opacity: lit.brightness } : undefined;
        const filterCount = lit && filter ? <em className={styles.glowCount} data-glow-count={lit.count}>
          <span className={styles.glowDiamond} data-glow={filter} aria-hidden="true" />{glowNames[filter]} × {lit.count}</em> : null;
        if (group.kind === 'nebula') {
          return <div key={group.key} className={styles.group} data-filter-brightness={lit?.brightness.toFixed(2)}
            style={{ transform: anchor(point.center.x, point.center.y, size * 80 / 128), ...filterStyle }}>
            <button type="button" className={styles.groupButton} data-group={group.key} data-kind="nebula"
              aria-label={'共用資料夾 ' + group.name + ',' + counts + ',按下展開'} onClick={() => onTarget(group.key)}>
              <svg width={size} height={size * 80 / 128} viewBox="0 0 128 80" aria-hidden="true">
                <ellipse cx="64" cy="40" rx="52" ry="26" className={styles.cloudOuter} />
                <ellipse cx="58" cy="38" rx="34" ry="18" className={styles.cloudInner} />
                {Array.from({ length: 8 }, (_, index) => {
                  const angle = (index / 8) * Math.PI * 2 + 0.3;
                  return <circle key={index} cx={64 + Math.cos(angle) * (24 + (index % 3) * 11)} cy={40 + Math.sin(angle) * (14 + (index % 2) * 10)}
                    r={1 + (index % 3) * 0.65} className={styles.cloudSpeck} opacity={0.45 + (index % 2) * 0.3} />;
                })}
              </svg>
              <span className={styles.plate}><strong>{group.name}</strong><small>共用資料夾 · {counts}</small>{filterCount}</span>
            </button>
            <button type="button" className={styles.promote} data-promote={group.key}
              onClick={(event) => openDialog({ kind: 'promote', key: group.key, name: group.name }, event.currentTarget)}>升格為星系</button>
          </div>;
        }
        const ring = size * outerRingShare;
        return <div key={group.key} className={styles.group} data-filter-brightness={lit?.brightness.toFixed(2)}
          style={{ transform: anchor(point.center.x, point.center.y, size), ...filterStyle }}>
          <button type="button" className={styles.groupButton} data-group={group.key} data-kind="galaxy"
            aria-label={'專案星系 ' + group.name + ',' + counts + (group.promoted ? ',由共用資料夾升格' : '') + ',按下飛入'}
            onClick={() => onTarget(group.key)}>
            <svg className={styles.armillary} width={size} height={size} viewBox={'0 0 ' + size + ' ' + size} aria-hidden="true">
              <circle cx={size / 2} cy={size / 2} r={ring * 0.65} className={styles.halo} />
              <circle cx={size / 2} cy={size / 2} r={ring} className={styles.ringOuter} />
              <circle cx={size / 2} cy={size / 2} r={ring * 0.78} className={styles.ringMid} />
              <circle cx={size / 2} cy={size / 2} r={ring * 0.52} className={styles.ringInner} />
              <circle cx={size / 2} cy={size / 2} r={14} className={styles.coreGlow} />
              <circle cx={size / 2} cy={size / 2} r={7} className={styles.core} />
              {galaxySpecks(group.members.length, size).map((speck, index) =>
                <circle key={index} cx={speck.x} cy={speck.y} r={speck.r} className={styles.speck} />)}
            </svg>
            <span className={styles.plate}><strong>{group.name}</strong><small>{counts}{group.promoted ? ' · 升格' : ''}</small>{filterCount}</span>
          </button>
        </div>;
      })}

      {map.outer.map((id) => {
        const point = belt.get(id)!;
        return <button key={id} type="button" className={styles.dust} data-dust={id} style={{ transform: translate(point.x, point.y) }}
          data-dimmed={filterView && !filterView.nodes.has(id) ? '' : undefined}
          data-label={level === 'full' && labels.has(id) ? undefined : 'hidden'}
          aria-label={(names.get(id) ?? id) + ',外環星塵帶'} aria-pressed={selected === id} onClick={() => onSelect(selected === id ? null : id)}>
          <span className={styles.dustDot} aria-hidden="true" /><span className={styles.dustName}>{names.get(id) ?? id}</span>
        </button>;
      })}
      </div>

      {settled && !allVisible && <GalaxyMinimap layout={layout} map={map} camera={view} viewport={viewport} rect={minimapRect}
        brightness={filterView ? new Map([...filterView.groups].map(([key, group]) => [key, group.brightness])) : null}
        onCenter={(point, animate) => {
          following.current = false;
          const cam = camera.current ?? view;
          const next = clampCamera({ ...point, zoom: cam.zoom }, layout.bounds, viewport);
          if (animate) moveCamera(next); else userCamera(next);
        }}
        onPan={(dx, dy) => userCamera(panBy(camera.current ?? view, dx, dy, layout.bounds, viewport))} />}

      <div className={styles.toolbar} data-galaxy-toolbar="">
        <div className={styles.cameraTools}>
          <small aria-label={'目前縮放 ' + Math.round(view.zoom * 100) + '%'} data-zoom-readout="">{Math.round(view.zoom * 100)}%</small>
          {filter && <button type="button" data-fit-lit="" disabled={!litBoxes.length}
            onClick={() => { following.current = false; moveCamera(fitBoxes(litBoxes, layout.bounds, viewport)); setAnnouncement('已移到〈亮著的星系〉'); }}>
            看亮著的星系</button>}
          <button type="button" data-fit-all="" onClick={() => showAll(true)}>回到全覽</button>
        </div>
        {onJump && <GalaxyFinder crystals={data.crystals} placeOf={placeOf} onPick={onJump} />}
        <div className={styles.glowFilters} role="group" aria-label="依光暈顏色篩選星系(再按一次取消)">
          {glowTiers.map((tier) => <button key={tier} type="button" data-glow-filter={tier} aria-pressed={filter === tier}
            aria-label={'篩選' + glowNames[tier] + ',共 ' + (totals.get(tier) ?? 0) + ' 個節點'} title={glowNames[tier]}
            onClick={() => toggleFilter(tier)}>
            <span className={styles.glowDiamond} data-glow={tier} aria-hidden="true" />{tierShort[tier]}
            <small aria-hidden="true">{totals.get(tier) ?? 0}</small>
          </button>)}
          <button type="button" data-rainbow-open="" className={styles.rainbowButton}
            aria-label={'開啟彩虹節點展示,共 ' + rainbowNodes.length + ' 個'}
            onClick={(event) => { showcaseTrigger.current = event.currentTarget; setShowcase(true); }}>
            <span className={styles.glowDiamond} data-glow="rainbow" aria-hidden="true" />彩虹<small aria-hidden="true">{rainbowNodes.length}</small>
          </button>
        </div>
        <button type="button" data-arrange="" onClick={(event) => openDialog({ kind: 'arrange' }, event.currentTarget)}>整理一次(依合作排列)</button>
      </div>
      {tip && <span className={styles.tip} role="tooltip" style={{ left: tip.x + 12, top: tip.y + 12 }}>{tip.text}</span>}
    </div>

    <div ref={interior} className={styles.interior} inert={insideOverview} aria-hidden={insideOverview} data-galaxy-interior={shown ?? ''}>
      {shown && <>
        <StarMap key={shown} active={active && shown !== null} data={inside} selected={selected} onSelect={onSelect}
          visible={visible} onToggle={onToggle} clock={clock} maxFitZoom={interiorMaxZoom} />
        <button type="button" className={styles.back} data-galaxy-back="" onClick={() => onTarget(null)}>← 返回星系總覽(Esc)</button>
        {exits.length > 0 && <nav className={styles.exits} aria-label="通往其他星系">
          {exits.map((exit) => <button key={exit.kind + exit.target + (exit.nodeId ?? '')} type="button"
            className={styles.exit} data-exit={exit.kind} onClick={() => onExit(exit)}>{exit.label}</button>)}
        </nav>}
      </>}
    </div>

    {dialog?.kind === 'promote' && <ConfirmDialog title="升格為星系" confirmLabel="升格" saving={saving} failure={failure}
      onConfirm={() => void confirmDialog()} onCancel={closeDialog}>
      <p>「{dialog.name}」是共用資料夾(小星雲)。升格後它會成為正式星系:可以飛入,並開始參與星系間的協作連線;位置不變。之後可以撤銷。</p>
    </ConfirmDialog>}
    {dialog?.kind === 'arrange' && <ConfirmDialog title="整理一次" confirmLabel="整理" saving={saving} failure={failure}
      onConfirm={() => void confirmDialog()} onCancel={closeDialog}>
      <p data-arrange-text="">{arrangeText}</p>
    </ConfirmDialog>}
    {showcase && <RainbowShowcase nodes={rainbowNodes} onClose={closeShowcase}
      onPick={(nodeId) => { setShowcase(false); onJump?.(nodeId); }} />}
    {toast && <div className={styles.toast} role="status" data-galaxy-toast="">
      <span>{toast.text}</span>
      {toast.undo && <button type="button" onClick={toast.undo}>撤銷</button>}
    </div>}
  </div>;
}
