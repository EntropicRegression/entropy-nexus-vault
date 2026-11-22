import { useEffect, useMemo, useRef, useState } from 'react';
import type { NodeProfileApi } from '../../shared/ipc';
import type { ProfileEditVersion, ProfileSaveResult, ReadableNodeProfile } from '../../shared/types';
import { maskSecrets } from '../../shared/secrets';
import { Markdown } from '../library/ReadingDesk';
import libraryStyles from '../library/Library.module.css';
import { blocksSaving, checkPlaceholders, placeholderNumbers, splitPlaceholders } from './profile-placeholders';
import { SkyDialog, trapTab } from './SkyDialog';
import { localDate } from './local-date';

export { localDate };
import styles from './Profile.module.css';

/** localStorage key: the user ticked "不再提示" on the first-save notice (renderer-only setting; see report). */
export const saveNoticeKey = 'entropy-vault.profile-save-notice-dismissed';
/** sessionStorage key: the notice was already shown and accepted in this app session (shown once per session). */
export const saveNoticeSessionKey = 'entropy-vault.profile-save-notice-shown';
export const saveNoticeText = '存檔後,主控台會一直把這份側寫視為你改過(之後不會恢復成覆寫):總管日後更新時,只會把有變動的章節附加在文末,不會改動你的內容。';
/** Next to the kept text after a conflict: its placeholder numbers belong to the old edit session. */
export const conflictPlaceholderNote = '舊文字中的 ⟦路徑N⟧ 編號屬於舊版,貼回新版前請先確認。';
export const placeholderHelp = '⟦路徑N⟧ 是一段本機路徑,為了隱私以編號代替,存檔時會還原成原文。請不要改動編號;刪掉的話,存檔前會再請你確認。';
const noLinks = new Map<string, string>();
const noOpen = () => {};

type Failure = { kind: 'conflict' | 'retry' | 'refused'; message: string };

/** The M5d methods are optional on VaultApi (older test bridges); a missing one fails like an IPC error. */
export async function profileApi(): Promise<NodeProfileApi> {
  const vault = window.vault;
  if (!vault.readNodeProfile || !vault.readProfileForEdit || !vault.saveProfileBody || !vault.requestWake) throw new Error('unavailable');
  return vault as NodeProfileApi;
}

function failureOf(result: Exclude<ProfileSaveResult, { ok: true }>): Failure {
  switch (result.reason) {
    case 'conflict': case 'edit-session': return { kind: 'conflict', message: '檔案已被修改。請重新載入後再編輯(不提供強制覆寫,以免蓋掉主控台剛附加的內容)。' };
    case 'missing': return { kind: 'refused', message: '這份側寫已不在原處,無法寫入。' };
    case 'io': case 'occupied': case 'recycle-io': return { kind: 'retry', message: '寫入失敗,檔案可能正被其他程式使用。' };
    case 'readonly': return { kind: 'refused', message: '這份檔案是唯讀的,無法寫入。' };
    case 'legacy': return { kind: 'refused', message: '這份檔案的格式無法安全寫入。' };
    case 'encoding': return { kind: 'refused', message: '這份檔案不是 UTF-8 編碼,無法安全寫入。' };
    case 'appendix-marker': return { kind: 'refused', message: '正文不能包含「## 主控台補充」標題;補充段落由主控台維護,會原樣保留。' };
    case 'invalid-placeholders':
      return { kind: 'refused', message: result.issue === 'duplicate' ? '有路徑佔位符重複出現,請刪掉多出的那個再儲存。'
        : result.issue === 'missing' ? result.message : '有路徑佔位符被改動,或出現了未知的編號,請還原後再儲存。' };
    default: return { kind: 'refused', message: '內容無法寫入。' };
  }
}

interface EditSession { original: string; version: ProfileEditVersion; isArchive: boolean; archiveNotice: string | null }

/**
 * Read the full profile and edit its body (DESIGN.md §6.6.1–6.6.2). A reading paper laid over the star map; the
 * floor does not change. Esc closes the topmost layer only: a dialog, then the editor (asking first when there are
 * unsaved changes), then the paper.
 */
