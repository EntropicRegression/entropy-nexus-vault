import type { CrystalLink } from '../../shared/types';

export type LinkKind = CrystalLink['kind'];

export const linkStyles = {
  lineage: { label: '經驗傳承', symbol: '━', color: 'rgba(245,185,99,.85)', width: 2.5, dash: [] },
  delegate: { label: '交辦協作', symbol: '┄', color: 'rgba(56,189,248,.65)', width: 1.8, dash: [7, 5] },
  meeting: { label: '會議同席', symbol: '⋯', color: 'rgba(167,139,250,.68)', width: 1.8, dash: [3, 5] },
  project: { label: '同專案', symbol: '◇', color: 'rgba(52,211,153,.48)', width: 1.4, dash: [10, 8] },
} satisfies Record<LinkKind, { label: string; symbol: string; color: string; width: number; dash: number[] }>;

export const linkKinds = Object.keys(linkStyles) as LinkKind[];
export interface LinkSegment { kind: LinkKind; from: string; to: string; label: string }

export function toLinkSegments(links: readonly CrystalLink[], nodeIds: ReadonlySet<string>): LinkSegment[] {
  interface Connection { kind: LinkKind; from: string; to: string; count: number; name: string }
  const paths = new Map<string, Connection>();
  // Projects are grouped by their opaque key, so two different projects sharing a name stay separate links.
  function add(kind: LinkKind, from: string, to: string, count = 0, project = '', name = '') {
    if (from === to || !nodeIds.has(from) || !nodeIds.has(to)) return;
    const key = JSON.stringify([kind, from, to, project]);
    const connection = paths.get(key);
    if (connection) connection.count += count;
    else paths.set(key, { kind, from, to, count, name });
  }
  for (const link of links) {
    if (link.kind === 'lineage') add(link.kind, link.from, link.to);
    else if (link.kind === 'delegate') add(link.kind, link.from, link.to, link.count);
    else {
      const ids = [...new Set(link.nodeIds)].filter((id) => nodeIds.has(id)).sort();
      for (const [i, from] of ids.entries()) {
        for (const to of ids.slice(i + 1)) {
          if (link.kind === 'meeting') add(link.kind, from, to, link.count);
          else add(link.kind, from, to, 0, link.projectKey, link.projectName);
        }
      }
    }
  }
  return [...paths.values()].map(({ kind, from, to, count, name }) => ({
    kind, from, to, label: kind === 'lineage' ? '接回自' : kind === 'delegate' ? '交辦 ×' + count :
      kind === 'meeting' ? '會議同席 ×' + count : name,
  }));
}
