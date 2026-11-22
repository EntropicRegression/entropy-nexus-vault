import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import type { CrystalList, GalaxyMap } from '../../shared/types';
import { StarMap } from './StarMap';
import type { FrameClock } from './frame-clock';
import type { LinkKind } from './link-styles';
import { createFlyController } from './galaxy-camera';
import type { FlyDirection, FlyFrame } from './galaxy-camera';
import { beltPositions, bridgeCurve, galaxyExits, galaxySpecks, interiorData, outerRingShare, placeOnScreen, viewportScale } from './galaxy-geometry';
import type { GalaxyExit, Viewport } from './galaxy-geometry';
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
  const targetRef = useRef(target);
  const lastGroup = useRef<string | null>(target);
  const dialogTrigger = useRef<HTMLElement | null>(null);
  const arrangeTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(arrangeTimer.current), []);
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
    if (target) {
      lastGroup.current = target;
      setShown(target);
      const name = groupName.get(target) ?? '星系';
      setAnnouncement('進入〈' + name + '〉' + (map.groups.find((group) => group.key === target)?.kind === 'nebula' ? '小星雲' : '星系'));
      if (from && !fly.running) fly.rest('out');
      setMoving(true);
      fly.start('in', reduced);
    } else {
      setAnnouncement('返回星系總覽');
      setMoving(true);
      fly.start('out', reduced);
    }
  }, [target, reduced, groupName, map.groups]);

  const placed = useMemo(() => placeOnScreen(map, viewport), [map, viewport]);
  const scale = viewportScale(viewport);
  const center = { x: viewport.width / 2, y: viewport.height / 2 };
  const belt = useMemo(() => beltPositions(map.outer, viewport), [map.outer, viewport]);
  const statusOf = useMemo(() => new Map(data.crystals.map((node) => [node.nodeId, node.status])), [data.crystals]);
  const origin = shown ? placed.groups.get(shown)?.center : undefined;

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
      data-glow-filter={filter ?? undefined}
      style={{ transformOrigin: origin ? origin.x + 'px ' + origin.y + 'px' : '50% 50%' }} data-galaxy-overview="">
      <div className={styles.belt} aria-hidden="true"><span>外環星塵帶(無專案的節點 · 缺資料的舊封存節點)</span></div>
      <svg className={styles.bridges} width={viewport.width} height={viewport.height} aria-hidden="true" data-chief-hover={chiefHover}>
        {map.bridges.map((bridge) => {
          const a = placed.groups.get(bridge.a), b = placed.groups.get(bridge.b);
          const curve = a && b ? bridgeCurve(a, b, bridge.weight, center, [...placed.groups.values()]) : null;
          if (!curve) return null;
          const show = (event: MouseEvent) => {
            const box = stage.current!.getBoundingClientRect();
            setTip({ text: '跨專案協作 ' + bridge.count + ' 次', x: event.clientX - box.left, y: event.clientY - box.top });
          };
          return <g key={bridge.a + bridge.b} data-bridge={bridge.a + '|' + bridge.b} data-weight={bridge.weight}>
            <path d={curve.path} className={styles.bridgeLine} strokeWidth={curve.width} />
            {curve.beads.map((bead, index) => <circle key={index} cx={bead.x} cy={bead.y} r={2} className={styles.bead} />)}
            <path d={curve.path} className={styles.bridgeHit} onMouseEnter={show} onMouseMove={show} onMouseLeave={() => setTip(null)} />
          </g>;
        })}
        {chiefHover && map.groups.filter((group) => group.kind === 'galaxy').map((group) => {
          const point = placed.groups.get(group.key)!;
          return <line key={group.key} x1={center.x} y1={center.y} x2={point.center.x} y2={point.center.y} className={styles.command} data-command="" />;
        })}
      </svg>

      {map.hub.length > 0 && <button type="button" className={styles.hub} data-galaxy-hub=""
        data-dimmed={filterView && !map.hub.some((id) => filterView.nodes.has(id)) ? '' : undefined}
        style={{ transform: anchor(center.x, center.y, 84) }}
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
              <circle cx={size / 2} cy={size / 2} r={14 * Math.max(0.7, scale)} className={styles.coreGlow} />
              <circle cx={size / 2} cy={size / 2} r={7 * Math.max(0.7, scale)} className={styles.core} />
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
          aria-label={(names.get(id) ?? id) + ',外環星塵帶'} aria-pressed={selected === id} onClick={() => onSelect(selected === id ? null : id)}>
          <span className={styles.dustDot} aria-hidden="true" />{names.get(id) ?? id}
        </button>;
      })}

      <div className={styles.toolbar}>
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
