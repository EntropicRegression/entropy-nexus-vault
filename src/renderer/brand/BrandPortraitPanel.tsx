import { useEffect, useRef } from 'react';
import { trapTab } from '../sky/SkyDialog';
import { chooseBrandPortraitFolder, clearBrandPortraitFolder, useBrandPortraits } from './brand-portrait';
import styles from './Brand.module.css';

export const brandPortraitHelp = '三家廠牌各一組現役/沉睡圖,節點沒有自己的立繪時使用;圖片只在你的電腦上。';

/**
 * 廠牌預設立繪 settings (docs/架構.md §4.2). Choosing opens the system folder picker in the main process; the path
 * never reaches this view, only 已設定/未設定 and a display label. Esc or 關閉 returns focus to the opening button.
 */
export function BrandPortraitPanel({ onClose }: { onClose: () => void }) {
  const { settings, busy, error } = useBrandPortraits();
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => { card.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus({ preventScroll: true }); }, []);
  // Buttons are disabled while the main process works, which drops focus to <body> (and Esc would stop working);
  // once it is done, put focus back on the panel's first button.
  useEffect(() => {
    if (busy) return;
    const active = document.activeElement;
    if (!active || active === document.body || !card.current?.contains(active))
      card.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus({ preventScroll: true });
  }, [busy]);
  const configured = settings?.configured === true;
  return <div className={styles.veil} data-brand-panel=""
    onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!busy) onClose(); return; }
      trapTab(event, card.current);
    }}
    onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div ref={card} className={styles.card} role="dialog" aria-modal="true" aria-label="廠牌預設立繪">
      <h2>廠牌預設立繪</h2>
      <p className={styles.help}>{brandPortraitHelp}</p>
      <p className={styles.status} data-brand-status={configured ? 'configured' : 'unset'} role="status">
        {settings === null ? '正在讀取…' : configured ? <>已設定:<strong>{settings.label}</strong></> : '未設定(使用星座線符)'}
      </p>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.actions}>
        <button type="button" className={styles.primary} disabled={busy || settings === null}
          onClick={() => void chooseBrandPortraitFolder()}>{busy ? '處理中…' : configured ? '重新選擇資料夾' : '選擇資料夾'}</button>
        <button type="button" disabled={busy || !configured} onClick={() => void clearBrandPortraitFolder()}>清除</button>
        <button type="button" disabled={busy} onClick={onClose}>關閉</button>
      </div>
    </div>
  </div>;
}
