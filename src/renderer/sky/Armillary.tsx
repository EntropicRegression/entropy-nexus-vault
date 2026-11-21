import type { RefObject } from 'react';
import styles from './Sky.module.css';

export function Armillary({ armillaryRef }: { armillaryRef: RefObject<HTMLDivElement | null> }) {
  return <div className={styles.astrolabe} aria-hidden="true">
    <div ref={armillaryRef} className={styles.armillary} data-armillary="">
      <span className={styles.ring + ' ' + styles.ringOuter} />
      <span className={styles.ring + ' ' + styles.ringMid} />
      <span className={styles.ring + ' ' + styles.ringInner} />
      <span className={styles.ring + ' ' + styles.ringEquator} />
      <span className={styles.core} />
    </div>
  </div>;
}
