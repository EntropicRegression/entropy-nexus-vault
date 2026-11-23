/** Experience richness and crystal glow tiers (DESIGN.md §6.9 version 3, user 2026-11-24; docs/架構.md §9.2). */

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
  /**
   * Highest 退回數 seen, recorded independently of the 完成數 peak (M5c review B1): a rejection pressed later, without a
   * new completion, still lowers the effective completed count.
   */
  rejectedPeak: number;
  /** Current 完成數 in the console's 180-day window; folded into the peak, shown in the tooltip (version 3 has no rejection gate). */
  completedNow: number;
  /** Current 退回數 in the same window. */
  rejectedNow: number;
  /** Distinct projects (by opaque project key). */
  projects: number;
  /**
   * git = only projects the stats' 專案表 marks as git repos were counted (M5c review B4); all = the stats had no
   * 專案表, so shared non-git folders are counted too (approximate).
   */
  projectScope?: 'git' | 'all';
}

export interface RichnessParts {
  confirmedCases: number;
  participatedCases: number;
  projects: number;
  completed: number;
}

/** Why a node stops below the tier its score would reach (version 3, user 2026-11-24). */
export type GlowCap =
  | { kind: 'involvement'; tier: AutoGlowTier; need: number; have: number }
  | { kind: 'cases'; tier: AutoGlowTier; need: number; have: number }
  | { kind: 'projects'; tier: AutoGlowTier; need: number; have: number }
  | { kind: 'breadth'; tier: AutoGlowTier; needProjects: number; needParticipated: number; projects: number; participated: number }
  | { kind: 'completed'; tier: AutoGlowTier; need: number; have: number };

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
}

/** Minimum counts for a tier; each is "at least", so 承辦+參與 > 1 is involvement: 2. */
export interface GlowRequirement {
  /** Own plus participated confirmed cases. */
  involvement?: number;
  /** Own confirmed cases. */
  cases?: number;
  projects?: number;
  /** Either this many projects or this many participated cases. */
  breadth?: { projects: number; participated: number };
  /** Effective completed tasks (peak − rejected peak). */
  completed?: number;
}

export interface GlowThresholds {
  /** Points per item; completed counts one point per effective completed task. No item has a cap (version 3). */
  weights: { confirmedCase: number; participatedCase: number; project: number; completed: number };
  /** Minimum score for each tier, in tier order. */
  minimumScore: Record<AutoGlowTier, number>;
  /** Extra requirements for violet and above. */
  requirements: Partial<Record<AutoGlowTier, GlowRequirement>>;
}

/** Version 3 (user 2026-11-24): no caps, no rejection gate, no "own case" rule below gold's involvement. */
export const defaultGlowThresholds: GlowThresholds = {
  weights: { confirmedCase: 20, participatedCase: 10, project: 15, completed: 1 },
  minimumScore: { white: 0, green: 10, blue: 100, violet: 150, gold: 250, red: 320 },
  requirements: {
    violet: { involvement: 1 },
    gold: { involvement: 2, projects: 2 },
    red: { cases: 3, breadth: { projects: 3, participated: 5 }, completed: 201 },
  },
};

const count = (value: number) => Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

function unmet(tier: AutoGlowTier, need: GlowRequirement, have: { cases: number; participated: number; projects: number; completed: number }): GlowCap[] {
  const caps: GlowCap[] = [];
  const involvement = have.cases + have.participated;
  if (need.involvement !== undefined && involvement < need.involvement) caps.push({ kind: 'involvement', tier, need: need.involvement, have: involvement });
  if (need.cases !== undefined && have.cases < need.cases) caps.push({ kind: 'cases', tier, need: need.cases, have: have.cases });
  if (need.projects !== undefined && have.projects < need.projects) caps.push({ kind: 'projects', tier, need: need.projects, have: have.projects });
  if (need.breadth && have.projects < need.breadth.projects && have.participated < need.breadth.participated) {
    caps.push({ kind: 'breadth', tier, needProjects: need.breadth.projects, needParticipated: need.breadth.participated,
      projects: have.projects, participated: have.participated });
  }
  if (need.completed !== undefined && have.completed < need.completed) caps.push({ kind: 'completed', tier, need: need.completed, have: have.completed });
  return caps;
}

export function computeRichness(input: RichnessInput, t: GlowThresholds = defaultGlowThresholds): Richness {
  const confirmed = count(input.confirmedCases);
  const participated = count(input.participatedCases);
  const projects = count(input.projects);
  const effectiveCompleted = Math.max(0, count(input.completedPeak) - count(input.rejectedPeak));
  const parts: RichnessParts = {
    confirmedCases: confirmed * t.weights.confirmedCase,
    participatedCases: participated * t.weights.participatedCase,
    projects: projects * t.weights.project,
    completed: effectiveCompleted * t.weights.completed,
  };
  const score = parts.confirmedCases + parts.participatedCases + parts.projects + parts.completed;
  const scoreTier = [...glowTiers].reverse().find((tier) => score >= t.minimumScore[tier]) ?? 'white';
  const have = { cases: confirmed, participated, projects, completed: effectiveCompleted };
  const caps: GlowCap[] = [];
  let tier: AutoGlowTier = scoreTier;
  // Walk down from the score's tier until every requirement of the tier holds; list what each skipped tier lacked.
  while (tier !== 'white') {
    const requirement = t.requirements[tier];
    const missing = requirement ? unmet(tier, requirement, have) : [];
    if (!missing.length) break;
    caps.push(...missing);
    tier = glowTiers[glowTiers.indexOf(tier) - 1];
  }
  const counted: RichnessInput = {
    confirmedCases: confirmed, participatedCases: participated, completedPeak: count(input.completedPeak),
    rejectedPeak: count(input.rejectedPeak), completedNow: count(input.completedNow), rejectedNow: count(input.rejectedNow), projects,
    projectScope: input.projectScope ?? 'all',
  };
  return { input: counted, effectiveCompleted, score, parts, scoreTier, tier, caps };
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


/** Human-readable explanation of a cap (badge tooltip). */
export function capText(cap: GlowCap): string {
  switch (cap.kind) {
    case 'involvement': return glowNames[cap.tier] + '需要至少 ' + cap.need + ' 份承辦或參與的已確認判例(目前 ' + cap.have + ' 份)';
    case 'cases': return glowNames[cap.tier] + '需要至少 ' + cap.need + ' 份承辦的已確認判例(目前 ' + cap.have + ' 份)';
    case 'projects': return glowNames[cap.tier] + '需要至少 ' + cap.need + ' 個專案(目前 ' + cap.have + ' 個)';
    case 'breadth': return glowNames[cap.tier] + '需要至少 ' + cap.needProjects + ' 個專案或 ' + cap.needParticipated +
      ' 份參與的已確認判例(目前 ' + cap.projects + ' 個專案、' + cap.participated + ' 份參與)';
    case 'completed': return glowNames[cap.tier] + '需要有效完成至少 ' + cap.need + ' 件(目前 ' + cap.have + ' 件)';
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
