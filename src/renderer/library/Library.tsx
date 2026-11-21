import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { shelves } from '../../shared/shelves';
import type { Shelf } from '../../shared/shelves';
import type { DeskMode, MemoryEntry, MemoryEntryDetail, NodeCrystal } from '../../shared/types';
import { dateLabel, deskNoteLabel, entryIdentifier, isOpenBookmark, isPending, shelfNames, tabNames, tabs, writeLater } from './catalog';
import type { CatalogTab } from './catalog';
import { AvatarSeals, HeatSlot, PreviousVersion, StatusMark } from './Paper';
import { ReadingDesk } from './ReadingDesk';
import { useDelayed } from './use-delayed';
import styles from './Library.module.css';

const batchSize = 24;
const entryFilter = { includeSuperseded: true };

function useEntry(path: string | null) {
  const [result, setResult] = useState<{ path: string; entry: MemoryEntryDetail | null }>();
  useEffect(() => {
    if (!path) return;
    let current = true;
    const receive = (entry: MemoryEntryDetail | null) => {
      if (current) setResult({ path, entry });
    };
    setResult(undefined);
    void window.vault.readEntry(path).then(receive, () => receive(null));
    return () => { current = false; };
  }, [path]);
  const resultForPath = path && result?.path === path ? result : null;
  const loading = Boolean(path && !resultForPath);
  const showLoading = useDelayed(loading ? path : null);
  return { entry: resultForPath?.entry ?? null, loading, showLoading, error: Boolean(resultForPath && !resultForPath.entry) };
}

function DraftBoard({ notes, onOpen }: { notes: MemoryEntry[]; onOpen: (path: string, trigger: HTMLButtonElement) => void }) {
  const [limit, setLimit] = useState(batchSize);
  const bookmarks = notes.filter(isOpenBookmark).length;
  return <section className={styles.board} aria-labelledby="draft-board">
    <div className={styles.boardHeader}>
      <h2 id="draft-board">待核閱案頭</h2>
      <span>待核閱 {notes.length - bookmarks} · 未完書籤 {bookmarks}</span>
    </div>
    {!notes.length ? <p className={styles.quiet}>目前沒有待核閱的卷宗。</p> : <div className={styles.notes}>
      {notes.slice(0, limit).map((entry) => <article key={entry.path} className={styles.note}>
        <div className={styles.noteMeta}><strong>{deskNoteLabel(entry)}</strong><span>{entryIdentifier(entry)}</span></div>
        <button type="button" className={styles.noteTitle} onClick={(event) => onOpen(entry.path, event.currentTarget)}>{entry.title}</button>
        <p>{entry.summary}</p>
        <div className={styles.noteActions}>
          <button type="button" className={styles.paperButton} onClick={(event) => onOpen(entry.path, event.currentTarget)}>看詳情</button>
          <span title={writeLater}>
            <button type="button" className={styles.primaryButton} disabled aria-describedby="draft-readonly">
              {isOpenBookmark(entry) ? '標為完成' : '確認'}
            </button>
          </span>
        </div>
      </article>)}
      {notes.length > limit && <MoreEntries shown={limit} size={notes.length} label="顯示更多便箋"
        onMore={() => setLimit((previous) => previous + batchSize)} />}
    </div>}
    <span id="draft-readonly" className={styles.srOnly}>{writeLater}</span>
  </section>;
}

interface CardProps {
  entry: MemoryEntry;
  active: boolean;
  selected: boolean;
  stackOpen: boolean;
  nodes: ReadonlyMap<string, NodeCrystal>;
  onOpen: (path: string, trigger?: HTMLButtonElement) => void;
  onToggleStack: (path: string) => void;
  onFocus: (path: string) => void;
  onMove: (event: KeyboardEvent<HTMLButtonElement>, path: string) => void;
  onNode: (node: NodeCrystal) => void;
}

