import { useEffect, useRef } from 'react';
import type { NodeCrystal } from '../../shared/types';
import { crystalBadge } from './Crystal';
import { PrismCrystal } from './PrismCrystal';
import { trapTab } from './SkyDialog';
import styles from './Galaxy.module.css';

export const rainbowEmptyText = '目前還沒有頒發彩虹的節點。彩虹由你在節點履歷欄親手頒發。';

/**
 * The rainbow showcase (DESIGN.md §6.10.1): rainbow is awarded by hand, so it is not a filter colour but has its own
 * large panel. Every rainbow node is shown as a prismatic crystal with the rainbow aura (its slow turn stops under low
 * motion — the scene's data-quiet). Picking a node closes the panel and opens its profile. Esc closes; focus returns.
 */
export function RainbowShowcase({ nodes, onPick, onClose }: {
  nodes: NodeCrystal[];
  onPick: (nodeId: string) => void;
  onClose: () => void;
}) {
  const card = useRef<HTMLDivElement>(null);
  // Focus the first rainbow node; with none, the close button.
  useEffect(() => {
    (card.current?.querySelector<HTMLElement>('[data-rainbow-node]') ?? card.current?.querySelector<HTMLElement>('[data-rainbow-close]'))
      ?.focus({ preventScroll: true });
  }, []);
  return <div className={styles.showcaseVeil} data-rainbow-showcase=""
    onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return; }
      trapTab(event, card.current);
    }}
    onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={card} className={styles.showcase} role="dialog" aria-modal="true" aria-label="彩虹節點展示">
      <header className={styles.showcaseHeader}>
        <h2>✦ 彩虹節點 <small>{nodes.length ? nodes.length + ' 個 · 由你親手頒發' : '由你親手頒發'}</small></h2>
        <button type="button" data-rainbow-close="" onClick={onClose}>關閉(Esc)</button>
      </header>
      {nodes.length === 0
        ? <p className={styles.showcaseEmpty} data-rainbow-empty="">{rainbowEmptyText}</p>
        : <ul className={styles.showcaseGrid}>
          {nodes.map((node) => <li key={node.nodeId}>
            <button type="button" className={styles.showcaseNode} data-rainbow-node={node.nodeId}
              aria-label={node.name + ',' + crystalBadge(node).text + ',開啟履歷'} onClick={() => onPick(node.nodeId)}>
              <PrismCrystal node={node} glow="rainbow" />
              <span className={styles.showcaseName}><strong>{node.name}</strong><small>{crystalBadge(node).text}</small></span>
            </button>
          </li>)}
        </ul>}
    </div>
  </div>;
}
