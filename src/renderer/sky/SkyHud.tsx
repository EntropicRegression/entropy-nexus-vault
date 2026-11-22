import type { Ref } from 'react';
import styles from './Sky.module.css';

/** The upstairs brand bar. It lives outside the camera world so it can crossfade in place with the library bar. */
export function SkyHud({ barRef, reducedMotion, settingsDisabled, onLibrary, onToggleMotion, onBrandPortraits }: {
  barRef?: Ref<HTMLElement>;
  reducedMotion: boolean;
  settingsDisabled?: boolean;
  onLibrary: () => void;
  onToggleMotion: () => void;
  /** Opens the 廠牌預設立繪 settings (the button is passed so focus can return to it). */
  onBrandPortraits?: (trigger: HTMLButtonElement) => void;
}) {
  return <header ref={barRef} className={styles.hud} data-sky-hud="">
    <h1><span aria-hidden="true" />ENTROPY NEXUS · ARCHIVE</h1>
    <nav aria-label="樓層切換">
      <button className={styles.hudActive} type="button" aria-current="page">✦ 仰望星圖｜休眠庫</button>
      <button type="button" onClick={onLibrary}>◈ 俯瞰圖書館｜判例室</button>
    </nav>
    <button type="button" className={styles.motionButton} aria-pressed={reducedMotion}
      disabled={settingsDisabled} onClick={onToggleMotion}>低動態：{reducedMotion ? '開' : '關'}</button>
    {onBrandPortraits && <button type="button" className={styles.motionButton + ' ' + styles.brandButton} data-brand-open=""
      onClick={(event) => onBrandPortraits(event.currentTarget)}>廠牌立繪</button>}
  </header>;
}
