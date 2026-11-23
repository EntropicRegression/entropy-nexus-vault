import type { MemoryEntry, MemoryEntryDetail } from '../../shared/types';
import { compareMemoirChapters } from '../../shared/shelves';
import { memoirPeriodLabel, memoirReviewLabel } from './catalog';
import { Markdown } from './Markdown';
import styles from './Library.module.css';

type OpenEntry = (path: string) => void;

export function MemoirChapters({ entry, entries, onOpen }: {
  entry: MemoryEntry;
  entries: ReadonlyMap<string, MemoryEntry>;
  onOpen: OpenEntry;
}) {
  const chapters = entry.nodeId ? Array.from(entries.values())
    .filter((chapter) => chapter.kind === 'memoir' && chapter.nodeId === entry.nodeId && !chapter.superseded)
    .sort(compareMemoirChapters) : [];
  const current = chapters.findIndex((chapter) => chapter.path === entry.path);
  const previous = current > 0 ? chapters[current - 1] : undefined;
  const next = current >= 0 ? chapters[current + 1] : undefined;
  return <section className={styles.memoirChapters} aria-label="這本回憶錄">
    <h3>這本回憶錄</h3>
    <div className={styles.memoirNavigation}>
      <button type="button" disabled={!previous} onClick={() => previous && onOpen(previous.path)}>← 上一章</button>
      <button type="button" disabled={!next} onClick={() => next && onOpen(next.path)}>下一章 →</button>
    </div>
    {chapters.length ? <ol className={styles.memoirChapterList}>
      {chapters.map((chapter, index) => {
        const review = memoirReviewLabel(chapter);
        return <li key={chapter.path}>
          <button type="button" aria-current={chapter.path === entry.path ? 'page' : undefined}
            onClick={() => onOpen(chapter.path)}>
            <strong>第 {index + 1} 章 · {chapter.title}</strong>
            <small>{memoirPeriodLabel(chapter)}{review && <> · <span>{review}</span></>}</small>
          </button>
        </li>;
      })}
    </ol> : <p>沒有可列出的章節。</p>}
  </section>;
}

export function MemoirDocument({ entry, related, onOpen }: {
  entry: MemoryEntryDetail;
  related: ReadonlyMap<string, string>;
  onOpen: OpenEntry;
}) {
  const { uncertain, sources, body } = entry.memoirSections ?? { uncertain: null, sources: null, body: entry.body };
  return <>
    {uncertain != null && <section className={styles.memoirUncertain} data-memoir-uncertain="">
      <h3>不確定之處</h3>
      {uncertain.trim() === '無' ? <p>撰寫者表示沒有不確定之處</p> : <Markdown body={uncertain} related={related} onOpen={onOpen} />}
    </section>}
    <div data-memoir-body="">
      {body.trim() ? <Markdown body={body} related={related} onOpen={onOpen} /> : <p>（沒有正文）</p>}
    </div>
    {entry.review && <section className={styles.review}>
      <h3>回顧</h3>
      <Markdown body={entry.review} related={related} onOpen={onOpen} />
    </section>}
    {sources != null && <section className={styles.memoirSources} data-memoir-sources="">
      <h3>來源</h3>
      <Markdown body={sources} related={related} onOpen={onOpen} />
    </section>}
  </>;
}
