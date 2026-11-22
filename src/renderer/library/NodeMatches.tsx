import { useState } from 'react';
import type { NodeHit } from '../../shared/types';
import { usePortraitChain } from '../brand/brand-portrait';
import styles from './Library.module.css';

const shown = 6;

function Chip({ hit, onNode }: { hit: NodeHit; onNode: (nodeId: string) => void }) {
  // Same order as the seals on cards: the node's avatar → its brand default (when a folder is set) → first character.
  const { current, generation, fail } = usePortraitChain(hit, 'avatar');
  const initial = Array.from(hit.name.trim())[0]?.toUpperCase() || '？';
  return <button type="button" className={styles.nodeChip} data-node-hit={hit.nodeId}
    title={'符合：' + hit.matchedIn} onClick={() => onNode(hit.nodeId)}>
    <span className={styles.seal} aria-hidden="true">
      {current ? <img key={current.url + '#' + generation} src={current.url} alt="" width="20" height="20"
        data-portrait-source={current.source} onError={() => fail(current.url)} /> : initial}
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
