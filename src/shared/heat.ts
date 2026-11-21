export const defaultHeatThresholds = {
  tepid: 1,
  temperate: 3,
  flaming: 5,
  decayAfterDays: 30,
};

export const HEAT_LEVELS = ['ember', 'tepid', 'temperate', 'flaming'] as const;
export type HeatLevel = (typeof HEAT_LEVELS)[number];

export const HEAT_LABELS: Record<HeatLevel, string> = {
  ember: '餘燼',
  tepid: '微溫',
  temperate: '溫潤',
  flaming: '炙熱',
};

export interface HeatInfo {
  level: HeatLevel;
  count: number;
  lastRecalledAt: string | null;
}

const dayMs = 24 * 60 * 60 * 1000;

export type HeatRecall = Omit<HeatInfo, 'level'>;

export function heatDecayAt(recall: HeatRecall | undefined, thresholds = defaultHeatThresholds): number {
  if (!recall?.lastRecalledAt || recall.count < thresholds.tepid) return Infinity;
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
  let level = count >= thresholds.flaming ? 3
    : count >= thresholds.temperate ? 2
    : count >= thresholds.tepid ? 1
    : 0;
  if (now > heatDecayAt(recall, thresholds)) {
    level = Math.max(0, level - 1);
  }
  return { count, lastRecalledAt, level: HEAT_LEVELS[level] };
}
