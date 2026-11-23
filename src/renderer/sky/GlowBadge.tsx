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

/** The score breakdown behind a tier (DESIGN.md §6.9 version 3), one line per item, plus what a skipped tier lacked. */
export function richnessLines(richness: Richness): string[] {
  const { input, parts } = richness;
  const lines = [
    '經歷分數 ' + richness.score + ' 分',
    '承辦的已確認判例 ' + input.confirmedCases + ' 份 × ' + t.weights.confirmedCase + ' = ' + parts.confirmedCases,
    '參與的已確認判例 ' + input.participatedCases + ' 份 × ' + t.weights.participatedCase + ' = ' + parts.participatedCases,
    '跨專案 ' + input.projects + ' 個' + (input.projectScope === 'git' ? '(只算 git 專案)' : '(含非 git 資料夾,近似)') +
      ' × ' + t.weights.project + ' = ' + parts.projects,
    '有效完成 ' + richness.effectiveCompleted + ' 件(完成峰值 ' + input.completedPeak + ' − 退回峰值 ' + input.rejectedPeak +
      ')= ' + parts.completed,
  ];
  if (richness.tier !== richness.scoreTier) lines.push('分數可到' + glowNames[richness.scoreTier] + ',但:');
  for (const cap of richness.caps) lines.push('・' + capText(cap));
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
