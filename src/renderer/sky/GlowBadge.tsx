import { useId } from 'react';
import { capText, defaultGlowThresholds, glowNames } from '../../shared/glow';
import type { GlowAward, GlowTier, Richness } from '../../shared/glow';
import styles from './Sky.module.css';

const t = defaultGlowThresholds;

function dateOnly(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number) => String(value).padStart(2, '0');
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}

/** The score breakdown behind a tier (DESIGN.md §6.9), one line per item, plus the reasons a tier was capped. */
export function richnessLines(richness: Richness): string[] {
  const { input, parts } = richness;
  const lines = [
    '經歷分數 ' + richness.score + ' 分',
    '承辦的已確認判例 ' + input.confirmedCases + ' 份 × ' + t.weights.confirmedCase + ' = ' + parts.confirmedCases,
    '參與的已確認判例 ' + input.participatedCases + ' 份 → +' + parts.participatedCases + '(上限 ' + t.limits.participated + ')',
    '跨專案 ' + input.projects + ' 個 → +' + parts.projects + '(最多計 ' + t.limits.projects + ' 個)',
    '有效完成 ' + richness.effectiveCompleted + ' 件(完成峰值 ' + input.completedPeak + ' − 退回 ' + input.rejectedAtPeak +
      ')→ +' + parts.completed + '(每 ' + t.weights.completedPerPoint + ' 件 1 分,上限 ' + t.limits.completed + ')',
    richness.rejectionRate === null
      ? '目前完成數 ' + input.completedNow + ' 件,未滿 ' + t.rejectionSample + ' 件,不判斷退回率'
      : '退回率 ' + Math.round(richness.rejectionRate * 100) + '%(目前窗口 ' + input.rejectedNow + ' / ' + input.completedNow + ')',
  ];
  if (richness.tier !== richness.scoreTier) lines.push('分數可到' + glowNames[richness.scoreTier] + ',但:');
  for (const cap of richness.caps) lines.push('・' + capText(cap));
  if (input.confirmedCases === 0 && !richness.caps.some(({ kind }) => kind === 'no-cases')) {
    lines.push('沒有自己承辦的已確認判例,最高只能到藍晶');
  }
  return lines;
}

/** Header badge of the detail panel: tier name with a diamond in the glow colour; hover or focus shows the breakdown. */
export function GlowBadge({ glow, richness, award }: { glow: GlowTier; richness?: Richness; award?: GlowAward | null }) {
  const tipId = useId();
  const lines = richness ? richnessLines(richness) : [];
  if (award && richness) lines.unshift('自動計算的等級:' + glowNames[richness.tier] + '(' + richness.score + ' 分)');
  return <div className={styles.glowBadgeBlock}>
    <span className={styles.glowBadge} data-glow={glow} tabIndex={lines.length ? 0 : undefined}
      aria-describedby={lines.length ? tipId : undefined} data-glow-badge="">
      <span className={styles.glowDiamond} aria-hidden="true" />
      {glowNames[glow]}{award ? ' · 手動頒發' : ''}
      {lines.length > 0 && <span id={tipId} role="tooltip" className={styles.glowTip}>
        {lines.map((line, index) => <span key={index}>{line}</span>)}
      </span>}
    </span>
    {award && <small className={styles.awardMeta} data-award-meta="">
      <span>頒發於 {dateOnly(award.awardedAt)}</span>
      {award.reason && <span>理由:{award.reason}</span>}
    </small>}
  </div>;
}