function Plaque({ entry, active, selected, stackOpen, nodes, onOpen, onToggleStack, onFocus, onMove, onNode }: CardProps) {
  const stack = useEntry(stackOpen ? entry.path : null);
  const previousButton = useRef<HTMLButtonElement>(null);
  return <article data-entry={entry.path} data-selected={selected} data-stack-root={stackOpen ? '' : undefined}
    className={styles.plaque + ' heat-' + entry.heat.level + ' ' + (stackOpen ? styles.stackOwner : '')}>
    <div className={styles.plaqueFace} data-shelf={entry.shelf}>
      <div className={styles.plaqueMeta}>
        <span>{entryIdentifier(entry)} · <StatusMark status={entry.status} /></span>
        {entry.shelf === 'case' && <time>{dateLabel(entry.updatedAt)}</time>}
      </div>
      <h3><button type="button" className={styles.plaqueTitle} data-entry-title="" tabIndex={active ? 0 : -1}
        onFocus={() => onFocus(entry.path)} onKeyDown={(event) => onMove(event, entry.path)}
        onClick={(event) => onOpen(entry.path, event.currentTarget)}>{entry.title}</button></h3>
      <p className={styles.plaqueSummary}>{entry.summary}</p>
      <div className={styles.plaqueFooter}>
        <HeatSlot heat={entry.heat} />
        <div className={styles.plaqueActions}>
          <AvatarSeals entry={entry} nodes={nodes} onNode={onNode} />
          {entry.previousCount > 0 && <button type="button" ref={previousButton} aria-expanded={stackOpen} className={styles.previousButton}
            onClick={() => onToggleStack(entry.path)}>前版 ×{entry.previousCount}</button>}
        </div>
      </div>
    </div>
    {stackOpen && <div className={styles.stack} role="region" aria-label="前版卷宗">
      {stack.showLoading && <p role="status">正在翻閱…</p>}
      {stack.error && <p role="alert">無法讀取前版卷宗。</p>}
      {stack.entry && <ul>{stack.entry.supersessionChain.map((link) => <li key={link.path}>
        <PreviousVersion link={link} onOpen={(path) => onOpen(path, previousButton.current ?? undefined)} />
      </li>)}</ul>}
    </div>}
  </article>;
}

function MoreEntries({ shown, size, label = '顯示更多卷宗', onMore }: { shown: number; size: number; label?: string; onMore: () => void }) {
  const sentinel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!sentinel.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        observer.disconnect();
        onMore();
      }
    }, { rootMargin: '100px' });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [onMore, shown]);
  return <button type="button" ref={sentinel} className={styles.more} onClick={onMore}>{label}（{shown}／{size}）</button>;
}

interface Props {
  query: string;
  deskMode: DeskMode;
  onToggleMode: () => void;
  onNode: (node: NodeCrystal) => void;
  active: boolean;
}

