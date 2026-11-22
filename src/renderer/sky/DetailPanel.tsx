import type { MemoryEntry, NodeCrystal, NodeCrystalDetail } from '../../shared/types';
import { CrystalPortrait, crystalBadge } from './Crystal';
import { GlowBadge } from './GlowBadge';
import { localDate } from './local-date';
import { dateLabel } from '../library/catalog';
import { NodePortraitControl } from '../brand/NodePortraitControl';
import styles from './Sky.module.css';

const notRejectedHint = '以主控台統計的完成數與退回數計算:1 − 退回 ÷ 完成。正常完成的任務預設通過,使用者按退回才算未通過;'
  + '退回數也包含失敗或中斷任務上的退回,所以數值可能偏低。';

function Rate({ label, rate, amber, hint }: { label: string; rate: number | null; amber?: boolean; hint?: string }) {
  if (rate === null) return <div className={styles.barRow} title={hint}>
    <span>{label}</span><span className={styles.barTrack} aria-hidden="true" /><span title="無資料">—</span>
  </div>;
  const value = Math.round(rate * 100);
  return <div className={styles.barRow} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}
    title={hint} aria-description={hint}>
    <span>{label}</span>
    <span className={styles.barTrack}><span className={styles.barFill} data-amber={Boolean(amber)} style={{ width: value + '%' }} /></span>
    <strong data-amber={Boolean(amber)}>{value}%</strong>
  </div>;
}

/** sending: the request is on its way; sent: handed to the console (which asks again); failed: not sent. */
export type WakeState = { phase: 'sending' } | { phase: 'sent'; fading?: boolean } | { phase: 'failed'; message: string; sessionId: string | null };

/** Shown after a wake request reached the console; it fades with the next stats snapshot or after a minute. */
export const wakeSentText = '已送出,請到主控台確認;若你取消了就不會接回。節點是否上線,以下一份統計為準。';

