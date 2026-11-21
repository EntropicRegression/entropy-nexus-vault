/** Experience richness and crystal glow tiers (DESIGN.md §6.9 version 2, confirmed 2026-11-22; docs/架構.md §9.2). */

export type GlowTier = 'white' | 'green' | 'blue' | 'violet' | 'gold' | 'red' | 'rainbow';
export type AutoGlowTier = Exclude<GlowTier, 'rainbow'>;

export const glowTiers: readonly AutoGlowTier[] = ['white', 'green', 'blue', 'violet', 'gold', 'red'];
export const glowNames: Record<GlowTier, string> = {
  white: '白晶', green: '綠晶', blue: '藍晶', violet: '紫晶', gold: '金晶', red: '紅晶', rainbow: '虹晶',
};

export interface RichnessInput {
  /** Confirmed cases this node handled (節點ID). */
  confirmedCases: number;
  /** Confirmed cases this node only took part in (參與節點ID, not the handler). */
  participatedCases: number;
  /** Highest 完成數 this machine has seen for the node (userData/glow-peaks.json). */
  completedPeak: number;
  /** 退回數 recorded when that peak was reached. */
  rejectedAtPeak: number;
  /** Current 完成數 in the console's 180-day window; used only for the rejection rate. */
  completedNow: number;
  /** Current 退回數 in the same window. */
  rejectedNow: number;
  /** Distinct projects (by opaque project key). */
  projects: number;
}

export interface RichnessParts {
  confirmedCases: number;
  participatedCases: number;
  projects: number;
  completed: number;
}

/** Why a node stops below the tier its score would reach. */
export type GlowCap =
  | { kind: 'no-cases' }
  | { kind: 'rejection'; limit: number; rate: number }
  | { kind: 'cases'; tier: AutoGlowTier; need: number; have: number }
  | { kind: 'projects'; tier: AutoGlowTier; need: number; have: number };

export interface Richness {
  /** The counts the score was computed from (shown in the badge tooltip). */
  input: RichnessInput;
  /** 完成數峰值 − 退回數峰值. */
  effectiveCompleted: number;
  score: number;
  parts: RichnessParts;
  /** The tier the score alone would reach. */
  scoreTier: AutoGlowTier;
  tier: AutoGlowTier;
  caps: GlowCap[];
  /** Rejection rate of the current window, or null when there are fewer completed tasks than the gate needs. */
  rejectionRate: number | null;
}

export interface GlowThresholds {
  weights: { confirmedCase: number; participatedCase: number; project: number; completedPerPoint: number };
  limits: { participated: number; projects: number; completed: number };
  /** Minimum score for each tier, in tier order. */
  minimumScore: Record<AutoGlowTier, number>;
  /** Extra requirements for violet and above. */
  requirements: Partial<Record<AutoGlowTier, { cases: number; projects: number; maxRejection: number }>>;
  /** Without own confirmed cases, the tier stops here. */
  withoutCasesMax: AutoGlowTier;
  /** The rejection gate needs at least this many completed tasks in the current window. */
  rejectionSample: number;
}

export const defaultGlowThresholds: GlowThresholds = {
  weights: { confirmedCase: 10, participatedCase: 1, project: 4, completedPerPoint: 10 },
  limits: { participated: 10, projects: 6, completed: 20 },
  minimumScore: { white: 0, green: 10, blue: 30, violet: 60, gold: 120, red: 200 },
  requirements: {
    violet: { cases: 3, projects: 0, maxRejection: 0.2 },
    gold: { cases: 8, projects: 2, maxRejection: 0.2 },
    red: { cases: 15, projects: 3, maxRejection: 0.1 },
  },
  withoutCasesMax: 'blue',
  rejectionSample: 10,
};

const count = (value: number) => Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

