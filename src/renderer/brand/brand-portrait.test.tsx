// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrandPortraitSettings, MemoryEntry, NodeCrystal } from '../../shared/types';
import { CrystalPortrait } from '../sky/Crystal';
import { AvatarSeals } from '../library/Paper';
import { NodeMatches } from '../library/NodeMatches';
import { BrandPortraitPanel, brandPortraitHelp } from './BrandPortraitPanel';
import { brandPortraitUrl, loadBrandPortraitSettings, portraitSources, resetBrandPortraits, resetNodePortraitOverrides,
  setNodePortraitOverride } from './brand-portrait';

const configured: BrandPortraitSettings = { configured: true, label: '自訂立繪資料夾' };
const unset: BrandPortraitSettings = { configured: false, label: null };
const node = (extra: Partial<NodeCrystal> = {}) => ({
  nodeId: 'n1', name: '晨星', role: null, status: '線上', canWake: false, projectNames: [],
  brand: { vendor: 'claude', mode: 'active' }, ...extra,
}) as NodeCrystal;

describe('廠牌預設立繪:來源順序(純函式)', () => {
  it('四層順序(使用者指定):手動指定 → 廠牌圖 → 節點立繪 → 頭像;頭像章與搜尋小章略過立繪', () => {
    const all = node({ customPortraitUrl: 'vault-image://manual/n1?v=2', portraitUrl: 'vault-image://node/p', avatarUrl: 'vault-image://node/a' });
    expect(portraitSources(all, configured).map((item) => item.source)).toEqual(['custom', 'brand', 'portrait', 'avatar']);
    expect(portraitSources(all, configured, 'avatar').map((item) => item.source)).toEqual(['custom', 'brand', 'avatar']);
    expect(portraitSources(all, unset).map((item) => item.source)).toEqual(['custom', 'portrait', 'avatar']);
    expect(portraitSources(node({ customPortraitUrl: 'vault-image://manual/n1?v=1', brand: undefined }), null).map((item) => item.url))
      .toEqual(['vault-image://manual/n1?v=1']);
  });

  it('沒有手動指定:廠牌圖 → 節點立繪 → 頭像;未設定或沒有廠牌就不請求廠牌圖;沉睡用 dormant', () => {
    const full = node({ portraitUrl: 'vault-image://node/p', avatarUrl: 'vault-image://node/a' });
    expect(portraitSources(full, configured).map((item) => item.source)).toEqual(['brand', 'portrait', 'avatar']);
    expect(portraitSources(full, configured)[0].url).toBe('vault-image://brand/claude/active?v=1');
    expect(portraitSources(full, configured, 'avatar').map((item) => item.source)).toEqual(['brand', 'avatar']);
    expect(portraitSources(full, unset).map((item) => item.source)).toEqual(['portrait', 'avatar']);
    expect(portraitSources(full, null).map((item) => item.source)).toEqual(['portrait', 'avatar']);
    expect(portraitSources(node({ brand: { vendor: null, mode: 'active' } }), configured)).toEqual([]);
    expect(portraitSources(node({ brand: undefined }), configured)).toEqual([]);
    expect(brandPortraitUrl({ vendor: 'gemini', mode: 'dormant' }, configured)).toBe('vault-image://brand/gemini/dormant?v=1');
    // N = generation + 1: always a positive integer, as the main process requires.
    expect(brandPortraitUrl({ vendor: 'gemini', mode: 'dormant' }, configured, 4)).toBe('vault-image://brand/gemini/dormant?v=5');
    expect(portraitSources(full, configured, 'portrait', 2)[0].url).toBe('vault-image://brand/claude/active?v=3');
  });
});

