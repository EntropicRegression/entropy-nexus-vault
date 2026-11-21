import { useEffect, useRef, useState } from 'react';
import type { CrystalList, MemoryEntry, NodeCrystalDetail } from '../../shared/types';
import { browserFrameClock } from './frame-clock';
import type { FrameClock } from './frame-clock';
import { linkKinds } from './link-styles';
import type { LinkKind } from './link-styles';
import { StarMap } from './StarMap';
import { StarField } from './StarField';
import { DetailPanel } from './DetailPanel';
import styles from './Sky.module.css';

const empty: CrystalList = { crystals: [], links: [] };

interface Props {
  active: boolean;
  reducedMotion: boolean;
  settingsDisabled?: boolean;
  vaultExists: boolean;
  refreshToken: number;
  clock?: FrameClock;
  /** M5b will issue this after a floor transition, independently of pointer selection. */
  selectionRequest?: { nodeId: string; requestId: number };
  onReturn: () => void;
  onToggleMotion: () => void;
  onOpenEntry?: (entry: MemoryEntry) => void;
}

function useSystemMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  useEffect(() => {
    const setting = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!setting) return;
    const update = () => setReduced(setting.matches);
    setting.addEventListener('change', update);
    return () => setting.removeEventListener('change', update);
  }, []);
  return reduced;
}

export function Sky({ active, reducedMotion, settingsDisabled, vaultExists, refreshToken, clock = browserFrameClock,
  selectionRequest, onReturn, onToggleMotion, onOpenEntry }: Props) {
  const [data, setData] = useState<CrystalList>();
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ nodeId: string; result: NodeCrystalDetail | null }>();
  const [visible, setVisible] = useState<ReadonlySet<LinkKind>>(() => new Set(linkKinds));
  const consumedSelection = useRef(new Set<number>());
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
  }, [active, vaultExists, refreshToken]);

  useEffect(() => {
    if (!active || !vaultExists || !selectionRequest || !data || consumedSelection.current.has(selectionRequest.requestId)) return;
    consumedSelection.current.add(selectionRequest.requestId);
    if (data.crystals.some((node) => node.nodeId === selectionRequest.nodeId)) setSelected(selectionRequest.nodeId);
  }, [active, vaultExists, selectionRequest, data]);

  useEffect(() => {
    if (!active || !inspectedId) return;
    let current = true;
    const receive = (result: NodeCrystalDetail | null) => { if (current) setDetail({ nodeId: inspectedId, result }); };
    void window.vault.readCrystal(inspectedId).then(receive, () => receive(null));
    return () => { current = false; };
  }, [active, inspectedId, refreshToken]);

  function toggle(kind: LinkKind) {
    setVisible((previous) => {
      const next = new Set(previous);
      if (!next.delete(kind)) next.add(kind);
      return next;
    });
  }

  function select(next: string | null) {
    if (next === null && inspectedId) {
      const buttons = scene.current?.querySelectorAll<HTMLButtonElement>('button[data-crystal]');
      const previous = buttons && Array.from(buttons).find((button) => button.dataset.crystal === inspectedId);
      previous?.focus({ preventScroll: true });
    }
    setSelected(next);
  }

  const inspected = node && detail?.nodeId === node.nodeId ? detail : undefined;
  return <div ref={scene} className={styles.skyScene} data-sky="" data-quiet={reduced} hidden={!active}
    onKeyDown={(event) => { if (event.key === 'Escape') select(null); }}>
    <StarField active={active} reduced={reduced} clock={clock} />
    <header className={styles.hud}>
      <h1><span aria-hidden="true" />ENTROPY NEXUS · ARCHIVE</h1>
      <nav aria-label="樓層切換">
        <button className={styles.hudActive} type="button" aria-current="page">✦ 仰望星圖｜休眠庫</button>
        <button type="button" onClick={onReturn}>◈ 俯瞰圖書館｜判例室</button>
      </nav>
      <button type="button" className={styles.motionButton} aria-pressed={reducedMotion}
        disabled={settingsDisabled} onClick={onToggleMotion}>低動態：{reducedMotion ? '開' : '關'}</button>
    </header>
    <StarMap active={active} data={vaultExists ? data ?? empty : empty} selected={selected} onSelect={select}
      visible={visible} onToggle={toggle} clock={clock} />
    {(!vaultExists || failed || (data && data.crystals.length === 0)) && <p className={styles.mapMessage} role="status">
      {!vaultExists ? '找不到記憶庫資料夾' : failed ? '無法讀取節點星圖。' : '尚無水晶可顯示。'}
    </p>}
    <DetailPanel node={vaultExists ? node : undefined} detail={inspected?.result ?? null} loading={Boolean(node && !inspected)}
      error={Boolean(inspected && !inspected.result)} onDismiss={() => select(null)} onOpenEntry={onOpenEntry} />
  </div>;
}