export function computeRichness(input: RichnessInput, t: GlowThresholds = defaultGlowThresholds): Richness {
  const confirmed = count(input.confirmedCases);
  const projects = count(input.projects);
  const effectiveCompleted = Math.max(0, count(input.completedPeak) - count(input.rejectedAtPeak));
  const parts: RichnessParts = {
    confirmedCases: confirmed * t.weights.confirmedCase,
    participatedCases: Math.min(t.limits.participated, count(input.participatedCases) * t.weights.participatedCase),
    projects: Math.min(t.limits.projects, projects) * t.weights.project,
    completed: Math.min(t.limits.completed, Math.floor(effectiveCompleted / t.weights.completedPerPoint)),
  };
  const score = parts.confirmedCases + parts.participatedCases + parts.projects + parts.completed;
  const completedNow = count(input.completedNow);
  const rejectionRate = completedNow >= t.rejectionSample ? count(input.rejectedNow) / completedNow : null;

  const scoreTier = [...glowTiers].reverse().find((tier) => score >= t.minimumScore[tier]) ?? 'white';
  const caps: GlowCap[] = [];
  let tier: AutoGlowTier = scoreTier;
  // Walk down from the score's tier until every requirement of the tier holds; record the first reason found.
  while (tier !== 'white') {
    const index = glowTiers.indexOf(tier);
    const requirement = t.requirements[tier];
    let cap: GlowCap | null = null;
    if (confirmed === 0 && index > glowTiers.indexOf(t.withoutCasesMax)) cap = { kind: 'no-cases' };
    else if (requirement && rejectionRate !== null && rejectionRate > requirement.maxRejection) {
      cap = { kind: 'rejection', limit: requirement.maxRejection, rate: rejectionRate };
    } else if (requirement && confirmed < requirement.cases) {
      cap = { kind: 'cases', tier, need: requirement.cases, have: confirmed };
    } else if (requirement && projects < requirement.projects) {
      cap = { kind: 'projects', tier, need: requirement.projects, have: projects };
    }
    if (!cap) break;
    const found = cap;
    // A stricter rejection gate further down replaces the looser one above (one rejection line in the tooltip).
    const kept = caps.filter((existing) => existing.kind !== found.kind || found.kind === 'cases' || found.kind === 'projects');
    caps.length = 0;
    caps.push(...kept, found);
    tier = glowTiers[index - 1];
  }
  const counted: RichnessInput = {
    confirmedCases: confirmed, participatedCases: count(input.participatedCases), completedPeak: count(input.completedPeak),
    rejectedAtPeak: count(input.rejectedAtPeak), completedNow, rejectedNow: count(input.rejectedNow), projects,
  };
  return { input: counted, effectiveCompleted, score, parts, scoreTier, tier, caps, rejectionRate };
}

export interface GlowAward {
  /** ISO time of the award. */
  awardedAt: string;
  reason: string;
}

/** A manual award always wins; rainbow is never reached automatically. */
export function glowOf(richness: Pick<Richness, 'tier'>, award: GlowAward | null | undefined): GlowTier {
  return award ? 'rainbow' : richness.tier;
}

const percent = (value: number) => Math.round(value * 100) + '%';

/** Human-readable explanation of a cap (badge tooltip). */
export function capText(cap: GlowCap): string {
  switch (cap.kind) {
    case 'no-cases': return '沒有自己承辦的已確認判例,最高到藍晶';
    case 'rejection': return '退回率 ' + percent(cap.rate) + ',超過 ' + percent(cap.limit) + ',' +
      (cap.limit >= 0.2 ? '最高到藍晶' : '不能到紅晶');
    case 'cases': return glowNames[cap.tier] + '需要 ' + cap.need + ' 份承辦的已確認判例(目前 ' + cap.have + ' 份)';
    case 'projects': return glowNames[cap.tier] + '需要 ' + cap.need + ' 個專案(目前 ' + cap.have + ' 個)';
  }
}

/** Maximum length of an award reason after normalisation. */
export const awardReasonLimit = 80;

/** Trims, turns line breaks into spaces; returns null when the result is longer than the limit. */
export function normaliseAwardReason(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\r\n|[\r\n\u2028\u2029]/g, ' ').trim();
  return Array.from(text).length <= awardReasonLimit ? text : null;
}
