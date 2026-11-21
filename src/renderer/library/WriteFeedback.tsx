import { useEffect } from 'react';
import type { Feedback, Notice, WriteRequest } from './use-vault-writes';
import { reasonText } from './use-vault-writes';
import styles from './Library.module.css';

type Run = (request: WriteRequest) => void;

export function WriteFeedback({ state, onRun, onReload, retryDisabled }: {
  state?: Feedback; onRun: Run; onReload: Run; retryDisabled?: boolean;
}) {
  if (!state) return null;
  if (state.phase === 'pending') return <span className={styles.writeMessage} role="status">正在寫入…</span>;
  if (state.phase === 'reloading') return <span className={styles.writeMessage} role="status">正在重新載入…</span>;
  if (state.phase === 'saved') return <span className={styles.writeMessage} role="status">已儲存：{state.text}</span>;
  if (state.phase !== 'failure') return null;
  const reload = state.reason === 'conflict' || state.reason === 'missing';
  return <span className={styles.writeMessage} data-failed="">
    <span role="alert"><strong>未儲存</strong> · {reasonText(state.reason, state.request.kind)}
      {state.residualPath && <> 殘留檔案：{state.residualPath}</>}
    </span>
    {state.reason !== 'legacy' && <button className={styles.paperButton} type="button" disabled={!reload && retryDisabled}
      onClick={(event) => {
        const action = state.request.kind === 'status' ? state.request.status : state.request.kind;
        const parent = event.currentTarget.closest('article, footer, [data-write-notice]');
        (parent?.querySelector<HTMLElement>('[data-write-action="' + action + '"]') ?? (parent instanceof HTMLElement ? parent : null))
          ?.focus({ preventScroll: true });
        (reload ? onReload : onRun)(state.request);
      }}>{reload ? '重新載入此卷宗' : '重試'}</button>}
  </span>;
}

function undoFeedback(notice: Notice, feedback: ReadonlyMap<string, Feedback>) {
  const undo = notice.undo;
  const current = undo && feedback.get(undo.entry.path);
  return undo && current?.request === undo ? current : undefined;
}

export function WriteNotices({ notices, feedback, onRun, onReload, dismiss }: {
  notices: Notice[]; feedback: ReadonlyMap<string, Feedback>; onRun: Run; onReload: Run; dismiss: (id: number) => void;
}) {
  useEffect(() => {
    const timers = notices.flatMap((notice) => {
      if (notice.preview || undoFeedback(notice, feedback)) return [];
      return [window.setTimeout(() => dismiss(notice.id), Math.max(0, notice.expiresAt - Date.now()))];
    });
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [notices, feedback, dismiss]);

  const latest = notices.at(-1);
  const available = notices.filter((notice) => Boolean(notice.undo)).at(-1);
  const undo = available?.undo;
  const state = available && undoFeedback(available, feedback);
  if (!latest) return null;
  return <div className={styles.notice} data-write-notice="" tabIndex={-1}>
    <span role="status">{latest.text}</span>
    {undo && !state && <button type="button" title={undo.entry.title} onClick={(event) => {
      event.currentTarget.parentElement?.focus({ preventScroll: true });
      onRun(undo);
    }}>撤銷</button>}
    {state && <WriteFeedback state={state} onRun={onRun} onReload={onReload} />}
    {available?.preview && <details className={styles.undoPreview}>
      <summary>查看重新載入的回收卷宗 · {available.preview.title}</summary>
      <pre>{[available.preview.body, available.preview.review].filter(Boolean).join('\n\n')}</pre>
    </details>}
    {available && (state?.phase === 'failure' || available.preview) && <button type="button" onClick={() => dismiss(available.id)}>關閉提示</button>}
  </div>;
}
