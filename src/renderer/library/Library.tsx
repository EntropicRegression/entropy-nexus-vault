import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { shelves } from '../../shared/shelves';
import type { Shelf } from '../../shared/shelves';
import type { DeskMode, FileVersion, MemoryEntry, MemoryEntryDetail, NodeCrystal, NodeHit } from '../../shared/types';
import { primaryStatus } from '../../shared/vault-actions';
import { dateLabel, deskNoteLabel, entryIdentifier, isOpenBookmark, isPending, projectDisplayName, shelfNames, tabNames, tabs } from './catalog';
import type { CatalogTab } from './catalog';
import { NodeMatches } from './NodeMatches';
import { AvatarSeals, HeatSlot, PreviousVersion, StatusMark } from './Paper';
import { ReadingDesk } from './ReadingDesk';
import { useDelayed } from './use-delayed';
import { legacyWriteMessage, useVaultWrites } from './use-vault-writes';
import type { Feedback, WriteRequest } from './use-vault-writes';
import { WriteFeedback, WriteNotices } from './WriteFeedback';
import styles from './Library.module.css';

const batchSize = 24;
const entryFilter = { includeSuperseded: true };

function mergeEntries(previous: MemoryEntry[] | null, incoming: MemoryEntry[]): MemoryEntry[] {
  if (!previous) return incoming;
  const oldEntries = new Map(previous.map((entry) => [entry.path, entry]));
  const merged = incoming.map((entry) => {
    const old = oldEntries.get(entry.path);
    return old && JSON.stringify(old) === JSON.stringify(entry) ? old : entry;
  });
  return previous.length === merged.length && merged.every((entry, index) => entry === previous[index]) ? previous : merged;
}

function isDraftNote(entry: MemoryEntry) {
  return isOpenBookmark(entry) || (entry.shelf !== 'bookmark' && entry.status === '未確認');
}

function useEntry(path: string | null, revision = 0) {
  const [result, setResult] = useState<{ path: string; entry: MemoryEntryDetail | null; revision: number; error?: boolean }>();
  const fetchId = useRef(0);
  useEffect(() => {
    if (!path) return;
    const requestId = ++fetchId.current;
    let current = true;
    const receive = (entry: MemoryEntryDetail | null) => {
      if (!current || requestId !== fetchId.current) return;
      setResult((previous) => ({
        path,
        revision,
        entry: entry ?? (previous?.path === path ? previous.entry : null),
        error: !entry,
      }));
    };
    void window.vault.readEntry(path).then(receive, () => receive(null));
    return () => { current = false; };
  }, [path, revision]);
  function applyStatus(request: Extract<WriteRequest, { kind: 'status' }>, version: FileVersion) {
    if (request.entry.path !== path) return;
    ++fetchId.current;
    setResult((previous) => {
      if (previous?.path !== path || !previous.entry) return previous;
      return { path, revision, entry: { ...previous.entry, ...version, status: request.status } };
    });
  }
  const resultForPath = path && result?.path === path ? result : null;
  const loading = Boolean(path && !resultForPath);
  const showLoading = useDelayed(loading ? path : null);
  return { entry: resultForPath?.entry ?? null, loading, showLoading, checking: Boolean(path && resultForPath?.revision !== revision),
    error: Boolean(resultForPath?.error), applyStatus };
}

