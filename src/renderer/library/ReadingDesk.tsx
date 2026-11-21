import { useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { DeskMode, MemoryEntry, MemoryEntryDetail, NodeCrystal } from '../../shared/types';
import { canSetStatus, primaryStatus } from '../../shared/vault-actions';
import { categoryLabel, dateLabel, entryIdentifier, isProjectIdAttribute, projectDisplayName } from './catalog';
import { HeatSlot, nodeName, PreviousVersion, StatusMark } from './Paper';
import type { Feedback, WriteRequest } from './use-vault-writes';
import { legacyWriteMessage } from './use-vault-writes';
import { WriteFeedback } from './WriteFeedback';
import styles from './Library.module.css';

type OpenEntry = (path: string) => void;

function inline(text: string, related: ReadonlyMap<string, string>, open: OpenEntry): ReactNode[] {
  return text.split(/(\[\[\d{4}-\d{4}(?:\|[^\]]+)?\]\]|\*\*[^*]+\*\*|\x60[^\x60]+\x60)/g).map((part, i) => {
    if (part.startsWith('[[') && part.endsWith(']]')) {
      const [id, label = id] = part.slice(2, -2).split('|');
      const path = related.get(id);
      return path ? <button type="button" className={styles.inlineLink} key={i} onClick={() => open(path)}>{label}</button> : part;
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (/^\x60[^\x60]+\x60$/.test(part)) return <code key={i}>{part.slice(1, -1)}</code>;
    return part;
  });
}

/** Render repository Markdown as text/components without allowing HTML, remote loads or arbitrary links. */
function Markdown({ body, related, onOpen }: { body: string; related: ReadonlyMap<string, string>; onOpen: OpenEntry }) {
  const lines = body.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let index = 0;
  const boundary = /^\s*(?:#{1,6}\s|\x60{3,}|~{3,}|[-*+]\s+|\d+\.\s+|>\s?)/;
  while (index < lines.length) {
    const first = lines[index].trim();
    const key = index++;
    if (!first) continue;
    const fence = /^(\x60{3,}|~{3,})/.exec(first);
    if (fence) {
      const code: string[] = [];
      while (index < lines.length && !lines[index].trim().startsWith(fence[1])) code.push(lines[index++]);
      if (index < lines.length) index++;
      blocks.push(<pre key={key}><code>{code.join('\n')}</code></pre>);
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(first);
    if (heading) {
      const Heading = heading[1].length <= 2 ? 'h3' : 'h4';
      blocks.push(<Heading key={key}>{inline(heading[2], related, onOpen)}</Heading>);
      continue;
    }
    const marker = /^(?:[-*+]|\d+\.)\s+/.exec(first);
    if (marker) {
      const pattern = /^\d/.test(marker[0]) ? /^\s*\d+\.\s+/ : /^\s*[-*+]\s+/;
      const List = /^\d/.test(marker[0]) ? 'ol' : 'ul';
      const items = [first.replace(pattern, '')];
      while (index < lines.length && pattern.test(lines[index])) items.push(lines[index++].replace(pattern, ''));
      blocks.push(<List key={key}>{items.map((item, i) => <li key={i}>{inline(item, related, onOpen)}</li>)}</List>);
      continue;
    }
    if (first.startsWith('>')) {
      const quote = [first.replace(/^>\s?/, '')];
      while (index < lines.length && /^\s*>/.test(lines[index])) quote.push(lines[index++].trim().replace(/^>\s?/, ''));
      blocks.push(<blockquote key={key}>{inline(quote.join(' '), related, onOpen)}</blockquote>);
      continue;
    }
    const paragraph = [first];
    while (index < lines.length && lines[index].trim() && !boundary.test(lines[index])) paragraph.push(lines[index++].trim());
    blocks.push(<p key={key}>{inline(paragraph.join(' '), related, onOpen)}</p>);
  }
  return <>{blocks}</>;
}

interface Props {
  deskMode: DeskMode;
  selectedPath: string;
  entry: MemoryEntryDetail | null;
  loading: boolean;
  checking: boolean;
  showLoading: boolean;
  error: boolean;
  entries: ReadonlyMap<string, MemoryEntry>;
  nodes: ReadonlyMap<string, NodeCrystal>;
  onOpen: OpenEntry;
  onClose: () => void;
  onToggleMode: () => void;
  onNode?: (node: NodeCrystal) => void;
  writeState?: Feedback;
  onWrite: (request: WriteRequest) => void;
  onReload: (request: WriteRequest) => void;
}

export function ReadingDesk(props: Props) {
  const { deskMode, selectedPath, entry, loading, checking, showLoading, error, entries, nodes, onOpen, onClose, onToggleMode, onNode, writeState, onWrite, onReload } = props;
  const title = useRef<HTMLHeadingElement>(null);
  const paper = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (paper.current) paper.current.scrollTop = 0;
    (title.current ?? paper.current)?.focus({ preventScroll: true });
  }, [selectedPath, entry?.path, deskMode]);

  const related = new Map<string, string>();
  const name = entry && projectDisplayName(entry);
  const attributes = entry?.attributes.filter(([key]) => !isProjectIdAttribute(key)) ?? [];
  const primary = entry && primaryStatus(entry);
  const blocked = error || checking || writeState?.phase === 'pending' ||
    (writeState?.phase === 'failure' && ['conflict', 'missing', 'legacy'].includes(writeState.reason));
  for (const path of entry?.caseReferences ?? []) {
    const id = entries.get(path)?.caseId ?? /(?:^|\/)(\d{4}-\d{4})/.exec(path)?.[1];
    if (id) related.set(id, path);
  }

  return <div className={deskMode === 'A' ? styles.deskOverlay : styles.deskSidebar}
    onClick={(event) => { if (deskMode === 'A' && event.target === event.currentTarget) onClose(); }}>
    <section ref={paper} tabIndex={-1} className={styles.readingPaper} role={deskMode === 'A' ? 'dialog' : 'region'}
      aria-label="閱讀桌" aria-busy={loading}>
      <header className={styles.sheetHeader}>
        <div className={styles.sheetHeading}>
          {entry && <>
            <div className={styles.sheetMeta}>
              <span>{entryIdentifier(entry)}</span>
              {entry.shelf === 'case' && <><span>{categoryLabel(entry)}</span><time>{dateLabel(entry.updatedAt)}</time></>}
              {name && <span>{name}</span>}
              <StatusMark status={entry.status} /><HeatSlot heat={entry.heat} />
              {entry.nodeIds.map((id) => {
                const node = nodes.get(id);
                const label = (entry.nodeId === id ? '承辦：' : '參與：') + nodeName(entry, id, nodes);
                return node && onNode
                  ? <button key={id} type="button" className={styles.inlineLink} onClick={() => onNode(node)}>{label}</button>
                  : <span key={id}>{label}</span>;
              })}
              {!entry.nodeId && entry.nodeLabel && <span>承辦：{entry.nodeLabel}</span>}
            </div>
            <h2 tabIndex={-1} ref={title}>{entry.title}</h2>
          </>}
        </div>
        <div className={styles.sheetHeaderActions}>
          <button type="button" className={styles.paperButton} onClick={onToggleMode} aria-label="切換閱讀桌版式">
            {deskMode === 'B' ? '版式 B' : '切換版式（目前 A）'}
          </button>
          <button type="button" className={styles.paperButton} onClick={onClose} aria-label="返回書架">
            {deskMode === 'A' ? '返回書架（Esc）' : '返回'}
          </button>
        </div>
      </header>
      {showLoading && <p className={styles.paperMessage} role="status">正在翻閱…</p>}
      {error && <p className={styles.paperMessage} role="alert">{entry ? '無法重新讀取，以下是上次讀取的內容。' : '無法讀取這卷記憶。'}</p>}
      {entry && <>
        <div className={styles.sheetBody}>
          <div className={styles.document}>
            {entry.summary && <div className={styles.conclusion}><strong>結論摘要</strong><p>{entry.summary}</p></div>}
            <Markdown body={entry.body.replace(/^摘要[:：].*(?:\r?\n|$)/m, '')} related={related} onOpen={onOpen} />
            {entry.review && <section className={styles.review}>
              <h3>回顧</h3>
              <Markdown body={entry.review} related={related} onOpen={onOpen} />
            </section>}
          </div>
          <aside className={styles.sheetAside}>
            <section>
              <h3>取代演化線</h3>
              <ol className={styles.lineage}>
                <li data-version="current">{entryIdentifier(entry)} · 目前版本</li>
                {entry.supersessionChain.map((link) => <li key={link.path} data-version={link.status}>
                  <PreviousVersion link={link} onOpen={onOpen} />
                </li>)}
              </ol>
            </section>
            {entry.caseReferences.length > 0 && <section>
              <h3>關聯卷宗</h3>
              <ul className={styles.relatedList}>
                {entry.caseReferences.map((path) => <li key={path}>
                  <button type="button" className={styles.paperButton} onClick={() => onOpen(path)}>{entries.get(path)?.title ?? path.split('/').at(-1)}</button>
                </li>)}
              </ul>
            </section>}
            {attributes.length > 0 && <details>
              <summary>卷宗屬性</summary>
              <dl className={styles.attributes}>{attributes.map(([key, value]) => <div key={key}>
                <dt>{key}</dt><dd>{Array.isArray(value) ? value.join('、') : value}</dd>
              </div>)}</dl>
            </details>}
          </aside>
        </div>
        <footer className={styles.sheetFooter}>
          <div className={styles.writeControls}>
            <button type="button" className={styles.primaryButton} aria-disabled={blocked || !entry.writable || !primary} data-write-action={primary || undefined}
              onClick={() => { if (!blocked && entry.writable && primary) onWrite({ kind: 'status', entry, status: primary }); }}>
              {entry.shelf === 'bookmark' ? '標為完成' : '確認'}
            </button>
            <button type="button" className={styles.paperButton} aria-disabled={blocked || !entry.writable || !canSetStatus(entry, '退回')} data-write-action="退回"
              onClick={() => { if (!blocked && entry.writable && canSetStatus(entry, '退回')) onWrite({ kind: 'status', entry, status: '退回' }); }}>退回</button>
            <button type="button" className={styles.paperButton} aria-disabled={blocked} data-write-action="recycle"
              onClick={() => { if (!blocked) onWrite({ kind: 'recycle', entry }); }}>移入回收</button>
          </div>
          {!entry.writable && <span className={styles.writeMessage}>{legacyWriteMessage}</span>}
          <WriteFeedback state={writeState} onRun={onWrite} onReload={onReload} retryDisabled={error || checking} />
        </footer>
      </>}
    </section>
  </div>;
}
