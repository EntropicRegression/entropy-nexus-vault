import { useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { NodeCrystal } from '../../shared/types';
import { matchesTerms, searchTerms } from '../../shared/node-search';
import styles from './Galaxy.module.css';

const limit = 8;

/**
 * Find a node by name on the galaxy overview (DESIGN.md §6.10.1). Matching is instant and uses the same rule as the
 * downstairs node search (shared/node-search.ts). Each result names where the node lives (a galaxy or nebula, the hub,
 * or the outer belt); picking one flies to that galaxy and opens the node's profile.
 * Keys: ↓ from the box into the results, ↑/↓ between them, Enter to pick, Esc clears the box (a second Esc goes on).
 */
export function GalaxyFinder({ crystals, placeOf, onPick }: {
  crystals: NodeCrystal[];
  placeOf: (nodeId: string) => string;
  onPick: (nodeId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();
  const results = useMemo(() => {
    const terms = searchTerms(query);
    if (!terms.length) return [];
    return crystals.filter((node) => matchesTerms(node.name, terms))
      .sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name, 'zh-Hant')).slice(0, limit);
  }, [crystals, query]);
  const open = searchTerms(query).length > 0;

  function move(event: KeyboardEvent, step: number) {
    const items = [...(box.current?.querySelectorAll<HTMLButtonElement>('[data-finder-result]') ?? [])];
    if (!items.length) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (index === -1) items[step > 0 ? 0 : items.length - 1].focus();
    else if (index + step < 0) box.current?.querySelector<HTMLInputElement>('input')?.focus();
    else items[Math.min(items.length - 1, index + step)].focus();
  }

  function pick(nodeId: string) {
    setQuery('');
    onPick(nodeId);
  }

  return <div ref={box} className={styles.finder} data-galaxy-finder=""
    onKeyDown={(event) => {
      if (event.key === 'ArrowDown') move(event, 1);
      else if (event.key === 'ArrowUp') move(event, -1);
      else if (event.key === 'Escape' && query) {
        event.stopPropagation();
        setQuery('');
        box.current?.querySelector<HTMLInputElement>('input')?.focus();
      }
    }}>
    <input type="search" value={query} placeholder="搜尋節點名稱…" aria-label="在星系中搜尋節點"
      role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
      onChange={(event) => setQuery(event.target.value)} />
    {open && <ul id={listId} className={styles.finderResults} aria-label="搜尋結果">
      {results.length === 0
        ? <li className={styles.finderEmpty} role="status">沒有名稱相符的節點。</li>
        : results.map((node) => <li key={node.nodeId}>
          <button type="button" data-finder-result={node.nodeId} onClick={() => pick(node.nodeId)}>
            <strong>{node.name}</strong><small>{placeOf(node.nodeId)}</small>
          </button>
        </li>)}
    </ul>}
  </div>;
}