function DraftBoard({ notes, feedback, onOpen, onWrite, onReload }: {
  notes: MemoryEntry[]; feedback: ReadonlyMap<string, Feedback>;
  onOpen: (path: string, trigger: HTMLButtonElement) => void; onWrite: (request: WriteRequest) => void;
  onReload: (request: WriteRequest) => void;
}) {
  const [limit, setLimit] = useState(batchSize);
  const bookmarks = notes.filter(isOpenBookmark).length;
  const pending = notes.filter((entry) => entry.status === '未確認' && entry.shelf !== 'bookmark').length;
  return <section className={styles.board} aria-labelledby="draft-board">
    <div className={styles.boardHeader}>
      <h2 id="draft-board">待核閱案頭</h2>
      <span aria-live="polite">待核閱 {pending} · 未完書籤 {bookmarks}</span>
    </div>
    {!notes.length ? <p className={styles.quiet}>目前沒有待核閱的卷宗。</p> : <div className={styles.notes}>
      {notes.slice(0, limit).map((entry) => {
        const state = feedback.get(entry.path);
        const status = primaryStatus(entry);
        const processed = entry.status === '已確認' || entry.status === '已完成';
        const locked = !entry.writable || !status || state?.phase === 'pending' ||
          (state?.phase === 'failure' && ['conflict', 'missing', 'legacy'].includes(state.reason));
        return <article key={entry.path} className={styles.note} data-processed={processed}>
        <div className={styles.noteMeta}><strong>{deskNoteLabel(entry)}</strong><span>{entryIdentifier(entry)}</span></div>
        <button type="button" className={styles.noteTitle} onClick={(event) => onOpen(entry.path, event.currentTarget)}>{entry.title}</button>
        <p className={styles.noteSummary}>{entry.summary}</p>
        <div className={styles.noteActions}>
          <button type="button" className={styles.paperButton} onClick={(event) => onOpen(entry.path, event.currentTarget)}>看詳情</button>
          <button type="button" className={styles.primaryButton} aria-disabled={locked} data-write-action={status || undefined}
            title={!entry.writable ? legacyWriteMessage : undefined}
            onClick={() => { if (!locked && status) onWrite({ kind: 'status', entry, status }); }}>
            {processed ? state?.phase === 'saved' ? state.text : '已處理' : isOpenBookmark(entry) ? '標為完成' : '確認'}
          </button>
        </div>
        {!entry.writable && <span className={styles.writeMessage}>{legacyWriteMessage}</span>}
        <WriteFeedback state={state} onRun={onWrite} onReload={onReload} />
        {processed && <span className={styles.stamp} aria-hidden="true">{entry.status === '已完成' ? '完成' : '收錄'}</span>}
      </article>;
      })}
      {notes.length > limit && <MoreEntries shown={limit} size={notes.length} label="顯示更多便箋"
        onMore={() => setLimit((previous) => previous + batchSize)} />}
    </div>}
  </section>;
}

interface CardProps {
  entry: MemoryEntry;
  active: boolean;
  selected: boolean;
  stackOpen: boolean;
  revision: number;
  nodes: ReadonlyMap<string, NodeCrystal>;
  onOpen: (path: string, trigger?: HTMLButtonElement) => void;
  onToggleStack: (path: string) => void;
  onFocus: (path: string) => void;
  onNode?: (node: NodeCrystal) => void;
}

const Plaque = memo(function Plaque({ entry, active, selected, stackOpen, revision, nodes, onOpen, onToggleStack, onFocus, onNode }: CardProps) {
  const stack = useEntry(stackOpen ? entry.path : null, revision);
  const previousButton = useRef<HTMLButtonElement>(null);
  return <article data-entry={entry.path} data-selected={selected} data-stack-root={stackOpen ? '' : undefined}
    className={styles.plaque + ' heat-' + entry.heat.level + ' ' + (stackOpen ? styles.stackOwner : '')}>
    <div className={styles.plaqueFace} data-shelf={entry.shelf}>
      <div className={styles.plaqueMeta}>
        <span>{entryIdentifier(entry)} · <StatusMark status={entry.status} /></span>
        {entry.shelf === 'case' && <time>{dateLabel(entry.updatedAt)}</time>}
      </div>
      <h3><button type="button" className={styles.plaqueTitle} data-entry-title="" tabIndex={active ? 0 : -1}
        onFocus={() => onFocus(entry.path)}
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
});

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
  /** Goes upstairs to this node (avatar seals, reading-desk name links, matched-node chips). */
  onNode?: (nodeId: string) => void;
  /** Issued after arriving downstairs; each requestId opens its entry at most once. */
  openRequest?: { path: string; requestId: number };
  active: boolean;
  refreshToken: number;
}

