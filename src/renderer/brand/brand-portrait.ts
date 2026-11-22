import { useEffect, useState, useSyncExternalStore } from 'react';
import type { BrandPortraitSettings, CrystalBrand } from '../../shared/types';

/**
 * Brand default portraits (docs/架構.md §4.2): the user points the app at a folder on their own computer; the main
 * process keeps the path and serves vault-image://brand/<vendor>/<state>. The renderer only knows whether a folder is
 * set and a display label. Images never enter the vault or the installer.
 */
export interface BrandPortraitState {
  /** null until the first read finishes (no brand image is requested before that). */
  settings: BrandPortraitSettings | null;
  /** Bumped whenever the folder is chosen again or cleared, so failed images are retried and reloaded. */
  generation: number;
  busy: boolean;
  error: string | null;
}

const unset: BrandPortraitSettings = { configured: false, label: null };
const initial: BrandPortraitState = { settings: null, generation: 0, busy: false, error: null };
let state = initial;
const listeners = new Set<() => void>();

function update(patch: Partial<BrandPortraitState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useBrandPortraits(): BrandPortraitState {
  return useSyncExternalStore(subscribe, () => state);
}

/** For tests: forget the settings (each test starts unconfigured). */
export function resetBrandPortraits(next: Partial<BrandPortraitState> = {}) {
  state = { ...initial, ...next };
  for (const listener of listeners) listener();
}

export async function loadBrandPortraitSettings(): Promise<void> {
  const read = window.vault.getBrandPortraitSettings;
  if (!read) { update({ settings: unset }); return; }
  try {
    update({ settings: await read(), error: null });
  } catch {
    update({ settings: unset, error: '無法讀取立繪設定。' });
  }
}

export async function chooseBrandPortraitFolder(): Promise<void> {
  const choose = window.vault.chooseBrandPortraitFolder;
  if (!choose || state.busy) return;
  update({ busy: true, error: null });
  try {
    const next = await choose();
    // null: the user cancelled the folder picker; nothing changes.
    update(next ? { settings: next, generation: state.generation + 1, busy: false } : { busy: false });
  } catch {
    update({ busy: false, error: '無法設定立繪資料夾,請再試一次。' });
  }
}

export async function clearBrandPortraitFolder(): Promise<void> {
  const clear = window.vault.clearBrandPortraitFolder;
  if (!clear || state.busy) return;
  update({ busy: true, error: null });
  try {
    update({ settings: await clear(), generation: state.generation + 1, busy: false });
  } catch {
    update({ busy: false, error: '無法清除立繪資料夾,請再試一次。' });
  }
}

/** vault-image://brand/<vendor>/<state>, only when a folder is set and the node's vendor is known. */
export function brandPortraitUrl(brand: CrystalBrand | undefined, settings: BrandPortraitSettings | null): string | null {
  if (!settings?.configured || !brand?.vendor) return null;
  return 'vault-image://brand/' + brand.vendor + '/' + brand.mode;
}

export type PortraitSource = 'portrait' | 'avatar' | 'brand';
interface PortraitNode { portraitUrl?: string | null; avatarUrl?: string | null; brand?: CrystalBrand }

/**
 * The images to try, best first (docs/架構.md §4.2): the node's own portrait → its avatar → the brand default.
 * Seals downstairs are small and round, so they start at the avatar.
 */
export function portraitSources(node: PortraitNode | undefined, settings: BrandPortraitSettings | null,
  from: 'portrait' | 'avatar' = 'portrait'): { url: string; source: PortraitSource }[] {
  if (!node) return [];
  const brand = brandPortraitUrl(node.brand, settings);
  const list: { url: string | null | undefined; source: PortraitSource }[] = [
    ...(from === 'portrait' ? [{ url: node.portraitUrl, source: 'portrait' as const }] : []),
    { url: node.avatarUrl, source: 'avatar' },
    { url: brand, source: 'brand' },
  ];
  const seen = new Set<string>();
  return list.filter((item): item is { url: string; source: PortraitSource } => {
    if (!item.url || seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

/**
 * Walks the list on load errors; null when every image failed (show the fallback). Failures are remembered per
 * folder generation, so choosing the folder again retries the same URLs.
 */
export function usePortraitChain(node: PortraitNode | undefined, from: 'portrait' | 'avatar' = 'portrait') {
  const { settings, generation } = useBrandPortraits();
  const sources = portraitSources(node, settings, from);
  const [failed, setFailed] = useState<{ generation: number; urls: string[] }>({ generation, urls: [] });
  const failedNow = failed.generation === generation ? failed.urls : [];
  useEffect(() => { setFailed((current) => current.generation === generation ? current : { generation, urls: [] }); }, [generation]);
  const current = sources.find((item) => !failedNow.includes(item.url)) ?? null;
  return {
    current,
    generation,
    fail: (url: string) => setFailed((value) => {
      const urls = value.generation === generation ? value.urls : [];
      return urls.includes(url) ? value : { generation, urls: [...urls, url] };
    }),
  };
}
