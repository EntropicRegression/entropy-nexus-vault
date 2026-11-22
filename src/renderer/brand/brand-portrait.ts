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

/**
 * vault-image://brand/<vendor>/<state>?v=N, only when a folder is set and the node's vendor is known. N is the folder
 * generation + 1 (a positive integer, docs/架構.md §4.2): the main process ignores it, but a new N makes Chromium request
 * the image again after the folder is chosen anew, instead of reusing the image it already decoded for that URL.
 */
export function brandPortraitUrl(brand: CrystalBrand | undefined, settings: BrandPortraitSettings | null, generation = 0): string | null {
  if (!settings?.configured || !brand?.vendor) return null;
  return 'vault-image://brand/' + brand.vendor + '/' + brand.mode + '?v=' + (Math.max(0, Math.floor(generation)) + 1);
}

export type PortraitSource = 'custom' | 'brand' | 'portrait' | 'avatar';
interface PortraitNode {
  nodeId?: string; customPortraitUrl?: string | null; portraitUrl?: string | null; avatarUrl?: string | null; brand?: CrystalBrand;
}

/*
 * Pictures assigned in this session (DESIGN.md §6.5.2): after chooseNodePortrait/clearNodePortrait the new URL (or null)
 * applies at once to every place that shows the node — crystal, panel, seals, search chips — until the next list read
 * carries the same value from the main process.
 */
const customOverrides = new Map<string, string | null>();
const overrideListeners = new Set<() => void>();
let overrideVersion = 0;
function subscribeOverrides(listener: () => void) {
  overrideListeners.add(listener);
  return () => { overrideListeners.delete(listener); };
}
export function setNodePortraitOverride(nodeId: string, url: string | null) {
  customOverrides.set(nodeId, url);
  overrideVersion++;
  for (const listener of overrideListeners) listener();
}
/** For a vault switch and for tests. */
export function resetNodePortraitOverrides() {
  customOverrides.clear();
  overrideVersion++;
  for (const listener of overrideListeners) listener();
}
/** The node's assigned picture URL, with this session's change applied (re-renders when it changes). */
export function useNodeCustomPortrait(node: PortraitNode): string | null | undefined {
  useSyncExternalStore(subscribeOverrides, () => overrideVersion);
  return customUrlOf(node);
}
function customUrlOf(node: PortraitNode): string | null | undefined {
  return node.nodeId !== undefined && customOverrides.has(node.nodeId) ? customOverrides.get(node.nodeId) : node.customPortraitUrl;
}

/**
 * The images to try, best first (user's order, DESIGN.md §6.5.2): the picture the user assigned to the node → the brand
 * default (folder set and vendor known; active/dormant by the node's state) → the node's own portrait → its avatar.
 * Seals and search chips are small and round, so they skip the portrait: assigned → brand → avatar. When all fail the
 * caller shows the first character or the constellation glyph.
 */
export function portraitSources(node: PortraitNode | undefined, settings: BrandPortraitSettings | null,
  from: 'portrait' | 'avatar' = 'portrait', generation = 0): { url: string; source: PortraitSource }[] {
  if (!node) return [];
  const brand = brandPortraitUrl(node.brand, settings, generation);
  const list: { url: string | null | undefined; source: PortraitSource }[] = [
    { url: customUrlOf(node), source: 'custom' },
    { url: brand, source: 'brand' },
    ...(from === 'portrait' ? [{ url: node.portraitUrl, source: 'portrait' as const }] : []),
    { url: node.avatarUrl, source: 'avatar' },
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
  useSyncExternalStore(subscribeOverrides, () => overrideVersion);
  const sources = portraitSources(node, settings, from, generation);
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
