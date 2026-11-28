import { useState } from 'react';
import type { CrystalSavepoint, MemoryEntry, NodeCrystal, NodeCrystalDetail } from '../../shared/types';
import { savepointBackend, savepointSize, savepointStatus, savepointTime } from './savepoints';
import { glowNames, needText, nextTierNeeds } from '../../shared/glow';
import type { Richness } from '../../shared/glow';
import { CrystalPortrait, crystalBadge } from './Crystal';
import { GlowBadge } from './GlowBadge';
import { localDate } from './local-date';
import { dateLabel, memoirPeriodLabel, memoirReviewLabel } from '../library/catalog';
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
  /** Asks to wake an archived node that can resume (DESIGN.md §6.7); savepoint: the restore target (§6.6.5). */
  onWake?: (trigger: HTMLButtonElement, savepoint?: CrystalSavepoint) => void;
  wake?: WakeState;
}) {
  const crystal = detail ?? node;
  const restoreTarget = detail?.savepoints?.find((savepoint) => savepoint.restoreTarget);
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
          {detail?.richness && !detail.award && <NextTier richness={detail.richness} />}
          {detail?.profile && onReadFull && <button type="button" className={styles.readFull} data-read-full=""
            onClick={(event) => onReadFull(event.currentTarget)}>閱讀全文</button>}
        </div>
      </div>
      {/* Sibling keys must differ (the 存點 section below is keyed by node too); equal keys left stray picture rows. */}
      <NodePortraitControl key={'portrait:' + crystal.nodeId} node={crystal} className={styles.nodePortrait} />
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
      {detail && <section className={styles.detailSection} data-memoir-entries="">
        <h3>典藏回憶</h3>
        {detail.memoirEntries?.length
          ? <ul>{detail.memoirEntries.map((entry) => {
            const label = '回憶錄 · ' + memoirPeriodLabel(entry) + ' · ' + entry.title;
            const review = memoirReviewLabel(entry);
            const content = <span>{label}
              {review && <><span className={styles.srOnly}> · </span><span className={styles.archiveRole} data-memoir-status="">{review}</span></>}</span>;
            return <li key={entry.path}>{onOpenEntry
              ? <button type="button" className={styles.linkCard} data-memoir-entry="" onClick={() => onOpenEntry(entry)}>
                {content}<span className={styles.toLibrary}>前往典藏書架 →</span></button>
              : <span className={styles.linkCard}>{content}</span>}
            </li>;
          })}</ul>
          : <p className={styles.statsTotal} data-memoir-empty="">這個節點還沒有寫回憶錄。</p>}
      </section>}
      {Boolean(detail?.savepoints?.length) && <Savepoints key={'savepoints:' + detail!.nodeId} detail={detail!} wake={wake}
        onWake={onWake && detail!.status === '封存' && detail!.canWake ? onWake : undefined} />}
      {detail && <section className={styles.detailSection} data-meeting-entries="">
        <h3>參與的會議</h3>
        {detail.meetingEntries?.length
          ? <ul>{detail.meetingEntries.map((entry) => {
            // 主持 = the meeting entry's 節點ID is this node; 參與 = it is among the participants.
            const role = entry.nodeId === detail.nodeId ? '主持' : '參與';
            const label = '會議 · ' + dateLabel(entry.updatedAt) + ' · ' + entry.title;
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
        {restoreTarget
          ? <p className={styles.statsTotal} data-wake-by-savepoint="">原對話已被 {savepointBackend(restoreTarget)} 清除,可從上方的存點還原。</p>
          : <button type="button" className={styles.awardButton} data-wake-action="" disabled={wake?.phase === 'sending'}
            onClick={(event) => onWake(event.currentTarget)}>{wake?.phase === 'sending' ? '正在送出…' : '⚡ 在主控台喚醒舊 Session'}</button>}
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

const shownSavepoints = 3;

/** 存點 (DESIGN.md 6.6.5): metadata only, in the console's order; only the restore target gets a button. */
function Savepoints({ detail, wake, onWake }: {
  detail: NodeCrystalDetail;
  wake?: WakeState;
  onWake?: (trigger: HTMLButtonElement, savepoint: CrystalSavepoint) => void;
}) {
  const savepoints = detail.savepoints ?? [];
  // The restore target must stay reachable: start expanded when it sits below the first rows.
  const [expanded, setExpanded] = useState(() => savepoints.findIndex((savepoint) => savepoint.restoreTarget) >= shownSavepoints);
  const visible = expanded ? savepoints : savepoints.slice(0, shownSavepoints);
  const hidden = savepoints.length - visible.length;
  const hasTarget = savepoints.some((savepoint) => savepoint.restoreTarget);
  return <section className={styles.detailSection} data-savepoints="">
    <h3>存點({savepoints.length})</h3>
    <p className={styles.statsTotal}>終止時保存的原始對話,只列紀錄,內容不在此顯示。</p>
    <ul>{visible.map((savepoint, index) => {
      const label = [savepointTime(savepoint), savepointBackend(savepoint), savepointSize(savepoint)].join(' · ');
      const status = savepointStatus(savepoint, detail);
      return <li key={savepoint.time + ':' + index} className={styles.linkCard} data-savepoint="">
        <span>{label}<span className={styles.srOnly}> · </span>
          <span className={styles.archiveRole} data-savepoint-status="">◆ {status}</span></span>
        {savepoint.restoreTarget && onWake && <button type="button" className={styles.awardButton} data-wake-action=""
          data-savepoint-restore="" disabled={wake?.phase === 'sending'} onClick={(event) => onWake(event.currentTarget, savepoint)}>
          {wake?.phase === 'sending' ? '正在送出…' : '從這份存點還原並喚醒'}</button>}
      </li>;
    })}</ul>
    {hidden > 0 && <button type="button" className={styles.linkCard} data-savepoints-more="" aria-expanded={false}
      onClick={() => setExpanded(true)}>較舊的存點 +{hidden}</button>}
    {hasTarget && <p className={styles.statsTotal}>主控台一律使用最新一份可還原的存點。</p>}
  </section>;
}

/** 升級要求 (DESIGN.md §6.9): what the tier right above still needs, shown in the hero frame; nothing at red. */
function NextTier({ richness }: { richness: Richness }) {
  const next = nextTierNeeds(richness);
  if (!next) return <small className={styles.nextTier} data-next-tier="top">已是自動計算的最高等級(紅晶)</small>;
  const needs = [...(next.scoreGap > 0 ? ['還差 ' + next.scoreGap + ' 分'] : []), ...next.caps.map(needText)];
  return <div className={styles.nextTier} data-next-tier={next.tier}>
    <small>升級到{glowNames[next.tier]}:</small>
    {needs.length > 0 && <ul>{needs.map((need) => <li key={need}>{need}</li>)}</ul>}
  </div>;
}