export function DetailPanel({ node, detail, loading, error, onDismiss, onOpenEntry, onAward, awardsCorrupt, alsoIn, onReadFull, onWake, wake }: {
  node?: NodeCrystal;
  detail: NodeCrystalDetail | null;
  loading: boolean;
  error: boolean;
  onDismiss: () => void;
  onOpenEntry?: (entry: MemoryEntry) => void;
  /** Opens the grant / withdraw confirmation (DESIGN.md §6.9). */
  onAward?: (mode: 'grant' | 'withdraw', trigger: HTMLButtonElement) => void;
  /** .vault-awards.json is damaged: read as no awards and not writable until fixed. */
  awardsCorrupt?: boolean;
  /** With project galaxies: the other projects this node works in (where its bridges come from). */
  alsoIn?: string[];
  /** Opens the full profile over the star map (DESIGN.md §6.6.1). */
  onReadFull?: (trigger: HTMLButtonElement) => void;
  /** Asks to wake an archived node that can resume (DESIGN.md §6.7). */
  onWake?: (trigger: HTMLButtonElement) => void;
  wake?: WakeState;
}) {
  const crystal = detail ?? node;
  return <aside className={styles.gameFrame + ' ' + styles.detailPanel} data-sky-detail="" data-collapsed={!crystal}
    aria-label="節點履歷" aria-hidden={!crystal} inert={!crystal}>
    {crystal && <>
      <header className={styles.panelHeader}>
        <GlowBadge glow={detail?.glow ?? crystal.glow ?? 'white'} richness={detail?.richness} award={detail?.award} />
        <button className={styles.closePanel} type="button" onClick={onDismiss} aria-label="收起節點履歷">✕</button>
      </header>
      <div className={styles.crystalHero}>
        <div className={styles.heroPortrait}><CrystalPortrait key={crystal.nodeId} node={crystal} /></div>
        <div className={styles.heroText}>
          <h2>{crystal.name}</h2>
          <p>{[crystal.role && '立繪 ' + crystal.role, crystalBadge(crystal).text].filter(Boolean).join(' · ')}</p>
          {detail?.specialty && <p>{detail.specialty}</p>}
          {Boolean(detail?.consoleAppendixCount) && <small>另有主控台補充 {detail!.consoleAppendixCount} 段</small>}
          {detail?.profile && onReadFull && <button type="button" className={styles.readFull} data-read-full=""
            onClick={(event) => onReadFull(event.currentTarget)}>閱讀全文</button>}
        </div>
      </div>
      <NodePortraitControl key={crystal.nodeId} node={crystal} className={styles.nodePortrait} />
      {loading && <p role="status">正在讀取履歷…</p>}
      {error && <p role="alert">無法讀取節點履歷。</p>}
      {detail && <>
        {detail.stats ? <div className={styles.statsBars}>
          <Rate label="任務完成率" rate={detail.stats.completionRate} />
          <Rate label="未退回率" rate={detail.notRejectedRate} amber hint={notRejectedHint} />
        </div> : <p className={styles.statsTotal}>統計：無資料</p>}
        <p className={styles.statsTotal}>
          {detail.stats?.completed != null && <>累計完成任務 <strong>{detail.stats.completed}</strong>｜</>}
          經手判例 <strong className={styles.casesTotal}>{detail.confirmedCaseCount}</strong>
        </p>
      </>}
      {detail?.workflow && <section className={styles.sectionBox}>
        <h3>濃縮解題流程</h3><p>{detail.workflow}</p>
      </section>}
      {detail?.review && <section className={styles.reviewBox}>
        <h3 className={styles.reviewTitle}>節點回顧</h3><p>{detail.review}</p>
      </section>}
      {Boolean(alsoIn?.length) && <section className={styles.detailSection} data-also-in="">
        <h3>同時參與的專案</h3>
        <p className={styles.statsTotal}>{alsoIn!.join('、')}</p>
      </section>}
      {Boolean(detail?.relatedEntries.length) && <section className={styles.detailSection}>
        <h3>關聯卷宗</h3>
        <ul>{detail!.relatedEntries.map((entry) => {
          const label = [entry.caseId, entry.title].filter(Boolean).join(' · ');
          return <li key={entry.path}>{onOpenEntry
            ? <button type="button" className={styles.linkCard} data-related-entry="" onClick={() => onOpenEntry(entry)}>
              <span>{label}</span><span className={styles.toLibrary}>前往圖書館 →</span></button>
            : <span className={styles.linkCard}>{label}</span>}
          </li>;
        })}</ul>
      </section>}
      {detail && <section className={styles.detailSection} data-archive-entries="">
        <h3>典藏回憶</h3>
        {detail.archiveEntries?.length
          ? <ul>{detail.archiveEntries.map((entry) => {
            // 撰寫 = the entry's 節點ID is this node; 參與 = it is listed in 參與節點ID (DESIGN.md §6.6.4).
            const role = entry.nodeId === detail.nodeId ? '撰寫' : '參與';
            const label = (entry.kind === 'preference' ? '偏好' : '知識') + ' · ' + entry.title;
            return <li key={entry.path}>{onOpenEntry
              ? <button type="button" className={styles.linkCard} data-archive-entry={role} onClick={() => onOpenEntry(entry)}>
                <span><span className={styles.archiveRole}>{role}</span>{label}</span><span className={styles.toLibrary}>前往典藏書架 →</span></button>
              : <span className={styles.linkCard}><span className={styles.archiveRole}>{role}</span>{label}</span>}
            </li>;
          })}</ul>
          : <p className={styles.statsTotal} data-archive-empty="">典藏書架上還沒有這個節點撰寫或參與的卷宗。</p>}
      </section>}
      {detail && <section className={styles.detailSection} data-meeting-entries="">
        <h3>參與的會議</h3>
        {detail.meetingEntries?.length
          ? <ul>{detail.meetingEntries.map((entry) => {
            // 主持 = the meeting entry's 節點ID is this node; 參與 = it is among the participants.
            const role = entry.nodeId === detail.nodeId ? '主持' : '參與';
            const label = '會議 · ' + dateLabel(entry.updatedAt) + ' · ' + (entry.meeting?.topic || entry.title);
            const tag = entry.status === '未確認' ? '待核閱' : entry.status === '退回' ? '已退回' : '';
            const content = <span><span className={styles.archiveRole}>{role}</span><span className={styles.srOnly}> · </span>{label}
              {tag && <><span className={styles.srOnly}> · </span><span className={styles.archiveRole} data-meeting-status="">{tag}</span></>}</span>;
            return <li key={entry.path}>{onOpenEntry
              ? <button type="button" className={styles.linkCard} data-meeting-entry={role} onClick={() => onOpenEntry(entry)}>
                {content}<span className={styles.toLibrary}>前往會議書架 →</span></button>
              : <span className={styles.linkCard}>{content}</span>}
            </li>;
          })}</ul>
          : <p className={styles.statsTotal} data-meeting-empty="">還沒有這個節點主持或參與的會議紀錄。</p>}
      </section>}
      {Boolean(detail?.archives.length) && <section className={styles.detailSection}>
        <h3>歷次封存</h3>
        <ul>{detail!.archives.map(({ path, archivedAt }) => <li key={path}>{localDate(archivedAt, true)}</li>)}</ul>
      </section>}
      {crystal.status === '封存' && !crystal.canWake && <p className={styles.memorial}>
        {crystal.cliRecordExists === false ? 'CLI 原始紀錄已清理，僅留存濃縮水晶履歷。' : '此封存節點無法喚醒，僅留存濃縮水晶履歷。'}
      </p>}
      {detail && onWake && crystal.status === '封存' && crystal.canWake && <div className={styles.wakeBlock} data-wake="">
        <button type="button" className={styles.awardButton} data-wake-action="" disabled={wake?.phase === 'sending'}
          onClick={(event) => onWake(event.currentTarget)}>{wake?.phase === 'sending' ? '正在送出…' : '⚡ 在主控台喚醒舊 Session'}</button>
        {wake?.phase === 'sent' && <p role="status" data-wake-result="sent" data-fading={wake.fading ? '' : undefined}
          className={wake.fading ? styles.wakeFading : undefined}>{wakeSentText}</p>}
        {wake?.phase === 'failed' && <p role="alert" data-wake-result="failed">{wake.message}
          {wake.sessionId && <> sessionId:<code className={styles.sessionId}>{wake.sessionId}</code></>}</p>}
      </div>}
      {detail && onAward && <div className={styles.panelActions}>
        {awardsCorrupt && <p className={styles.awardWarning} role="status">頒發檔已損毀,目前視為沒有頒發;修復前無法頒發或撤回。</p>}
        <button type="button" className={styles.awardButton} data-award-action={detail.award ? 'withdraw' : 'grant'}
          disabled={awardsCorrupt} onClick={(event) => onAward(detail.award ? 'withdraw' : 'grant', event.currentTarget)}>
          {detail.award ? '撤回彩虹光暈' : '頒發彩虹光暈'}
        </button>
      </div>}
    </>}
  </aside>;
}
