import type { AutoGlowTier } from '../../shared/glow';
import type { CrystalList, GalaxyMap } from '../../shared/types';

type Enabled = Extract<GalaxyMap, { enabled: true }>;

/** Brightness of a galaxy with no node of the chosen tier: almost dark, but its outline is still there. */
export const emptyGlowBrightness = 0.12;
/** Brightness of the galaxy with the fewest (but some) nodes of the tier; the galaxy with the most is 1. */
export const minimumLitBrightness = 0.4;

export interface GlowFilterView {
  /** Per galaxy/nebula key: how many of its members have the tier, and how bright it is drawn. */
  groups: Map<string, { count: number; brightness: number }>;
  /** Nodes that have the tier (the hub and the outer belt stay bright only for these). */
  nodes: Set<string>;
  total: number;
}

/**
 * Galaxy brightness for the colour quick filter (DESIGN.md §6.10.1). Decided by the **number** of the group's members
 * that have the tier, relative to the group with the most: count 0 → 0.12; otherwise 0.40 + 0.60 × count / max.
 * A count (not a share) is used so that "where are most of my gold nodes" reads at a glance — a share would light a
 * one-node galaxy as brightly as a twelve-node one. Rainbow (awarded by hand) is not a filter tier; an awarded node
 * shows as rainbow and is counted only in the rainbow showcase.
 */
export function glowFilterView(map: Enabled, crystals: CrystalList['crystals'], tier: AutoGlowTier): GlowFilterView {
  const nodes = new Set(crystals.filter((node) => (node.glow ?? 'white') === tier).map((node) => node.nodeId));
  const counts = new Map(map.groups.map((group) => [group.key, group.members.filter((id) => nodes.has(id)).length]));
  const max = Math.max(0, ...counts.values());
  const groups = new Map([...counts].map(([key, count]) => [key, {
    count,
    brightness: count === 0 || max === 0 ? emptyGlowBrightness : minimumLitBrightness + (1 - minimumLitBrightness) * (count / max),
  }]));
  return { groups, nodes, total: nodes.size };
}

/** Counts per tier over the whole star map (shown on the filter buttons). */
export function glowTotals(crystals: CrystalList['crystals']): Map<string, number> {
  const totals = new Map<string, number>();
  for (const node of crystals) totals.set(node.glow ?? 'white', (totals.get(node.glow ?? 'white') ?? 0) + 1);
  return totals;
}
