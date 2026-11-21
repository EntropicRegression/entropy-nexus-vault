import { linkKinds, linkStyles } from './link-styles';
import type { LinkKind } from './link-styles';
import styles from './Sky.module.css';

export function LinkFilter({ visible, onToggle }: { visible: ReadonlySet<LinkKind>; onToggle: (kind: LinkKind) => void }) {
  return <div className={styles.linkFilter} role="group" aria-label="關係連線" data-map-controls="">
    {linkKinds.map((kind) => <button type="button" key={kind} className={styles.linkPill} data-kind={kind}
      aria-pressed={visible.has(kind)} onClick={() => onToggle(kind)}>
      <span aria-hidden="true">{linkStyles[kind].symbol} </span>{linkStyles[kind].label}
    </button>)}
  </div>;
}
