// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CrystalSavepoint, NodeCrystalDetail } from '../../shared/types';
import { DetailPanel } from './DetailPanel';
import { savepointSize } from './savepoints';

const savepoint = (overrides: Partial<CrystalSavepoint> = {}): CrystalSavepoint => ({
  time: Date.parse('2026-11-23T12:00:00Z'), backend: 'claude', size: 3 * 1024 * 1024, originalExists: null,
  restorable: false, restoreTarget: false, ...overrides,
});
const detail = (status: NodeCrystalDetail['status'], canWake: boolean, savepoints: CrystalSavepoint[]): NodeCrystalDetail => ({
  nodeId: 'n1', name: '稜鏡', role: null, status, canWake, projectNames: [], profile: null, stats: null, archives: [],
  relatedEntries: [], confirmedCaseCount: 0, specialty: '', workflow: '', review: '', notRejectedRate: null,
  consoleAppendixCount: 0, savepoints,
});

describe('履歷欄存點(DESIGN.md 6.6.5)', () => {
  let host: HTMLDivElement;
  let root: Root;
  const onWake = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('vault', {});
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    onWake.mockReset();
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function show(value: NodeCrystalDetail) {
    act(() => root.render(<DetailPanel detail={value} loading={false} error={false} onDismiss={() => {}} onWake={onWake} />));
  }
  const statuses = () => [...host.querySelectorAll('[data-savepoint-status]')].map((node) => node.textContent);

  it('沒有存點時不顯示整節', () => {
    show(detail('封存', true, []));
    expect(host.querySelector('[data-savepoints]')).toBeNull();
  });

  it('還原對象只有一顆按鈕,主喚醒按鈕改為說明字;Antigravity 標實驗性', () => {
    show(detail('封存', true, [savepoint({ backend: 'antigravity', originalExists: false, restorable: true, restoreTarget: true }), savepoint()]));
    expect(host.querySelector('[data-savepoints] h3')?.textContent).toBe('存點(2)');
    expect(statuses()).toEqual(['◆ 可從存點還原(實驗性)', '◆ 只剩紀錄']);
    const buttons = host.querySelectorAll('[data-wake-action]');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toBe('從這份存點還原並喚醒');
    expect(host.querySelector('[data-wake-by-savepoint]')?.textContent).toContain('原對話已被 Antigravity 清除');
    act(() => (buttons[0] as HTMLButtonElement).click());
    expect(onWake).toHaveBeenCalledWith(buttons[0], expect.objectContaining({ restoreTarget: true }));
  });

  it('原檔還在:封存可喚醒顯示「可直接喚醒」,線上節點顯示「原檔還在」;沒有還原對象時保留主按鈕', () => {
    show(detail('封存', true, [savepoint({ originalExists: true })]));
    expect(statuses()).toEqual(['◆ 可直接喚醒']);
    expect(host.querySelector('[data-savepoint-restore]')).toBeNull();
    expect(host.querySelector('[data-wake-action]')?.textContent).toBe('⚡ 在主控台喚醒舊 Session');
    show(detail('線上', false, [savepoint({ originalExists: true })]));
    expect(statuses()).toEqual(['◆ 原檔還在']);
  });

  it('預設 3 份,較舊的收合後可展開', () => {
    show(detail('封存', false, [1, 2, 3, 4, 5].map((day) => savepoint({ time: Date.parse(`2026-11-0${day}T00:00:00Z`) }))));
    expect(host.querySelectorAll('[data-savepoint]')).toHaveLength(3);
    const more = host.querySelector<HTMLButtonElement>('[data-savepoints-more]')!;
    expect(more.textContent).toBe('較舊的存點 +2');
    act(() => more.click());
    expect(host.querySelectorAll('[data-savepoint]')).toHaveLength(5);
  });

  it('大小顯示', () => {
    expect([null, 512, 2048, 3 * 1024 * 1024, 5 * 1024 ** 3].map((size) => savepointSize(savepoint({ size }))))
      .toEqual(['—', '512 B', '2.0 KB', '3.0 MB', '5.0 GB']);
  });
});
