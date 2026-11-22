import { useEffect, useRef, useState } from 'react';
import type { CrystalList, GalaxyMap, MemoryEntry, NodeCrystalDetail } from '../../shared/types';
import { browserFrameClock } from './frame-clock';
import type { FrameClock } from './frame-clock';
import { linkKinds } from './link-styles';
import type { LinkKind } from './link-styles';
import { StarMap } from './StarMap';
import { StarField } from './StarField';
import { DetailPanel } from './DetailPanel';
import { AwardDialog } from './AwardDialog';
import { GalaxyView } from './GalaxyView';
import { alsoInProjects } from './galaxy-geometry';
import type { GalaxyExit } from './galaxy-geometry';
import type { AwardFailure } from './AwardDialog';
import { useSystemMotion } from './use-system-motion';
import styles from './Sky.module.css';

const empty: CrystalList = { crystals: [], links: [] };

interface Props {
  active: boolean;
  reducedMotion: boolean;
  vaultExists: boolean;
  refreshToken: number;
  clock?: FrameClock;
  /** Issued after a floor transition ends; each requestId selects at most once. */
  selectionRequest?: { nodeId: string; requestId: number };
  onReturn: () => void;
  onOpenEntry?: (entry: MemoryEntry) => void;
  /** The user picked or cleared a crystal; a jump still waiting to land must not override it. */
  onUserSelect?: () => void;
  /** The node named by selectionRequest is not on the map (removed or renamed since the jump began). */
  onRequestMissing?: () => void;
}

