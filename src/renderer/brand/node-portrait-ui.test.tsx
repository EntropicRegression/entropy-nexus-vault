// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodePortraitResult } from '../../shared/types';
import { CrystalPortrait } from '../sky/Crystal';
import { NodePortraitControl } from './NodePortraitControl';
import { resetBrandPortraits, resetNodePortraitOverrides } from './brand-portrait';

describe('履歷欄:指定 / 更換 / 清除節點圖片(DESIGN.md §6.5.2)', () => {
  let host: HTMLDivElement;
  let root: Root;
  let vault: { chooseNodePortrait: ReturnType<typeof vi.fn>; clearNodePortrait: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    resetBrandPortraits({ settings: { configured: false, label: null } });
    resetNodePortraitOverrides();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    vault = {
      chooseNodePortrait: vi.fn(async (): Promise<NodePortraitResult | null> => ({ ok: true, customPortraitUrl: 'vault-image://manual/n1?v=1' })),
      clearNodePortrait: vi.fn(async (): Promise<NodePortraitResult> => ({ ok: true, customPortraitUrl: null })),
    };
    vi.stubGlobal('vault', vault);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    resetNodePortraitOverrides();
  });

  const node = { nodeId: 'n1', portraitUrl: 'vault-image://node/n1/portrait', avatarUrl: null, customPortraitUrl: null };
  const button = (text: string) => [...host.querySelectorAll('button')].find((item) => item.textContent === text);
  const status = () => host.querySelector('[data-node-portrait-status]')!;

  it('未指定 → 指定(水晶立刻換成指定圖)→ 更換 → 清除(回到原本順序);取消不變;畫面沒有路徑', async () => {
    await act(async () => root.render(<><CrystalPortrait node={node} /><NodePortraitControl node={node} /></>));
    const picture = () => host.querySelector('img')!.getAttribute('src');
    expect(status().textContent).toBe('節點圖片:未指定');
    expect(picture()).toBe('vault-image://node/n1/portrait');
    expect(button('清除')).toBeUndefined();

    vault.chooseNodePortrait.mockResolvedValueOnce(null);
    await act(async () => button('指定圖片')!.click());
    expect(status().textContent).toBe('節點圖片:未指定');
    expect(host.querySelector('[data-node-portrait-message]')).toBeNull();

    await act(async () => button('指定圖片')!.click());
    expect(vault.chooseNodePortrait).toHaveBeenLastCalledWith('n1');
    expect(status().textContent).toBe('節點圖片:已指定(優先顯示)');
    expect(picture()).toBe('vault-image://manual/n1?v=1');
    expect(host.querySelector('[role="status"]')!.textContent).toBe('已指定,這張圖會優先顯示。');

    vault.chooseNodePortrait.mockResolvedValueOnce({ ok: true, customPortraitUrl: 'vault-image://manual/n1?v=2' });
    await act(async () => button('更換圖片')!.click());
    expect(picture()).toBe('vault-image://manual/n1?v=2');

    await act(async () => button('清除')!.click());
    expect(vault.clearNodePortrait).toHaveBeenCalledWith('n1');
    expect(status().textContent).toBe('節點圖片:未指定');
    expect(picture()).toBe('vault-image://node/n1/portrait');
    expect(host.innerHTML).not.toMatch(/\b[a-z]:[\\/](?!\/)|users[\\/]|node-portraits/i);
  });

  it('拒絕時說明原因(格式、大小、不是圖片、節點不在、寫入失敗、例外),圖片不變;處理中停用按鈕', async () => {
    await act(async () => root.render(<NodePortraitControl node={node} />));
    const cases: [NodePortraitResult, string][] = [
      [{ ok: false, reason: 'unsupported' }, '只接受 PNG、WebP 或 JPEG 圖片。'],
      [{ ok: false, reason: 'too-large' }, '圖片超過 20 MB,請換一張較小的圖。'],
      [{ ok: false, reason: 'not-image' }, '這個檔案不是有效的圖片。'],
      [{ ok: false, reason: 'invalid-node' }, '這個節點目前不在星圖上,無法指定圖片。'],
      [{ ok: false, reason: 'io' }, '圖片沒有存好,請再試一次。'],
    ];
    for (const [result, text] of cases) {
      vault.chooseNodePortrait.mockResolvedValueOnce(result);
      await act(async () => button('指定圖片')!.click());
      expect(host.querySelector('[role="alert"]')!.textContent).toBe(text);
      expect(status().textContent).toBe('節點圖片:未指定');
    }
    vault.chooseNodePortrait.mockRejectedValueOnce(new Error('ipc'));
    await act(async () => button('指定圖片')!.click());
    expect(host.querySelector('[role="alert"]')!.textContent).toBe('圖片沒有存好,請再試一次。');

    let finish!: (value: NodePortraitResult) => void;
    vault.chooseNodePortrait.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    await act(async () => button('指定圖片')!.click());
    expect(button('處理中…')!.disabled).toBe(true);
    await act(async () => finish({ ok: true, customPortraitUrl: 'vault-image://manual/n1?v=1' }));
    expect(button('更換圖片')!.disabled).toBe(false);
  });

  it('沒有這組 IPC 的舊橋接不顯示控制項', async () => {
    vi.stubGlobal('vault', {});
    await act(async () => root.render(<NodePortraitControl node={node} />));
    expect(host.querySelector('[data-node-portrait]')).toBeNull();
  });
});
