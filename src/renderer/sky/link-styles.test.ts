import { describe, expect, it } from 'vitest';
import { linkStyles, toLinkSegments } from './link-styles';

describe('星圖關係的線段轉換', () => {
  it('保留傳承與交辦方向，同席和同專案拆出不重複的配對', () => {
    const segments = toLinkSegments([
      { kind: 'lineage', from: 'b', to: 'a' },
      { kind: 'delegate', from: 'a', to: 'b', count: 2, lastAt: '2026-11-22' },
      { kind: 'delegate', from: 'a', to: 'a', count: 7, lastAt: '2026-11-22' },
      { kind: 'meeting', nodeIds: ['c', 'b', 'a', 'c', 'missing'], count: 3 },
      { kind: 'meeting', nodeIds: ['b', 'c'], count: 2 },
      { kind: 'project', nodeIds: ['c', 'a'], projectName: '合成觀測站' },
    ], new Set(['a', 'b', 'c']));
    expect(segments).toEqual([
      { kind: 'lineage', from: 'b', to: 'a', label: '接回自' },
      { kind: 'delegate', from: 'a', to: 'b', label: '交辦 ×2' },
      { kind: 'meeting', from: 'a', to: 'b', label: '會議同席 ×3' },
      { kind: 'meeting', from: 'a', to: 'c', label: '會議同席 ×3' },
      { kind: 'meeting', from: 'b', to: 'c', label: '會議同席 ×5' },
      { kind: 'project', from: 'a', to: 'c', label: '合成觀測站' },
    ]);
    expect(Object.values(linkStyles).map(({ dash }) => dash)).toEqual([[], [7, 5], [3, 5], [10, 8]]);
  });
});
