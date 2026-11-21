import type { HeatInfo, HeatLevel } from './types';

export const defaultHeatThresholds = {
  warm: 1,
  warmer: 3,
  hot: 7,
  decayAfterDays: 30,
};

const levels: readonly HeatLevel[] = ['沉睡', '餘溫', '微溫', '熾熱'];
const dayMs = 24 * 60 * 60 * 1000;

export type HeatRecall = Omit<HeatInfo, 'level'>;

export function heatDecayAt(recall: HeatRecall | undefined, thresholds = defaultHeatThresholds): number {
  if (!recall?.lastRecalledAt || recall.count < thresholds.warm) return Infinity;
  const lastRecall = Date.parse(recall.lastRecalledAt);
  return Number.isFinite(lastRecall) ? lastRecall + thresholds.decayAfterDays * dayMs : Infinity;
}

export function calculateHeat(
  recall: HeatRecall | undefined,
  now: number,
  thresholds = defaultHeatThresholds,
): HeatInfo {
  const count = recall?.count ?? 0;
  const lastRecalledAt = recall?.lastRecalledAt ?? null;
  let level = count >= thresholds.hot ? 3 : count >= thresholds.warmer ? 2 : count >= thresholds.warm ? 1 : 0;
  if (now > heatDecayAt(recall, thresholds)) {
    level = Math.max(0, level - 1);
  }
  return { count, lastRecalledAt, level: levels[level] };
}
