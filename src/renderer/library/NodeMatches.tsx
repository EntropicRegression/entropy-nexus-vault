import { useState } from 'react';
import type { NodeHit } from '../../shared/types';
import styles from './Library.module.css';

const shown = 6;

function Chip({ hit, onNode }: { hit: NodeHit; onNode: (nodeId: string) => void }) {
  const [failed, setFailed] = useState<string>();
  const source = hit.avatarUrl && failed !== hit.avatarUrl ? hit.avatarUrl : null;
  const initial = Array.from(hit.name.trim())[0]?.toUpperCase() || '？';
  return <button type="button" className={styles.nodeChip} data-node-hit={hit.nodeId}
    title={'符合：' + hit.matchedIn} onClick={() => onNode(hit.nodeId)}>
    <span className={styles.seal} aria-hidden="true">
      {source ? <img src={source} alt="" width="20" height="20" onError={() => setFailed(source)} /> : initial}
    </span>
    <span className={styles.nodeChipName}>{hit.name}</span>
    <span className={styles.nodeChipStatus}>{hit.status}</span>
  </button>;
}

/** DESIGN.md §6.6.3: a slim row between the filters and the shelves; hidden when no node matches. */
export function NodeMatches({ hits, onNode }: { hits: NodeHit[]; onNode: (nodeId: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  if (!hits.length) return null;
  const visible = expanded ? hits : hits.slice(0, shown);
  return <section className={styles.nodeMatches} aria-label="相符的節點">
    <h2>相符的節點（{hits.length}）</h2>
    <div className={styles.nodeChips}>
      {visible.map((hit) => <Chip key={hit.nodeId} hit={hit} onNode={onNode} />)}
      {hits.length > shown && !expanded && <button type="button" className={styles.nodeMore}
        aria-label={'再顯示 ' + (hits.length - shown) + ' 個節點'} onClick={() => setExpanded(true)}>+{hits.length - shown}</button>}
    </div>
  </section>;
}