export function Sky({ active, reducedMotion, vaultExists, refreshToken, clock = browserFrameClock,
  selectionRequest, onReturn, onOpenEntry, onUserSelect, onRequestMissing }: Props) {
  const [data, setData] = useState<CrystalList>();
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ nodeId: string; result: NodeCrystalDetail | null }>();
  const [visible, setVisible] = useState<ReadonlySet<LinkKind>>(() => new Set(linkKinds));
  /** Bumped after an award is written so the glow and the panel are read again. */
  const [reload, setReload] = useState(0);
  const [award, setAward] = useState<{ mode: 'grant' | 'withdraw'; nodeId: string; name: string; saving: boolean;
    failure: AwardFailure | null }>();
  const awardTrigger = useRef<HTMLButtonElement | null>(null);
  const consumedSelection = useRef(new Set<number>());
  /** A jump's target crystal receives focus once rendered (M5b review S1), also when it was already selected. */
  const [jumpFocus, setJumpFocus] = useState<{ nodeId: string; requestId: number }>();
  /** Project galaxies (DESIGN.md §6.10); undefined until read, { enabled: false } keeps the flat star map. */
  const [galaxies, setGalaxies] = useState<GalaxyMap>();
  /** The last read failed: kept = the previous map is still shown; flat = there was none, so the flat map is shown. */
  const [galaxyError, setGalaxyError] = useState<'kept' | 'flat' | null>(null);
  const lastGalaxies = useRef<GalaxyMap | undefined>(undefined);
  lastGalaxies.current = galaxies;
  /** The galaxy (or nebula) shown inside; null = overview. */
  const [target, setTarget] = useState<string | null>(null);
  /** A jump waiting for its galaxy fly to finish before it selects (cancelled when the user picks something). */
  const pendingSelect = useRef<{ nodeId: string; group: string | null; requestId: number } | null>(null);
  const scene = useRef<HTMLDivElement>(null);
  const systemReduced = useSystemMotion();
  const reduced = reducedMotion || systemReduced;
  const node = vaultExists ? data?.crystals.find((node) => node.nodeId === selected) : undefined;
  const inspectedId = node?.nodeId;

  useEffect(() => {
    if (!active || !vaultExists) return;
    let current = true;
    void window.vault.listCrystals().then((next) => {
      if (!current) return;
      setFailed(false);
      setData(next);
      setSelected((id) => id && next.crystals.some((node) => node.nodeId === id) ? id : null);
    }, () => { if (current) setFailed(true); });
    return () => { current = false; };
  }, [active, vaultExists, refreshToken, reload]);

  useEffect(() => {
    // Read even while downstairs, so the upstairs view is decided before the floor switch lands.
    if (!vaultExists) return;
    let current = true;
    // Without the galaxy API (or on failure) the flat star map stays, unchanged.
    const read = window.vault.listGalaxies ? window.vault.listGalaxies() : Promise.resolve<GalaxyMap>({ enabled: false });
    void read.then((next) => {
      if (!current) return;
      setGalaxies(next);
      setGalaxyError(null);
      if (!next.enabled) setTarget(null);
      else setTarget((key) => key && next.groups.some((group) => group.key === key) ? key : null);
    }, () => {
      if (!current) return;
      // A temporary failure (a locked layout file, say) keeps the last good map; only with none do we go flat
      // (M5e-b review S7).
      const kept = lastGalaxies.current?.enabled ?? false;
      setGalaxyError(kept ? 'kept' : 'flat');
      if (!kept) setGalaxies({ enabled: false });
    });
    return () => { current = false; };
  }, [vaultExists, refreshToken, reload]);

  useEffect(() => {
    if (!active || !vaultExists || !selectionRequest || !data || !galaxies || consumedSelection.current.has(selectionRequest.requestId)) return;
    consumedSelection.current.add(selectionRequest.requestId);
    if (!data.crystals.some((node) => node.nodeId === selectionRequest.nodeId)) {
      onRequestMissing?.();
      return;
    }
    // With galaxies, a jump flies into the node's galaxy first and selects once the fly lands (M5e-b).
    const group = galaxies.enabled ? galaxies.membership[selectionRequest.nodeId]?.group ?? null : null;
    if (galaxies.enabled && group !== target) {
      pendingSelect.current = { nodeId: selectionRequest.nodeId, group, requestId: selectionRequest.requestId };
      setTarget(group);
      return;
    }
    setSelected(selectionRequest.nodeId);
    setJumpFocus(selectionRequest);
  }, [active, vaultExists, selectionRequest, data, galaxies, target, onRequestMissing]);

  function arrived(key: string | null) {
    const pending = pendingSelect.current;
    if (!pending || pending.group !== key) return;
    pendingSelect.current = null;
    setSelected(pending.nodeId);
    setJumpFocus({ nodeId: pending.nodeId, requestId: pending.requestId });
  }

  function exitTo(exit: GalaxyExit) {
    pendingSelect.current = exit.nodeId ? { nodeId: exit.nodeId, group: exit.target, requestId: -Date.now() } : null;
    setSelected(null);
    setTarget(exit.target);
  }

  useEffect(() => {
    if (!jumpFocus) return;
    Array.from(scene.current?.querySelectorAll<HTMLButtonElement>('button[data-crystal]') ?? [])
      .find((button) => button.dataset.crystal === jumpFocus.nodeId)?.focus({ preventScroll: true });
  }, [jumpFocus]);

  useEffect(() => {
    if (!active || !inspectedId) return;
    let current = true;
    const receive = (result: NodeCrystalDetail | null) => { if (current) setDetail({ nodeId: inspectedId, result }); };
    void window.vault.readCrystal(inspectedId).then(receive, () => receive(null));
    return () => { current = false; };
  }, [active, inspectedId, refreshToken, reload]);

  function closeAward() {
    setAward(undefined);
    const trigger = awardTrigger.current;
    // The panel re-renders after a write; fall back to the action button that replaced the trigger.
    queueMicrotask(() => (trigger?.isConnected ? trigger : scene.current?.querySelector<HTMLButtonElement>('[data-award-action]'))
      ?.focus({ preventScroll: true }));
  }

  async function confirmAward(reason: string) {
    if (!award) return;
    setAward({ ...award, saving: true, failure: null });
    let result;
    try {
      result = await window.vault.setAward(award.nodeId, award.mode === 'grant' ? { reason } : null, data?.awards?.version ?? null);
    } catch {
      result = { ok: false as const, reason: 'io' as const };
    }
    if (result.ok) {
      // The next grant or withdrawal must carry the version this write produced, even if the user acts before the
      // list is read again (M5c review B5: otherwise our own write looks like an outside change).
      const written = { mtime: result.mtime, size: result.size };
      setData((current) => current && { ...current, awards: { version: written, corrupt: false } });
      setReload((value) => value + 1);
      closeAward();
    } else {
      setAward((current) => current && { ...current, saving: false, failure: result.reason });
    }
  }

  function toggle(kind: LinkKind) {
    setVisible((previous) => {
      const next = new Set(previous);
      if (!next.delete(kind)) next.add(kind);
      return next;
    });
  }

  function select(next: string | null) {
    onUserSelect?.();
    pendingSelect.current = null;
    if (next === null && inspectedId) {
      const buttons = scene.current?.querySelectorAll<HTMLButtonElement>('button[data-crystal]');
      const previous = buttons && Array.from(buttons).find((button) => button.dataset.crystal === inspectedId);
      previous?.focus({ preventScroll: true });
    }
    setSelected(next);
  }

  const inspected = node && detail?.nodeId === node.nodeId ? detail : undefined;
  const galaxyMode = vaultExists && galaxies?.enabled ? galaxies : null;
  // Projects the selected node also works in, besides its home group (bridge sources; DESIGN.md §6.10).
  const homeKey = galaxyMode && node ? galaxyMode.membership[node.nodeId]?.group ?? null : null;
  const homeName = galaxyMode && homeKey ? galaxyMode.groups.find((group) => group.key === homeKey)?.name : undefined;
  // Matched by project key, so a same-named but different project is not hidden (M5e-b review S4).
  const alsoIn = galaxyMode && node ? alsoInProjects(node.nodeId, homeKey, homeName, node.projectNames, data?.links ?? [], galaxyMode) : undefined;
  return <div ref={scene} className={styles.skyScene} data-sky="" data-quiet={reduced} data-galaxies={Boolean(galaxyMode)}
    onKeyDown={(event) => {
      if (event.key !== 'Escape') return;
      // Inside a galaxy: the first Esc closes the panel, the next one flies back to the overview.
      if (galaxyMode && target !== null && selected === null) setTarget(null);
      else select(null);
    }}>
    <StarField active={active} reduced={reduced} clock={clock} />
    {galaxyMode ? <GalaxyView map={galaxyMode} data={data ?? empty} active={active} reduced={reduced} clock={clock}
      selected={selected} onSelect={select} visible={visible} onToggle={toggle} target={target}
      onTarget={(key) => { pendingSelect.current = null; setTarget(key); }} onArrived={arrived} onExit={exitTo}
      onMapChange={setGalaxies} />
      : vaultExists && !galaxies
        // Until we know whether the stats have a 專案表, keep an empty stage (no flash of the flat map).
        ? <div className={styles.gameFrame + ' ' + styles.mapStage} aria-busy="true" />
        : <StarMap active={active} data={vaultExists ? data ?? empty : empty} selected={selected} onSelect={select}
          visible={visible} onToggle={toggle} clock={clock} />}
    {vaultExists && galaxyError && <p className={styles.galaxyNotice} role="status" data-galaxy-error={galaxyError}>
      {galaxyError === 'kept' ? '星系資料暫時讀不到,先顯示上次的內容。' : '無法讀取專案星系,暫時顯示平面星圖。'}
    </p>}
    {(!vaultExists || failed || (data && data.crystals.length === 0)) && <p className={styles.mapMessage} role="status">
      {!vaultExists ? '找不到記憶庫資料夾' : failed ? '無法讀取節點星圖。' : '尚無水晶可顯示。'}
    </p>}
    <DetailPanel node={vaultExists ? node : undefined} detail={inspected?.result ?? null} loading={Boolean(node && !inspected)}
      error={Boolean(inspected && !inspected.result)} onDismiss={() => select(null)} onOpenEntry={onOpenEntry}
      awardsCorrupt={data?.awards?.corrupt} alsoIn={alsoIn}
      onAward={(mode, trigger) => {
        if (!node) return;
        awardTrigger.current = trigger;
        setAward({ mode, nodeId: node.nodeId, name: node.name, saving: false, failure: null });
      }} />
    {award && <AwardDialog key={award.mode + award.nodeId} mode={award.mode} name={award.name} saving={award.saving}
      failure={award.failure} onConfirm={(reason) => void confirmAward(reason)} onCancel={closeAward}
      onReload={() => { setReload((value) => value + 1); setAward((current) => current && { ...current, failure: null }); }} />}
    <button type="button" className={styles.skylight} onClick={onReturn}>▼ 向下俯視，回到大圖書館判例卷宗室 ▼</button>
  </div>;
}
