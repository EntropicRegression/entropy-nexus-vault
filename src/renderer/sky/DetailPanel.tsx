import type { MemoryEntry, NodeCrystal, NodeCrystalDetail } from '../../shared/types';
import { CrystalPortrait, crystalBadge } from './Crystal';
import styles from './Sky.module.css';

const notRejectedHint = '正常完成的任務預設通過,使用者按退回才算未通過;數值為 1 − 退回 ÷ 完成。';

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

export function DetailPanel({ node, detail, loading, error, onDismiss, onOpenEntry }: {
  node?: NodeCrystal;
  detail: NodeCrystalDetail | null;
  loading: boolean;
  error: boolean;
  onDismiss: () => void;
  onOpenEntry?: (entry: MemoryEntry) => void;
}) {
  const crystal = detail ?? node;
  return <aside className={styles.gameFrame + ' ' + styles.detailPanel} data-sky-detail="" data-collapsed={!crystal}
    aria-label="節點履歷" aria-hidden={!crystal} inert={!crystal}>
    {crystal && <>
      <header className={styles.panelHeader}>
        {crystal.role && <span>{crystal.role}</span>}
        <button className={styles.closePanel} type="button" onClick={onDismiss} aria-label="收起節點履歷">✕</button>
      </header>
      <div className={styles.crystalHero}>
        <div className={styles.heroPortrait}><CrystalPortrait key={crystal.nodeId} src={crystal.portraitUrl} /></div>
        <div className={styles.heroText}>
          <h2>{crystal.name}</h2>
          <p>{[crystal.role, crystalBadge(crystal).text].filter(Boolean).join(' · ')}</p>
          {detail?.specialty && <p>{detail.specialty}</p>}
          {Boolean(detail?.consoleAppendixCount) && <small>另有主控台補充 {detail!.consoleAppendixCount} 段</small>}
        </div>
      </div>
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
      {Boolean(detail?.archives.length) && <section className={styles.detailSection}>
        <h3>歷次封存</h3>
        <ul>{detail!.archives.map(({ path, archivedAt }) => <li key={path}>{archivedAt}</li>)}</ul>
      </section>}
      {crystal.status === '封存' && !crystal.canWake && <p className={styles.memorial}>
        {crystal.cliRecordExists === false ? 'CLI 原始紀錄已清理，僅留存濃縮水晶履歷。' : '此封存節點無法喚醒，僅留存濃縮水晶履歷。'}
      </p>}
    </>}
  </aside>;
}
