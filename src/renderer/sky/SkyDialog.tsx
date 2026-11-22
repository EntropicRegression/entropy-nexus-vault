import { useEffect, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import styles from './Sky.module.css';

export interface DialogAction {
  label: string;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
}

/** Keeps Tab inside `container` (shared by the sky's dialogs and overlays). */
export function trapTab(event: KeyboardEvent, container: HTMLElement | null) {
  if (event.key !== 'Tab' || !container) return;
  const items = [...container.querySelectorAll<HTMLElement>('button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex="0"]')]
    .filter((item) => !item.closest('[inert]'));
  if (!items.length) return;
  const index = items.indexOf(document.activeElement as HTMLElement);
  event.preventDefault();
  items[event.shiftKey ? (index <= 0 ? items.length - 1 : index - 1) : (index + 1) % items.length]?.focus();
}

/**
 * A modal confirmation on the star map (DESIGN.md §6.7 card language). The first action receives focus; Esc and a
 * click outside run onCancel. Esc does not travel further, so only the topmost layer closes.
 */
export function SkyDialog({ title, children, actions, onCancel, busy = false, label }: {
  title: string; children: ReactNode; actions: DialogAction[]; onCancel: () => void; busy?: boolean; label?: string;
}) {
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Remember what had focus so closing the dialog hands it back (otherwise focus falls to <body> and Esc stops working).
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    card.current?.querySelector<HTMLElement>('[data-dialog-actions] button:not([disabled])')?.focus({ preventScroll: true });
    return () => {
      queueMicrotask(() => {
        const active = document.activeElement;
        if (previous?.isConnected && (!active || active === document.body)) previous.focus({ preventScroll: true });
      });
    };
  }, []);
  return <div className={styles.dialogVeil} data-sky-dialog={label ?? ''}
    onKeyDown={(event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (!busy) onCancel();
        return;
      }
      trapTab(event, card.current);
    }}
    onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
    <div ref={card} className={styles.dialogCard} role="dialog" aria-modal="true" aria-label={title}>
      <h2>✦ {title}</h2>
      {children}
      <div className={styles.dialogActions} data-dialog-actions="">
        {actions.map((action) => <button key={action.label} type="button" className={action.primary ? styles.dialogPrimary : undefined}
          disabled={busy || action.disabled} onClick={action.onClick}>{action.label}</button>)}
      </div>
    </div>
  </div>;
}
