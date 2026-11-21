import { useMemo, useRef } from 'react';
import type { CrystalList } from '../../shared/types';
import { initialCamera } from '../../shared/projection';
import { Armillary } from './Armillary';
import { Crystal } from './Crystal';
import type { FrameClock } from './frame-clock';
import { LinkCanvas } from './LinkCanvas';
import { LinkFilter } from './LinkFilter';
import { toLinkSegments } from './link-styles';
import type { LinkKind } from './link-styles';
import { useStarMapCamera } from './useStarMapCamera';
import { useStarMapFrame } from './useStarMapFrame';
import styles from './Sky.module.css';

export function StarMap({ active, data, selected, visible, onToggle, onSelect, clock }: {
  active: boolean; data: CrystalList; selected: string | null; visible: ReadonlySet<LinkKind>;
  onToggle: (kind: LinkKind) => void; onSelect: (id: string | null) => void; clock: FrameClock;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const armillary = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const nodes = useRef(new Map<string, HTMLDivElement>());
  const camera = useRef({ ...initialCamera });
  const positions = useMemo(() => new Map(data.crystals.map(({ nodeId, position }) => [nodeId, position])), [data.crystals]);
  const connections = useMemo(() => toLinkSegments(data.links, new Set(positions.keys())), [data.links, positions]);
  const demandFrame = useStarMapFrame({ active, stage, armillary, canvas, nodes, camera, positions, connections, visible, selected, clock });
  const interaction = useStarMapCamera(stage, camera, demandFrame, active);

  return <div ref={stage} role="region" aria-label="星圖舞台" aria-describedby="sky-map-controls" tabIndex={0} data-star-map=""
    className={styles.gameFrame + ' ' + styles.mapStage} {...interaction.handlers}
    onClick={(event) => {
      if (interaction.canClick(event) && !(event.target instanceof Element && event.target.closest('[data-map-controls]'))) onSelect(null);
    }}>
    <p id="sky-map-controls" className={styles.stageCaption}>
      ✦ 3D 星圖休眠庫｜拖曳旋轉・滾輪縮放・點擊水晶展開履歷
      <span>鍵盤：方向鍵旋轉 · +/− 縮放 · 0 重設</span>
    </p>
    <LinkFilter visible={visible} onToggle={onToggle} />
    <Armillary armillaryRef={armillary} />
    <LinkCanvas canvasRef={canvas} />
    <div className={styles.crystalLayer}>{data.crystals.map((node, index) => <Crystal key={node.nodeId} node={node} index={index}
      selected={selected === node.nodeId} setAnchor={(element) => {
        if (element) nodes.current.set(node.nodeId, element);
        else nodes.current.delete(node.nodeId);
      }} onClick={(event) => {
        event.stopPropagation();
        if (interaction.canClick(event)) onSelect(node.nodeId === selected ? null : node.nodeId);
      }} />)}</div>
  </div>;
}
