import { usePortraitChain } from '../brand/brand-portrait';
import { HEAT_LABELS, HEAT_LEVELS } from '../../shared/heat';
import type { HeatInfo, MeetingInfo, MemoryEntry, NodeCrystal, SupersessionLink } from '../../shared/types';
import { dateLabel } from './catalog';
import styles from './Library.module.css';

export function StatusMark({ status }: { status: string }) {
  const label = ({ '未確認': '待核閱', '未完': '未完書籤', '已確認': '已收錄', '已完成': '已完成', '退回': '已退回' } as Record<string, string>)[status] ?? (status || '已收錄');
  const filled = !status || status === '已確認' || status === '已完成';
  return <span className={styles.statusMark} data-returned={status === '退回'}>
    <svg aria-hidden="true" viewBox="0 0 10 10" width="10" height="10">
      <path d="M5 1 9 5 5 9 1 5Z" stroke="currentColor" fill={filled ? 'currentColor' : 'none'} />
      {status === '退回' && <path d="M2 8 8 2" stroke="currentColor" />}
    </svg>
    {label}
  </span>;
}

export function HeatSlot({ heat }: { heat: HeatInfo }) {
  const label = HEAT_LABELS[heat.level];
  return <span className={styles.heatSlot} title={'召回熱度：' + label + '（召回 ' + heat.count + ' 次）'}>
    <span className={styles.gems} aria-hidden="true">
      {[0, 1, 2].map((index) => <svg key={index} viewBox="0 0 10 10" width="10" height="10" data-lit={index < HEAT_LEVELS.indexOf(heat.level)}>
        <path d="M5 .8 9.2 5 5 9.2 .8 5Z" />
      </svg>)}
    </span>
    {label}
  </span>;
}

export function nodeName(entry: MemoryEntry, id: string, nodes: ReadonlyMap<string, NodeCrystal>): string {
  return nodes.get(id)?.name || (entry.nodeId === id ? entry.nodeLabel : '')
    || entry.meeting?.participants.find((participant) => participant.nodeId === id)?.name || id;
}

export function nodeRoleLabel(entry: MemoryEntry, id: string): string {
  if (entry.kind === 'memoir') return '撰寫：';
  if (entry.nodeId !== id) return '參與：';
  return entry.shelf === 'meeting' ? '主持：' : '承辦：';
}

function Seal({ id, entry, nodes, onNode }: AvatarProps & { id: string }) {
  const node = nodes.get(id);
  // Avatar → brand default (cropped round by .seal) → the name's first character.
  const { current, generation, fail } = usePortraitChain(node, 'avatar');
  const name = nodeName(entry, id, nodes);
  const label = nodeRoleLabel(entry, id) + name;
  const initial = Array.from(name.trim())[0]?.toUpperCase() || '？';
  const content = current
    ? <img key={current.url + '#' + generation} src={current.url} alt="" loading="lazy" width="20" height="20"
      data-portrait-source={current.source} onError={() => fail(current.url)} />
    : initial;
  return <>
    {node && onNode
      ? <button type="button" className={styles.seal} data-host={entry.nodeId === id || undefined} tabIndex={-1} aria-label={label} onClick={() => onNode(node)}>{content}</button>
      : <span className={styles.seal} data-host={entry.nodeId === id || undefined} data-unavailable={!node} aria-label={label}>{content}</span>}
    <span className={styles.sealTip} aria-hidden="true">{label}</span>
  </>;
}

interface AvatarProps {
  entry: MemoryEntry;
  nodes: ReadonlyMap<string, NodeCrystal>;
  onNode?: (node: NodeCrystal) => void;
}

const endIcons = { 完成: '✓', 中止: '■', 逾時: '⧗' } as const;

/** Meeting end reason (DESIGN.md §5.13): icon + word + border style; the icon is decorative, the word is read out. */
export function EndBadge({ reason }: { reason: MeetingInfo['endReason'] }) {
  if (!reason) return null;
  return <b className={styles.endBadge} data-end={reason}><span className={styles.srOnly}> · </span>
    <span aria-hidden="true">{endIcons[reason]}</span>{reason}</b>;
}

export function AvatarSeals(props: AvatarProps) {
  const { entry } = props;
  const ids = entry.kind === 'memoir' ? (entry.nodeId ? [entry.nodeId] : []) : entry.nodeIds;
  if (!ids.length) return null;
  return <span className={styles.seals}>
    {ids.slice(0, 3).map((id) => <span className={styles.sealLayer} key={id}>
      <Seal id={id} {...props} />
    </span>)}
    {ids.length > 3 && <span className={styles.sealMore} title={'另有 ' + (ids.length - 3) + ' 位節點'}>+{ids.length - 3}</span>}
  </span>;
}

export function PreviousVersion({ link, onOpen }: { link: SupersessionLink; onOpen: (path: string) => void }) {
  const name = [link.caseId, link.title].filter(Boolean).join(' · ') || link.path.split('/').at(-1);
  if (link.status !== 'available') {
    return <span className={styles.unavailableVersion}>{name} · {link.status === 'recycled' ? '已回收' : '缺失'}</span>;
  }
  return <button type="button" className={styles.textButton} onClick={() => onOpen(link.path)}>
    {name}{link.updatedAt != null && <time>{dateLabel(link.updatedAt)}</time>}
  </button>;
}