export function ProfileOverlay({ nodeId, name, onClose, onSaved }: {
  nodeId: string; name: string; onClose: () => void; onSaved: () => void;
}) {
  const [profile, setProfile] = useState<ReadableNodeProfile | null>();
  const [readFailed, setReadFailed] = useState(false);
  const [session, setSession] = useState<EditSession | null>(null);
  const [text, setText] = useState('');
  const [opening, setOpening] = useState(false);
  const [openFailure, setOpenFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [conflictText, setConflictText] = useState<string | null>(null);
  /** Removals the user confirmed for exactly this text; a retry after a write failure reuses them (review #2). */
  const acknowledged = useRef<{ numbers: number[]; text: string } | null>(null);
  const [removal, setRemoval] = useState<{ numbers: number[]; message: string } | null>(null);
  const [notice, setNotice] = useState(false);
  const [noticeDismiss, setNoticeDismiss] = useState(false);
  const [discard, setDiscard] = useState(false);
  const paper = useRef<HTMLElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);

  // After a failed save the save button is replaced (重新載入) or was disabled while saving, so focus falls out of
  // the paper; move it to the footer's main action so Esc and Tab keep working.
  useEffect(() => {
    if (!failure) return;
    const active = document.activeElement;
    if (!active || active === document.body || !paper.current?.contains(active))
      paper.current?.querySelector<HTMLButtonElement>('[data-profile-footer-primary]:not([disabled])')?.focus({ preventScroll: true });
  }, [failure]);

  useEffect(() => {
    let current = true;
    void profileApi().then((api) => api.readNodeProfile(nodeId)).then((result) => { if (current) setProfile(result); },
      () => { if (current) { setProfile(null); setReadFailed(true); } });
    return () => { current = false; };
  }, [nodeId]);
  useEffect(() => { paper.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => { if (session) editor.current?.focus({ preventScroll: true }); }, [session]);

  const check = useMemo(() => session ? checkPlaceholders(session.original, text) : null, [session, text]);
  const dirty = Boolean(session && text !== session.original);
  const secrets = useMemo(() => session ? maskSecrets(text).masked : 0, [session, text]);
  const specialtyGone = Boolean(session && /^##\s*特長\s*$/m.test(session.original) && !/^##\s*特長\s*$/m.test(text));

  async function openEditor(keepText: string | null = null) {
    setOpening(true);
    setOpenFailure(null);
    try {
      const result = await (await profileApi()).readProfileForEdit(nodeId);
      if (!result.ok) {
        setOpenFailure(failureOf(result).message);
        return;
      }
      setSession({ original: result.body, version: result.version, isArchive: result.isArchive, archiveNotice: result.archiveNotice });
      setText(result.body);
      setFailure(null);
      acknowledged.current = null;
      setConflictText(keepText);
    } catch {
      setOpenFailure('無法開啟編輯。');
    } finally {
      setOpening(false);
    }
  }

  function requestSave() {
    if (!session || !check || blocksSaving(check)) return;
    if (localStorage.getItem(saveNoticeKey) !== '1' && sessionStorage.getItem(saveNoticeSessionKey) !== '1' && !notice) {
      setNotice(true);
      return;
    }
    // A retry of the same text keeps the confirmation; any edit since then makes the user confirm again.
    const kept = acknowledged.current;
    if (kept && kept.text !== text) acknowledged.current = null;
    void save(kept && kept.text === text ? kept.numbers : undefined);
  }

  async function save(removals?: number[]) {
    if (!session) return;
    if (removals) acknowledged.current = { numbers: removals, text };
    setSaving(true);
    setFailure(null);
    let result: ProfileSaveResult;
    try {
      result = await (await profileApi()).saveProfileBody(nodeId, text, session.version, removals ? { acknowledgedRemovals: removals } : undefined);
    } catch {
      result = { ok: false, reason: 'io' };
    }
    setSaving(false);
    if (result.ok) {
      setRemoval(null);
      onSaved();
      onClose();
      return;
    }
    if (result.reason === 'invalid-placeholders' && result.issue === 'missing') {
      setRemoval({ numbers: result.missingPlaceholders, message: result.message });
      return;
    }
    setRemoval(null);
    const next = failureOf(result);
    setFailure(next);
    if (next.kind === 'conflict') {
      setConflictText(text);
      acknowledged.current = null;
    }
  }

  function leaveEditor() {
    if (dirty) setDiscard(true);
    else closeEditor();
  }
  function closeEditor() {
    setDiscard(false);
    setSession(null);
    setFailure(null);
    setConflictText(null);
    queueMicrotask(() => paper.current?.focus({ preventScroll: true }));
  }

  function restore(number: number) {
    const token = '⟦路徑' + number + '⟧';
    const field = editor.current;
    const at = field ? field.selectionStart : text.length;
    setText(text.slice(0, at) + token + text.slice(at));
    queueMicrotask(() => { field?.focus({ preventScroll: true }); field?.setSelectionRange(at + token.length, at + token.length); });
  }

  const sourceLabel = profile ? profile.source.kind === 'live' ? '現役側寫' : '封存' + (profile.source.archivedAt ? ' · ' + localDate(profile.source.archivedAt) : '') : '';
  const known = session ? [...new Set(placeholderNumbers(session.original))].sort((a, b) => a - b) : [];

  return <div className={styles.overlay} data-profile-overlay="" onMouseDown={(event) => {
    if (event.target === event.currentTarget && !session) onClose();
  }} onKeyDown={(event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (saving) return;
      if (session) leaveEditor();
      else onClose();
      return;
    }
    if (!removal && !notice && !discard) trapTab(event, paper.current);
  }}>
    <section ref={paper} tabIndex={-1} className={libraryStyles.readingPaper + ' ' + styles.paper} role="dialog" aria-modal="true"
      aria-label={(session ? '編輯側寫:' : '閱讀全文:') + name} data-profile-mode={session ? 'edit' : 'read'}>
      <header className={libraryStyles.sheetHeader}>
        <div className={libraryStyles.sheetHeading}>
          <div className={libraryStyles.sheetMeta}><span>{sourceLabel}</span>{profile && profile.consoleAppendixCount > 0 &&
            <span>另有主控台補充 {profile.consoleAppendixCount} 段</span>}</div>
          <h2>{name}{session ? ' · 編輯側寫' : ''}</h2>
        </div>
        <div className={libraryStyles.sheetHeaderActions}>
          <button type="button" className={libraryStyles.paperButton} onClick={() => (session ? leaveEditor() : onClose())}>
            {session ? '取消編輯(Esc)' : '關閉(Esc)'}</button>
        </div>
      </header>

      {profile === undefined && !readFailed && <p className={libraryStyles.paperMessage} role="status">正在翻閱…</p>}
      {readFailed && <p className={libraryStyles.paperMessage} role="alert">無法讀取這份側寫。</p>}
      {profile === null && !readFailed && <p className={libraryStyles.paperMessage} role="status">這個節點沒有側寫。</p>}

      {profile && !session && <>
        <div className={styles.body}>
          <div className={libraryStyles.document} data-profile-body="">
            <Markdown body={profile.body} related={noLinks} onOpen={noOpen} />
            {profile.review && <section className={libraryStyles.review} data-profile-review="">
              <h3>回顧</h3><Markdown body={profile.review} related={noLinks} onOpen={noOpen} />
            </section>}
            {profile.consoleAppendices.map((appendix, index) => <section key={index} className={styles.appendix} data-appendix="">
              <h3>主控台補充 · {appendix.localTime ?? '時間無法辨識'}</h3>
              <p className={styles.appendixNote}>主控台附加的段落,唯讀;要採納請自行併入正文。</p>
              <Markdown body={appendix.text} related={noLinks} onOpen={noOpen} />
              {appendix.review && <div className={libraryStyles.review}><h3>回顧</h3><Markdown body={appendix.review} related={noLinks} onOpen={noOpen} /></div>}
            </section>)}
          </div>
        </div>
        <footer className={libraryStyles.sheetFooter}>
          <button type="button" className={libraryStyles.primaryButton} disabled={opening} data-profile-edit=""
            onClick={() => void openEditor()}>{opening ? '正在開啟…' : '編輯'}</button>
          <button type="button" className={libraryStyles.paperButton} onClick={onClose}>關閉(Esc)</button>
          {openFailure && <span className={styles.error} role="alert">{openFailure}</span>}
        </footer>
      </>}

      {session && check && <>
        <div className={styles.body}>
          {session.isArchive && session.archiveNotice && <p className={styles.notice} data-archive-notice="">{session.archiveNotice}</p>}
          <p className={styles.help}>只能編輯使用者正文(含回顧);檔頭與主控台補充段落不在這裡,會原樣保留。</p>
          <div className={styles.editorFrame}>
            <div ref={backdrop} className={styles.highlights} aria-hidden="true">
              {splitPlaceholders(text).map((part, index) => part.number === undefined ? <span key={index}>{part.text}</span>
                : <mark key={index} className={styles.token} data-token={check.duplicate.includes(part.number) || check.unknown.includes(part.number) ? 'bad' : 'ok'}>{part.text}</mark>)}
              {'\n'}
            </div>
            <textarea ref={editor} className={styles.editor} value={text} spellCheck={false} aria-label="側寫正文" data-profile-editor=""
              aria-describedby="profile-placeholder-help" disabled={saving}
              onChange={(event) => setText(event.target.value)}
              onScroll={(event) => { if (backdrop.current) backdrop.current.scrollTop = event.currentTarget.scrollTop; }} />
          </div>
          {known.length > 0 && <section className={styles.placeholders} aria-label="路徑佔位符" data-placeholders="">
            <p id="profile-placeholder-help">{placeholderHelp}</p>
            <ul>{known.map((number) => <li key={number} data-placeholder={number}
              data-state={check.missing.includes(number) ? 'missing' : check.duplicate.includes(number) ? 'duplicate' : 'ok'}>
              <mark className={styles.token}>⟦路徑{number}⟧</mark>
              {check.missing.includes(number) ? <>已刪除 <button type="button" onClick={() => restore(number)}>復原到游標處</button></>
                : check.duplicate.includes(number) ? '出現不只一次' : '在正文中'}
            </li>)}</ul>
          </section>}
          <div className={styles.warnings} role="status">
            {check.unknown.length > 0 && <p data-warning="unknown">出現未知的佔位符編號:{check.unknown.map((n) => '#' + n).join('、')},請改回或刪除。</p>}
            {check.damaged && <p data-warning="damaged">有不完整的路徑佔位符(例如少了 ⟧),請用「復原到游標處」放回完整的標籤,或整段刪除。</p>}
            {check.duplicate.length > 0 && <p data-warning="duplicate">佔位符重複:{check.duplicate.map((n) => '#' + n).join('、')},請刪掉多出的那個。</p>}
            {specialtyGone && <p data-warning="specialty">刪掉了「## 特長」標題,履歷欄將沒有特長句(仍可儲存)。</p>}
            {secrets > 0 && <p data-warning="secret">內容裡有看起來像金鑰、權杖或密碼的字串,請確認是否要存進側寫。</p>}
          </div>
          {conflictText !== null && <section className={styles.conflict} data-conflict="">
            <h3>你剛才輸入的內容(可複製)</h3>
            <p data-conflict-note="">{conflictPlaceholderNote}</p>
            <textarea readOnly value={conflictText} aria-label="你剛才輸入的內容" />
          </section>}
        </div>
        <footer className={libraryStyles.sheetFooter}>
          {failure?.kind === 'conflict'
            ? <button type="button" className={libraryStyles.primaryButton} data-profile-footer-primary="" disabled={saving || opening}
              onClick={() => void openEditor(conflictText)}>重新載入</button>
            : <button type="button" className={libraryStyles.primaryButton} data-profile-save="" data-profile-footer-primary="" disabled={saving || blocksSaving(check)}
              onClick={requestSave}>{saving ? '正在寫入…' : failure?.kind === 'retry' ? '重試' : '儲存'}</button>}
          <button type="button" className={libraryStyles.paperButton} disabled={saving} onClick={leaveEditor}>取消</button>
          {failure && <span className={styles.error} role="alert"><strong>未儲存</strong> · {failure.message}</span>}
        </footer>
      </>}
    </section>

    {removal && <SkyDialog title="刪除路徑佔位符" label="removal" busy={saving} onCancel={() => setRemoval(null)} actions={[
      { label: '返回編輯', onClick: () => setRemoval(null) },
      { label: '確認刪除並儲存', primary: true, onClick: () => void save(removal.numbers) },
    ]}><p>{removal.message}</p></SkyDialog>}
    {notice && <SkyDialog title="第一次儲存側寫" label="first-save" onCancel={() => setNotice(false)} actions={[
      { label: '取消', onClick: () => setNotice(false) },
      { label: '儲存', primary: true, onClick: () => {
        if (noticeDismiss) localStorage.setItem(saveNoticeKey, '1');
        sessionStorage.setItem(saveNoticeSessionKey, '1');
        setNotice(false);
        void save();
      } },
    ]}>
      <p>{saveNoticeText}</p>
      <label className={styles.check}><input type="checkbox" checked={noticeDismiss} onChange={(event) => setNoticeDismiss(event.target.checked)} />不再提示</label>
    </SkyDialog>}
    {discard && <SkyDialog title="放棄修改?" label="discard" onCancel={() => setDiscard(false)} actions={[
      { label: '繼續編輯', onClick: () => setDiscard(false) },
      { label: '放棄修改', primary: true, onClick: closeEditor },
    ]}><p>有尚未儲存的修改。放棄後會回到閱讀全文。</p></SkyDialog>}
  </div>;
}
