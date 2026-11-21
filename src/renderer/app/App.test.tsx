// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VaultApi } from '../../shared/ipc';
import type { VaultInfo } from '../../shared/types';
import { App } from './App';

const defaultVault: VaultInfo = { path: 'C:/fixture/vault', exists: true, wakeAvailable: false };

describe('寶庫外殼', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function renderApp(vault: Pick<VaultApi, 'getVaultInfo' | 'chooseVault'>) {
    vi.stubGlobal('vault', vault);
    await act(async () => { root.render(<App />); });
  }

  function getButton(text: string): HTMLButtonElement {
    const button = [...container.querySelectorAll('button')].find((item) => item.textContent.includes(text));
    if (!button) throw new Error(`找不到按鈕「${text}」`);
    return button;
  }

  it('從判例室切換到節點休眠庫後可以返回', async () => {
    await renderApp({
      getVaultInfo: async () => defaultVault,
      chooseVault: async () => null,
    });
    const library = getButton('判例室');
    const sky = getButton('休眠庫');

    expect(container.querySelector('h1')?.textContent).toBe('判例室');
    expect(library.getAttribute('aria-pressed')).toBe('true');
    act(() => sky.click());
    expect(container.querySelector('h1')?.textContent).toBe('節點休眠庫');
    expect(sky.getAttribute('aria-pressed')).toBe('true');
    expect(library.getAttribute('aria-pressed')).toBe('false');
    act(() => library.click());
    expect(container.querySelector('h1')?.textContent).toBe('判例室');
  });

  it('記憶庫不存在時可選擇其他資料夾', async () => {
    const chooseVault = vi.fn(async () => ({ ...defaultVault, path: 'C:/fixture/new-vault' }));
    await renderApp({
      getVaultInfo: async () => ({ ...defaultVault, exists: false }),
      chooseVault,
    });

    expect(container.textContent).toContain('找不到記憶庫資料夾');
    await act(async () => { getButton('選擇資料夾').click(); });

    expect(chooseVault).toHaveBeenCalledOnce();
    expect(container.textContent).not.toContain('找不到記憶庫資料夾');
    expect(getButton('記憶庫位置').title).toBe('C:/fixture/new-vault');
  });
});
