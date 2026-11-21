import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { awardReasonLimit } from '../../shared/glow';
import type { AwardWriteResult } from '../../shared/types';
import styles from './Sky.module.css';

export type AwardFailure = Extract<AwardWriteResult, { ok: false }>['reason'];

const failureText: Record<AwardFailure, string> = {
  conflict: '頒發紀錄剛被其他程式修改。請重新載入後再試。',
  corrupt: '頒發檔已損毀,為避免覆蓋原檔不會寫入。請先修復或移走記憶庫根目錄的 .vault-awards.json。',
  invalid: '這筆頒發無法寫入(節點不存在或理由超過 80 字)。',
  io: '寫入失敗,檔案可能正被其他程式使用。',
};

/**
 * Grant / withdraw confirmation (DESIGN.md §6.9). The glow changes only after the write succeeds; a failure stays in
 * the dialog with 未儲存 and a retry (or reload for a conflict).
 */
export function AwardDialog({ mode, name, saving, failure, onConfirm, onCancel, onReload }: {
  mode: 'grant' | 'withdraw';
  name: string;
  saving: boolean;
  failure: AwardFailure | null;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  onReload: () => void;
}) {
  const [reason, setReason] = useState('');
  const first = useRef<HTMLInputElement & HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const length = Array.from(reason).length;
  useEffect(() => { first.current?.focus(); }, []);

  function keepFocus(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (!saving) onCancel();
      return;
    }
    if (event.key !== 'Tab' || !card.current) return;
    const items = [...card.current.querySelectorAll<HTMLElement>('input, button:not([disabled])')];
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = event.shiftKey ? (index <= 0 ? items.length - 1 : index - 1) : (index + 1) % items.length;
    event.preventDefault();
    items[next]?.focus();
  }

  const title = mode === 'grant' ? '頒發彩虹光暈' : '撤回彩虹光暈';
  return <div className={styles.dialogVeil} onKeyDown={keepFocus}
    onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onCancel(); }}>
    <div ref={card} className={styles.dialogCard} role="dialog" aria-modal="true" aria-labelledby="award-title" data-award-dialog={mode}>
      <h2 id="award-title">✦ {title}</h2>
      {mode === 'grant' ? <>
        <p>為〈{name}〉頒發虹晶。彩虹光暈只能手動頒發,之後可隨時撤回。</p>
        <label className={styles.reasonField}>
          <span>頒發理由(選填)</span>
          <input ref={first} type="text" value={reason} maxLength={awardReasonLimit} disabled={saving}
            placeholder="例:主導記憶庫安全設計並維護至今"
            onChange={(event) => setReason(Array.from(event.target.value).slice(0, awardReasonLimit).join(''))} />
          <small aria-live="polite">還可輸入 {awardReasonLimit - length} 字</small>
          <small className={styles.reasonNote}>看起來像金鑰、權杖或密碼的內容會自動遮罩為「[已遮罩]」。</small>
        </label>
      </> : <p>撤回〈{name}〉的彩虹光暈?等級將回到自動計算的結果。</p>}
      {failure && <p className={styles.dialogError} role="alert"><strong>未儲存</strong> · {failureText[failure]}</p>}
      <div className={styles.dialogActions}>
        <button type="button" onClick={onCancel} disabled={saving}
          ref={mode === 'withdraw' ? first : undefined}>取消</button>
        {failure === 'conflict'
          ? <button type="button" className={styles.dialogPrimary} onClick={onReload} disabled={saving}>重新載入</button>
          : <button type="button" className={styles.dialogPrimary} disabled={saving || failure === 'corrupt'}
            onClick={() => onConfirm(reason)}>
            {saving ? '正在寫入…' : failure ? '重試' : mode === 'grant' ? '頒發' : '撤回'}
          </button>}
      </div>
    </div>
  </div>;
}
