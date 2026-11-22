import type { MouseEvent } from 'react';
import type { NodeCrystal } from '../../shared/types';
import constellation from '../../../assets/ui/constellation.svg';
import { usePortraitChain } from '../brand/brand-portrait';
import { PrismCrystal } from './PrismCrystal';
import styles from './Sky.module.css';

/**
 * The crystal's picture: the node's portrait → its avatar → the brand default (when a folder is set) → the bundled
 * constellation glyph; each load error moves one step down (docs/架構.md §4.2).
 */
export function CrystalPortrait({ node }: { node: Pick<NodeCrystal, 'portraitUrl' | 'avatarUrl' | 'brand'> }) {
  const { current, generation, fail } = usePortraitChain(node);
  if (!current) return <img src={constellation} alt="" decoding="async" data-portrait="constellation" />;
  // Keyed by folder generation: after choosing the folder again the same brand URL is requested afresh.
  return <img key={current.url + '#' + generation} src={current.url} alt="" decoding="async"
    data-portrait="image" data-portrait-source={current.source} onError={() => fail(current.url)} />;
}

export function crystalBadge(node: Pick<NodeCrystal, 'status' | 'canWake'>) {
  if (node.status === '線上') return { text: '● 現役', style: styles.badgeOnline };
  if (node.status === '休眠') return { text: '● 休眠', style: styles.badgeDormant };
  if (node.status === '未知') return { text: '◌ 狀態未知', style: styles.badgeUnknown };
  return node.canWake ? { text: '✦ 封存 · 可喚醒', style: styles.badgeWake } :
    { text: '◇ 封存 · 純紀念', style: styles.badgeMemorial };
}

export function Crystal({ node, index, selected, setAnchor, onClick }: {
  node: NodeCrystal; index: number; selected: boolean;
  setAnchor: (element: HTMLDivElement | null) => void; onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const badge = crystalBadge(node);
  return <div ref={setAnchor} className={styles.nodeAnchor} data-crystal-anchor={node.nodeId}>
    <button className={styles.crystal} data-crystal={node.nodeId} data-archived={node.status === '封存'} data-status={node.status} data-glow={node.glow ?? 'white'}
      type="button" aria-pressed={selected} aria-label={node.name + ' ' + badge.text} onClick={onClick}>
      <PrismCrystal node={node} glow={node.glow ?? 'white'} />
      <span className={styles.crystalLabel} data-crystal-label="" title={node.name}>
        <strong>{node.name}</strong>
        <span className={styles.crystalBadge + ' ' + badge.style}>{badge.text}</span>
      </span>
    </button>
  </div>;
}