export function Library({ query, deskMode, onToggleMode, onNode, active }: Props) {
  const [allEntries, setAllEntries] = useState<MemoryEntry[] | null>(null);
  const [nodes, setNodes] = useState<ReadonlyMap<string, NodeCrystal>>(new Map());
  const [loadError, setLoadError] = useState(false);
  const [reload, setReload] = useState(0);
  const [search, setSearch] = useState<{ query: string; entries: MemoryEntry[] | null }>();
  const [tab, setTab] = useState<CatalogTab>('all');
  const [project, setProject] = useState('');
  const [limits, setLimits] = useState<Partial<Record<Shelf, number>>>({});
  const [cursor, setCursor] = useState<string>();
  const [selected, setSelected] = useState<string | null>(null);
  const [stack, setStack] = useState<string | null>(null);
  const savedPosition = useRef<{ path: string; top: number; trigger?: HTMLButtonElement } | null>(null);
  const restore = useRef(false);
  const nextFocus = useRef<string>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const firstTab = useRef<HTMLButtonElement>(null);
  const trimmed = query.trim();
  const detail = useEntry(selected);

  useEffect(() => { setStack(null); }, [trimmed]);

  useEffect(() => {
    let current = true;
    void window.vault.listEntries(entryFilter).then(
      (entries) => { if (current) setAllEntries(entries); },
      () => { if (current) setLoadError(true); },
    );
    void window.vault.listCrystals().then(
      ({ crystals }) => { if (current) setNodes(new Map(crystals.map((node) => [node.nodeId, node]))); },
      () => { if (current) setNodes(new Map()); },
    );
    return () => { current = false; };
  }, [reload]);

  useEffect(() => {
    if (!trimmed) return;
    let current = true;
    const timer = window.setTimeout(() => {
      const receive = (entries: MemoryEntry[] | null) => {
        if (current) setSearch({ query: trimmed, entries });
      };
      void window.vault.search(trimmed, entryFilter).then(receive, () => receive(null));
    }, 120);
    return () => { current = false; window.clearTimeout(timer); };
  }, [trimmed, reload]);

  const searching = Boolean(trimmed && search?.query !== trimmed);
  const searchFailed = Boolean(trimmed && search?.query === trimmed && !search.entries);
  const showLoading = useDelayed(!allEntries && !loadError ? 'entries' : searching ? trimmed : null);
  const entryMap = useMemo(() => new Map(allEntries?.map((entry) => [entry.path, entry])), [allEntries]);
  const currentEntries = useMemo(() => (allEntries ?? []).filter((entry) => entry.shelf && !entry.superseded), [allEntries]);
  const notes = useMemo(() => currentEntries.filter((entry) => isOpenBookmark(entry) ||
    (entry.shelf !== 'bookmark' && entry.status === '未確認')).sort((a, b) => b.updatedAt - a.updatedAt), [currentEntries]);
  const projects = useMemo(() => Array.from(new Map(currentEntries.filter((entry) => entry.projectId)
    .map((entry) => [entry.projectId, entry.projectName || entry.projectId]))).sort((a, b) => a[1].localeCompare(b[1], 'zh-TW')), [currentEntries]);
  const groups = useMemo(() => {
    const matching = trimmed && search?.query === trimmed ? search.entries ?? [] : currentEntries;
    const grouped = new Map(shelves.map((shelf) => [shelf, [] as MemoryEntry[]]));
    for (const entry of matching) {
      if (!entry.shelf || entry.superseded || (project && entry.projectId !== project)) continue;
      if (tab === 'all' || tab === entry.shelf || (tab === 'pending' && isPending(entry))) grouped.get(entry.shelf)?.push(entry);
    }
    return [...grouped].map(([shelf, entries]) => ({ shelf, entries: entries.sort((a, b) => b.updatedAt - a.updatedAt) }));
  }, [currentEntries, trimmed, search, tab, project]);
  const total = groups.reduce((sum, group) => sum + group.entries.length, 0);
  const firstCard = groups.find((group) => group.entries.length)?.entries[0].path;
  const activeCard = cursor && groups.some((group) => group.entries.slice(0, limits[group.shelf] ?? batchSize)
    .some((entry) => entry.path === cursor)) ? cursor : firstCard;

  function focusCard(path: string) {
    const card = Array.from(scroller.current?.querySelectorAll<HTMLElement>('[data-entry]') ?? [])
      .find((item) => item.dataset.entry === path)?.querySelector<HTMLButtonElement>('[data-entry-title]');
    card?.focus({ preventScroll: restore.current });
    return Boolean(card);
  }

  function openEntry(path: string, trigger?: HTMLButtonElement) {
    if (!selected || trigger) savedPosition.current = { path, trigger, top: scroller.current?.scrollTop ?? 0 };
    setStack(null);
    setSelected(path);
  }

  function closeEntry() {
    restore.current = true;
    setSelected(null);
  }

  useLayoutEffect(() => {
    if (!selected && restore.current) {
      const position = savedPosition.current;
      if (scroller.current && position) scroller.current.scrollTop = position.top;
      if (position?.trigger?.isConnected) position.trigger.focus({ preventScroll: true });
      else if (!position || !focusCard(position.path)) firstTab.current?.focus({ preventScroll: true });
      restore.current = false;
      savedPosition.current = null;
    }
    if (nextFocus.current && focusCard(nextFocus.current)) nextFocus.current = null;
  });

  function moveCard(event: KeyboardEvent<HTMLButtonElement>, path: string) {
    if (deskMode === 'A' && selected) return;
    const delta: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 };
    if (!(event.key in delta)) return;
    event.preventDefault();
    const ordered = groups.flatMap((group) => group.entries);
    const next = ordered[ordered.findIndex((entry) => entry.path === path) + delta[event.key]];
    if (!next?.shelf) return;
    const shelf = next.shelf;
    const index = groups.find((group) => group.shelf === shelf)!.entries.indexOf(next);
    if (index >= (limits[shelf] ?? batchSize)) {
      setLimits((previous) => ({ ...previous, [shelf]: index + batchSize }));
      nextFocus.current = next.path;
    } else {
      focusCard(next.path);
    }
  }

  useEffect(() => {
    if (!active || (!selected && !stack)) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (stack) {
          document.activeElement?.closest('[data-stack-root]')?.querySelector<HTMLButtonElement>('button[aria-expanded]')
            ?.focus({ preventScroll: true });
          setStack(null);
        }
        else {
          restore.current = true;
          setSelected(null);
        }
      }
    };
    const onPointer = (event: PointerEvent) => {
      if (stack && event.target instanceof Element && !event.target.closest('[data-stack-root]')) setStack(null);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer);
    };
  }, [active, selected, stack]);

  function more(shelf: Shelf) {
    setLimits((previous) => ({ ...previous, [shelf]: (previous[shelf] ?? batchSize) + batchSize }));
  }

  return <div className={styles.library} data-side={Boolean(selected && deskMode === 'B')}>
    <svg className={styles.grain} aria-hidden="true" width="0" height="0">
      <filter id="paperGrain"><feTurbulence type="fractalNoise" baseFrequency=".84" numOctaves="3" stitchTiles="stitch" />
        <feColorMatrix type="saturate" values="0" /></filter>
    </svg>
    <div className={styles.libraryPanel} inert={selected !== null && deskMode === 'A'}>
      {allEntries && <DraftBoard notes={notes} onOpen={openEntry} />}
      <div className={styles.filters}>
        <div className={styles.tabs} role="group" aria-label="卷宗類別">
          {tabs.map((item) => <button ref={item === 'all' ? firstTab : undefined} type="button" key={item}
            aria-pressed={tab === item} onClick={() => { setTab(item); setStack(null); }}>{tabNames[item]}</button>)}
        </div>
        <div className={styles.projects}>
          <label>書閣 <select value={project} onChange={(event) => { setProject(event.target.value); setStack(null); }}>
            <option value="">全部</option>
            {projects.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select></label>
          <span aria-live="polite">凡 {total} 卷</span>
        </div>
      </div>
      <div className={styles.shelves} ref={scroller} aria-label="藏書架" aria-busy={(!allEntries && !loadError) || searching}>
        {showLoading && <p className={styles.message} role="status">正在翻閱…</p>}
        {(loadError || searchFailed) && <div className={styles.message} role="alert">
          <p>{loadError ? '無法讀取藏書架。' : '無法檢索卷宗。'}</p>
          <button type="button" onClick={() => { setLoadError(false); setSearch(undefined); setReload((value) => value + 1); }}>重試</button>
        </div>}
        {allEntries && !currentEntries.length && <div className={styles.message}>
          <h2>這裡還沒有任何記憶</h2><p>在 Entropy Nexus 主控台寫入記憶後，卷宗會出現在這裡。</p>
        </div>}
        {allEntries && currentEntries.length > 0 && !total && !searching && !searchFailed &&
          <p className={styles.message} role="status">書架上暫無符合條件之卷宗。</p>}
        {groups.map(({ shelf, entries }) => entries.length > 0 && <section key={shelf} className={styles.shelf} aria-labelledby={'shelf-' + shelf}>
          <h2 id={'shelf-' + shelf}><span>{shelfNames[shelf]}書架</span></h2>
          <div className={styles.grid}>
            {entries.slice(0, limits[shelf] ?? batchSize).map((entry) => <Plaque key={entry.path} entry={entry}
              active={entry.path === activeCard} selected={entry.path === selected} stackOpen={entry.path === stack}
              nodes={nodes} onOpen={openEntry} onToggleStack={(path) => setStack(stack === path ? null : path)}
              onFocus={setCursor} onMove={moveCard} onNode={onNode} />)}
          </div>
          {entries.length > (limits[shelf] ?? batchSize) &&
            <MoreEntries shown={limits[shelf] ?? batchSize} size={entries.length} onMore={() => more(shelf)} />}
        </section>)}
      </div>
    </div>
    {selected && <ReadingDesk deskMode={deskMode} selectedPath={selected} entries={entryMap} nodes={nodes}
      onOpen={openEntry} onClose={closeEntry} onToggleMode={onToggleMode} onNode={onNode} {...detail} />}
  </div>;
}
