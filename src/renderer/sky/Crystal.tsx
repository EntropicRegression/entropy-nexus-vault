import { useState } from 'react';
import type { MouseEvent } from 'react';
import type { NodeCrystal } from '../../shared/types';
import constellation from '../../../assets/ui/constellation.svg';
import styles from './Sky.module.css';

export function CrystalPortrait({ src }: { src?: string | null }) {
  const [failed, setFailed] = useState<string | null>(null);
  const portrait = Boolean(src && failed !== src);
  return <img src={portrait ? src! : constellation} alt="" decoding="async"
    data-portrait={portrait ? 'image' : 'constellation'}
    onError={portrait ? () => setFailed(src!) : undefined} />;
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
    <button className={styles.crystal} data-crystal={node.nodeId} data-archived={node.status === '封存'}
      type="button" aria-pressed={selected} aria-label={node.name + ' ' + badge.text} onClick={onClick}>
      <span className={styles.crystalAura} aria-hidden="true" />
      <span className={styles.crystalShape} style={{ animationDelay: index * 0.6 + 's' }}>
        <CrystalPortrait src={node.portraitUrl} />
        <span className={styles.crystalFacet} aria-hidden="true" />
      </span>
      <span className={styles.crystalPedestal} aria-hidden="true" />
      <span className={styles.crystalLabel} data-crystal-label="" title={node.name}>
        <strong>{node.name}</strong>
        <span className={styles.crystalBadge + ' ' + badge.style}>{badge.text}</span>
      </span>
    </button>
  </div>;
}