export function Library({ query, deskMode, onToggleMode, onNode, openRequest, active, refreshToken }: Props) {
  const [allEntries, setAllEntries] = useState<MemoryEntry[] | null>(null);
  const [nodes, setNodes] = useState<ReadonlyMap<string, NodeCrystal>>(new Map());
  const [loadError, setLoadError] = useState(false);
  const [reload, setReload] = useState(0);
  const [search, setSearch] = useState<{ query: string; entries: MemoryEntry[] | null }>();
  const [nodeHits, setNodeHits] = useState<{ query: string; hits: NodeHit[] }>();
  const consumedOpen = useRef(new Set<number>());
  const [tab, setTab] = useState<CatalogTab>('all');
  const [project, setProject] = useState('');
  const [limits, setLimits] = useState<Partial<Record<Shelf, number>>>({});
  const [cursor, setCursor] = useState<string>();
  const [selected, setSelected] = useState<string | null>(null);
  const [stack, setStack] = useState<string | null>(null);
  const [settledNotes, setSettledNotes] = useState<ReadonlySet<string>>(new Set());
  const savedPosition = useRef<{ path: string; top: number; trigger?: HTMLButtonElement } | null>(null);
  const restore = useRef(false);
  const nextFocus = useRef<string>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const selectedPath = useRef<string | null>(null);
  const firstTab = useRef<HTMLButtonElement>(null);
  const listRequest = useRef(0);
  const trimmed = query.trim();
  const revision = refreshToken + reload;
  const { applyStatus, ...detail } = useEntry(selected, revision);
  useLayoutEffect(() => { selectedPath.current = selected; }, [selected]);

  const writes = useVaultWrites((request, version) => {
    ++listRequest.current;
    const { entry } = request;
    if (request.kind === 'status') {
      if (isDraftNote(entry) && request.status !== '退回') setSettledNotes((previous) => new Set(previous).add(entry.path));
      if (request.status === '退回') clearSettledNote(entry.path);
      setAllEntries((previous) => previous?.map((item) => item.path === entry.path ? { ...item, ...version, status: request.status } : item) ?? null);
      applyStatus(request, version);
    } else if (request.kind === 'recycle') {
      clearSettledNote(entry.path);
      setAllEntries((previous) => previous?.filter((item) => item.path !== entry.path) ?? null);
      if (selectedPath.current === entry.path) closeEntry();
    } else {
      setAllEntries((previous) => previous && !previous.some((item) => item.path === entry.path) ? [...previous, { ...entry, ...version }] : previous);
    }
    setReload((value) => value + 1);
  });

  function clearSettledNote(path: string) {
    setSettledNotes((previous) => {
      if (!previous.has(path)) return previous;
      const next = new Set(previous);
      next.delete(path);
      return next;
    });
  }

  function reloadFromFailure(request: WriteRequest) {
    if (request.kind === 'restore') {
      void writes.reloadUndo(request);
      return;
    }
    if (selectedPath.current !== request.entry.path) openEntry(request.entry.path);
    writes.clearFeedback(request.entry.path);
    setReload((value) => value + 1);
  }

  useEffect(() => { setStack(null); }, [trimmed]);

  useEffect(() => {
    let current = true;
    const id = ++listRequest.current;
    void window.vault.listEntries(entryFilter).then(
      (entries) => {
        if (!current || id !== listRequest.current) return;
        setLoadError(false);
        setAllEntries((previous) => mergeEntries(previous, entries));
      },
      () => { if (current && id === listRequest.current) setLoadError(true); },
    );
    void window.vault.listCrystals().then(
      ({ crystals }) => {
        if (current) setNodes((previous) => previous.size === crystals.length &&
          crystals.every((node) => JSON.stringify(node) === JSON.stringify(previous.get(node.nodeId))) ?
          previous : new Map(crystals.map((node) => [node.nodeId, node])));
      },
      () => {},
    );
    return () => { current = false; };
  }, [revision]);

  useEffect(() => {
    if (!trimmed) return;
    let current = true;
    const timer = window.setTimeout(() => {
      const receive = (entries: MemoryEntry[] | null) => {
        if (current) setSearch({ query: trimmed, entries });
      };
      void window.vault.search(trimmed, entryFilter).then(receive, () => receive(null));
      const receiveNodes = (hits: NodeHit[]) => { if (current) setNodeHits({ query: trimmed, hits }); };
      void window.vault.searchNodes(trimmed).then(receiveNodes, () => receiveNodes([]));
    }, 120);
    return () => { current = false; window.clearTimeout(timer); };
  }, [trimmed, revision]);

  const searching = Boolean(trimmed && search?.query !== trimmed);
  const searchFailed = Boolean(trimmed && search?.query === trimmed && !search.entries);
  const showLoading = useDelayed(!allEntries && !loadError ? 'entries' : searching ? trimmed : null);
  const entryMap = useMemo(() => new Map(allEntries?.map((entry) => [entry.path, entry])), [allEntries]);
  const currentEntries = useMemo(() => (allEntries ?? []).filter((entry) => entry.shelf && !entry.superseded), [allEntries]);
  const notes = useMemo(() => currentEntries.filter((entry) => isDraftNote(entry) || settledNotes.has(entry.path))
    .sort((a, b) => b.updatedAt - a.updatedAt), [currentEntries, settledNotes]);
  const projects = useMemo(() => Array.from(new Map(currentEntries.filter((entry) => entry.projectId)
    .map((entry) => [entry.projectId, projectDisplayName(entry)]))).sort((a, b) => a[1].localeCompare(b[1], 'zh-TW')), [currentEntries]);
  const projectIndex = projects.findIndex(([id]) => id === project);
  const projectFilter = projectIndex < 0 ? '' : project;
  const groups = useMemo(() => {
    const results = trimmed && search?.query === trimmed ? new Set((search.entries ?? []).map((entry) => entry.path)) : null;
    const grouped = new Map(shelves.map((shelf) => [shelf, [] as MemoryEntry[]]));
    for (const entry of currentEntries) {
      if (results && !results.has(entry.path)) continue;
      if (!entry.shelf || entry.superseded || (projectFilter && entry.projectId !== projectFilter)) continue;
      if (tab === 'all' || tab === entry.shelf || (tab === 'pending' && isPending(entry))) grouped.get(entry.shelf)?.push(entry);
    }
    return [...grouped].map(([shelf, entries]) => ({ shelf, entries: entries.sort((a, b) => b.updatedAt - a.updatedAt) }));
  }, [currentEntries, trimmed, search, tab, projectFilter]);
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

  const openEntry = useCallback((path: string, trigger?: HTMLButtonElement) => {
    if (!savedPosition.current || trigger) savedPosition.current = { path, trigger, top: scroller.current?.scrollTop ?? 0 };
    setStack(null);
    setSelected(path);
  }, []);
  const toggleStack = useCallback((path: string) => setStack((current) => current === path ? null : path), []);
  const goToNode = useCallback((node: NodeCrystal) => onNode?.(node.nodeId), [onNode]);
  const nodeLink = onNode ? goToNode : undefined;

  // Leaving the floor closes the reading desk and any open stack; focus is handed to the other floor.
  useEffect(() => {
    if (active) return;
    restore.current = false;
    savedPosition.current = null;
    setSelected(null);
    setStack(null);
  }, [active]);

  useEffect(() => {
    if (!active || !openRequest || !allEntries || consumedOpen.current.has(openRequest.requestId)) return;
    consumedOpen.current.add(openRequest.requestId);
    if (allEntries.some((entry) => entry.path === openRequest.path)) openEntry(openRequest.path);
  }, [active, openRequest, allEntries, openEntry]);

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

  function moveCard(event: KeyboardEvent<HTMLDivElement>) {
    if (deskMode === 'A' && selected) return;
    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || !target.hasAttribute('data-entry-title')) return;
    const path = target.closest<HTMLElement>('[data-entry]')?.dataset.entry;
    if (!path) return;
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
    <div className={styles.libraryWorkspace} data-library-workspace="">
    <div className={styles.libraryPanel} ref={scroller} aria-label="藏書架" onKeyDown={moveCard} inert={selected !== null && deskMode === 'A'}>
      {allEntries && <DraftBoard notes={notes} onOpen={openEntry} feedback={writes.feedback} onWrite={writes.run} onReload={reloadFromFailure} />}
      <div className={styles.filters}>
        <div className={styles.tabs} role="group" aria-label="卷宗類別">
          {tabs.map((item) => <button ref={item === 'all' ? firstTab : undefined} type="button" key={item}
            aria-pressed={tab === item} onClick={() => { setTab(item); setStack(null); }}>{tabNames[item]}</button>)}
        </div>
        <div className={styles.projects}>
          <label>書閣 <select value={projectIndex < 0 ? '' : String(projectIndex + 1)}
            onChange={(event) => { setProject(projects[Number(event.target.value) - 1]?.[0] ?? ''); setStack(null); }}>
            <option value="">全部</option>
            {projects.map(([id, label], index) => <option key={id} value={index + 1}>{label}</option>)}
          </select></label>
          <span aria-live="polite">凡 {total} 卷</span>
        </div>
      </div>
      {trimmed && nodeHits?.query === trimmed && onNode &&
        <NodeMatches key={trimmed} hits={nodeHits.hits} onNode={onNode} />}
      <div className={styles.shelves} aria-busy={(!allEntries && !loadError) || searching}>
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
              revision={entry.path === stack ? revision : 0} nodes={nodes} onOpen={openEntry} onToggleStack={toggleStack}
              onFocus={setCursor} onNode={nodeLink} />)}
          </div>
          {entries.length > (limits[shelf] ?? batchSize) &&
            <MoreEntries shown={limits[shelf] ?? batchSize} size={entries.length} onMore={() => more(shelf)} />}
        </section>)}
      </div>
    </div>
    {selected && <ReadingDesk deskMode={deskMode} selectedPath={selected} entries={entryMap} nodes={nodes}
      onOpen={openEntry} onClose={closeEntry} onToggleMode={onToggleMode} onNode={nodeLink}
      writeState={writes.feedback.get(selected)} onWrite={writes.run} onReload={reloadFromFailure} {...detail} />}
    </div>
    <WriteNotices notices={writes.notices} feedback={writes.feedback} onRun={writes.run} onReload={reloadFromFailure} dismiss={writes.dismiss} />
  </div>;
}