describe('廠牌預設立繪:介面', () => {
  let host: HTMLDivElement;
  let root: Root;
  let vault: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    resetBrandPortraits();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    vault = {
      getBrandPortraitSettings: vi.fn(async () => unset),
      chooseBrandPortraitFolder: vi.fn(async () => configured),
      clearBrandPortraitFolder: vi.fn(async () => unset),
    };
    vi.stubGlobal('vault', vault);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    resetBrandPortraits();
    resetNodePortraitOverrides();
  });

  const img = () => host.querySelector('img')!;
  const fail = async () => act(async () => { img().dispatchEvent(new Event('error')); });

  it('水晶逐級退回:手動指定 → 廠牌圖 → 立繪 → 頭像 → 星座線符', async () => {
    resetBrandPortraits({ settings: configured });
    await act(async () => root.render(<CrystalPortrait node={node({ customPortraitUrl: 'vault-image://manual/n1?v=1',
      portraitUrl: 'vault-image://node/p', avatarUrl: 'vault-image://node/a' })} />));
    expect(img().getAttribute('src')).toBe('vault-image://manual/n1?v=1');
    expect(img().dataset.portraitSource).toBe('custom');
    await fail();
    expect(img().getAttribute('src')).toBe('vault-image://brand/claude/active?v=1');
    expect(img().dataset.portraitSource).toBe('brand');
    await fail();
    expect(img().getAttribute('src')).toBe('vault-image://node/p');
    await fail();
    expect(img().getAttribute('src')).toBe('vault-image://node/a');
    await fail();
    expect(img().dataset.portrait).toBe('constellation');
  });

  it('本次指定或清除立即套用到所有顯示處;換記憶庫時重置', async () => {
    resetBrandPortraits({ settings: configured });
    const crystal = node({ portraitUrl: 'vault-image://node/p' });
    const entry = { nodeId: 'n1', nodeIds: ['n1'], nodeLabel: '晨星' } as unknown as MemoryEntry;
    await act(async () => root.render(<><CrystalPortrait node={crystal} /><AvatarSeals entry={entry} nodes={new Map([['n1', crystal]])} /></>));
    const sources = () => [...host.querySelectorAll('img')].map((image) => image.getAttribute('src'));
    expect(sources()).toEqual(['vault-image://brand/claude/active?v=1', 'vault-image://brand/claude/active?v=1']);
    await act(async () => setNodePortraitOverride('n1', 'vault-image://manual/n1?v=3'));
    expect(sources()).toEqual(['vault-image://manual/n1?v=3', 'vault-image://manual/n1?v=3']);
    await act(async () => setNodePortraitOverride('n1', null));
    expect(sources()).toEqual(['vault-image://brand/claude/active?v=1', 'vault-image://brand/claude/active?v=1']);
    await act(async () => setNodePortraitOverride('n1', 'vault-image://manual/n1?v=4'));
    await act(async () => resetNodePortraitOverrides());
    expect(sources()[0]).toBe('vault-image://brand/claude/active?v=1');
  });

  it('未設定資料夾:沒有自己的圖就直接用星座線符,不請求廠牌網址;沉睡節點用 dormant 圖', async () => {
    await act(async () => loadBrandPortraitSettings());
    await act(async () => root.render(<CrystalPortrait node={node()} />));
    expect(img().dataset.portrait).toBe('constellation');
    expect(host.innerHTML).not.toContain('vault-image://brand');
    resetBrandPortraits({ settings: configured });
    await act(async () => root.render(<CrystalPortrait node={node({ status: '休眠', brand: { vendor: 'codex', mode: 'dormant' } })} />));
    expect(img().getAttribute('src')).toBe('vault-image://brand/codex/dormant?v=1');
  });

  it('重新選擇資料夾:版本 ?v=N 遞增、失敗記錄重置並重新讀取;取消或失敗維持原版本;清除也遞增', async () => {
    resetBrandPortraits({ settings: configured });
    await act(async () => root.render(<><CrystalPortrait node={node()} /><BrandPortraitPanel onClose={() => {}} /></>));
    expect(img().getAttribute('src')).toBe('vault-image://brand/claude/active?v=1');
    await fail();
    expect(img().dataset.portrait).toBe('constellation');
    vault.chooseBrandPortraitFolder.mockResolvedValueOnce(null);
    await act(async () => [...host.querySelectorAll('button')].find((b) => b.textContent === '重新選擇資料夾')!.click());
    expect(img().dataset.portrait).toBe('constellation');
    vault.chooseBrandPortraitFolder.mockRejectedValueOnce(new Error('io'));
    await act(async () => [...host.querySelectorAll('button')].find((b) => b.textContent === '重新選擇資料夾')!.click());
    expect(img().dataset.portrait).toBe('constellation');
    await act(async () => [...host.querySelectorAll('button')].find((b) => b.textContent === '重新選擇資料夾')!.click());
    expect(img().getAttribute('src')).toBe('vault-image://brand/claude/active?v=2');
    await act(async () => [...host.querySelectorAll('button')].find((b) => b.textContent === '清除')!.click());
    await act(async () => [...host.querySelectorAll('button')].find((b) => b.textContent === '選擇資料夾')!.click());
    expect(img().getAttribute('src')).toBe('vault-image://brand/claude/active?v=4');
  });

  it('設定面板:未設定 → 選擇 → 顯示代稱 → 清除;Esc 關閉;畫面沒有路徑', async () => {
    const onClose = vi.fn();
    await act(async () => loadBrandPortraitSettings());
    await act(async () => root.render(<BrandPortraitPanel onClose={onClose} />));
    const status = () => host.querySelector('[data-brand-status]')!;
    expect(host.textContent).toContain(brandPortraitHelp);
    expect(status().getAttribute('data-brand-status')).toBe('unset');
    const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === text)!;
    expect(button('清除').disabled).toBe(true);
    expect(document.activeElement).toBe(button('選擇資料夾'));
    await act(async () => button('選擇資料夾').click());
    expect(vault.chooseBrandPortraitFolder).toHaveBeenCalledTimes(1);
    expect(status().textContent).toBe('已設定:自訂立繪資料夾');
    // The buttons were disabled while choosing; focus is back inside the panel so Esc still works.
    expect(host.querySelector('[data-brand-panel]')!.contains(document.activeElement)).toBe(true);
    expect(host.innerHTML).not.toMatch(/\b[a-z]:[\\/](?!\/)|users[\\/]|\/home\//i);
    await act(async () => button('清除').click());
    expect(status().getAttribute('data-brand-status')).toBe('unset');
    vault.chooseBrandPortraitFolder.mockRejectedValueOnce(new Error('x'));
    await act(async () => button('選擇資料夾').click());
    expect(host.querySelector('[role="alert"]')!.textContent).toBe('無法設定立繪資料夾,請再試一次。');
    await act(async () => { button('關閉').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('樓下搜尋小章:頭像 → 廠牌圖(NodeHit 帶 brand)→ 名字首字;未設定時不請求廠牌圖', async () => {
    const hit = { nodeId: 'n1', name: '晨星', role: null, status: '休眠' as const, matchedIn: '名稱' as const,
      avatarUrl: 'vault-image://node/a', brand: { vendor: 'codex' as const, mode: 'dormant' as const } };
    await act(async () => root.render(<NodeMatches hits={[hit]} onNode={() => {}} />));
    expect(img().getAttribute('src')).toBe('vault-image://node/a');
    await fail();
    expect(host.querySelector('img')).toBeNull();
    resetBrandPortraits({ settings: configured });
    await act(async () => root.render(<NodeMatches hits={[{ ...hit }]} onNode={() => {}} />));
    await act(async () => root.render(<NodeMatches hits={[{ ...hit, avatarUrl: null }]} onNode={() => {}} />));
    expect(img().getAttribute('src')).toBe('vault-image://brand/codex/dormant?v=1');
    expect(img().dataset.portraitSource).toBe('brand');
    await fail();
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('[data-node-hit]')!.textContent).toContain('晨');
    await act(async () => root.render(<NodeMatches hits={[{ ...hit, nodeId: 'n2', customPortraitUrl: 'vault-image://manual/n2?v=1' }]} onNode={() => {}} />));
    expect(img().getAttribute('src')).toBe('vault-image://manual/n2?v=1');
    expect(img().dataset.portraitSource).toBe('custom');
  });

  it('樓下頭像章:手動指定 → 廠牌圖 → 頭像(圓形裁切沿用 .seal)→ 名字首字;不用全身立繪', async () => {
    resetBrandPortraits({ settings: configured });
    const crystal = node({ customPortraitUrl: 'vault-image://manual/n1?v=1', avatarUrl: 'vault-image://node/a', portraitUrl: 'vault-image://node/p' });
    const entry = { nodeId: 'n1', nodeIds: ['n1'], nodeLabel: '晨星' } as unknown as MemoryEntry;
    await act(async () => root.render(<AvatarSeals entry={entry} nodes={new Map([['n1', crystal]])} />));
    expect(img().getAttribute('src')).toBe('vault-image://manual/n1?v=1');
    await fail();
    expect(img().getAttribute('src')).toBe('vault-image://brand/claude/active?v=1');
    await fail();
    expect(img().getAttribute('src')).toBe('vault-image://node/a');
    await fail();
    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toContain('晨');
  });
});
