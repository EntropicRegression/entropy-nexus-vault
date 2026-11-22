// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodeCrystal } from '../../shared/types';
import { resetBrandPortraits } from '../brand/brand-portrait';
import { PrismCrystal } from './PrismCrystal';
import prismCss from './PrismCrystal.module.css?raw';

const css = prismCss.replace(/\r\n/g, '\n');
const node = (extra: Partial<NodeCrystal> = {}) => ({ portraitUrl: null, avatarUrl: null, brand: undefined, ...extra });

describe('稜鏡水晶元件(M5h,Hagemi 定案規格)', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    resetBrandPortraits();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it('有立繪:主圖排第一、折射環三份同圖(本體、青、粉紅);主圖載入失敗退回中央線符,環改為線符色散', async () => {
    await act(async () => root.render(<PrismCrystal node={node({ portraitUrl: 'vault-image://node/a/portrait' })} glow="gold" />));
    const prism = host.querySelector<HTMLElement>('[data-prism]')!;
    expect(prism.dataset.glow).toBe('gold');
    const images = [...host.querySelectorAll('img')];
    expect(images).toHaveLength(4);
    expect(images[0].dataset.portrait).toBe('image');
    expect(images.every((image) => image.getAttribute('src') === 'vault-image://node/a/portrait')).toBe(true);
    expect(images.slice(1).every((image) => image.getAttribute('alt') === '' && image.closest('[aria-hidden="true"]'))).toBe(true);
    await act(async () => { images[0].dispatchEvent(new Event('error')); });
    expect(host.querySelectorAll('img')).toHaveLength(0);
    expect(host.querySelector<HTMLElement>('[data-portrait]')!.dataset.portrait).toBe('constellation');
    // Glyph plus two fringe copies, all drawn through the glyph mask.
    expect(host.querySelectorAll('[data-prism-shape] span[aria-hidden] span')).toHaveLength(2);
  });

  it('前層切面 SVG:每顆水晶的漸層 id 唯一,且所有 url(#…) 都指得到;外框六角、中央淨空的稜線與星芒都在', async () => {
    await act(async () => root.render(<><PrismCrystal node={node()} glow="white" /><PrismCrystal node={node()} glow="rainbow" /></>));
    const svgs = [...host.querySelectorAll('svg')];
    expect(svgs).toHaveLength(2);
    const ids = svgs.flatMap((svg) => [...svg.querySelectorAll('[id]')].map((item) => item.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(14);
    for (const svg of svgs) {
      const own = new Set([...svg.querySelectorAll('[id]')].map((item) => item.id));
      const refs = [...svg.querySelectorAll('[fill^="url("], [stroke^="url("]')]
        .flatMap((item) => ['fill', 'stroke'].map((name) => /^url\(#([^)]+)\)$/.exec(item.getAttribute(name) ?? '')?.[1]).filter((ref): ref is string => Boolean(ref)));
      expect(refs.length).toBeGreaterThanOrEqual(8);
      for (const ref of refs) expect(own.has(ref)).toBe(true);
      // The central table outline (48,15 → 74,39 → 74,97 → 48,121 → 22,97 → 22,39) is drawn, the table stays clear.
      expect(svg.innerHTML).toContain('48,15 74,39 74,97 48,121 22,97 22,39');
    }
  });

  it('樣式:六角裁切、折射環遮罩是同源 SVG 檔(不是 data:)、全檔無 blur 濾鏡、光暈是 radial-gradient', () => {
    expect(css).toContain('clip-path: polygon(50% 0%, 92% 24%, 92% 76%, 50% 100%, 8% 76%, 8% 24%);');
    expect(css).toContain("mask: url('../../../assets/ui/crystal-ring-mask.svg') 0 0 / 100% 100% no-repeat;");
    expect(css).not.toMatch(/url\(\s*["']?data:/i);
    expect(css).not.toMatch(/blur\(/);
    expect(css).toMatch(/\.aura \{[^}]*background: radial-gradient\(ellipse closest-side/);
    expect(css).toContain('img.fringeCyan { transform: scale(1.15) translate(-2px, -1px);');
    expect(css).toContain('img.fringePink { transform: scale(1.15) translate(2px, 1px);');
    expect(css).toContain('.ringBase { transform: scale(1.13) translateY(-1px);');
  });

  it('七級同時驅動外光暈、背光、玻璃內光與底座色環;選中提亮 #fde68a;封存光暈 ×0.45', () => {
    for (const tier of ['green', 'blue', 'violet', 'gold', 'red', 'rainbow']) {
      const start = css.indexOf(`.prism[data-glow='${tier}'] {`);
      expect(start, tier).toBeGreaterThan(-1);
      const block = css.slice(start, css.indexOf('}', start));
      for (const variable of ['--glow:', '--aura-scale:', '--aura-opacity:', '--backlight:', '--inner:', '--ped-ring:', '--ped-glow:'])
        expect(block, tier + ' ' + variable).toContain(variable);
    }
    expect(css).toContain('.backlight { position: absolute; inset: 0; z-index: 1; pointer-events: none; background: var(--backlight); }');
    expect(css).toMatch(/\.shape \{[^}]*box-shadow: var\(--inner\);/);
    expect(css).toContain("[aria-pressed='true'] > .prism .shape { box-shadow: inset 0 0 30px rgba(253, 230, 138, 0.68); }");
    expect(css).toContain("[aria-pressed='true'] > .prism .pedestal { border-color: #fde68a;");
    expect(css).toContain("[data-archived='true'] > .prism > .aura { opacity: calc(var(--aura-opacity) * 0.45); }");
  });

  it('動態與效能:懸停掃光在低動態與系統減少動態時不畫;水晶多時([data-dense])不畫色散層', () => {
    expect(css).toMatch(/\.sheen \{[^}]*transition: transform 0\.65s/);
    expect(css).toContain(':hover > .prism .sheen { transform: translateX(110%); }');
    expect(css).toContain("[data-quiet='true'] .sheen { display: none; }");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.sheen \{ display: none; \}/);
    expect(css).toContain('[data-dense] .fringeCyan, [data-dense] .fringePink { display: none; }');
    // Each crystal is its own compositor layer: the star map moves anchors every frame, and without a layer every
    // crystal (mask, filtered ring images, blended facets) would repaint per frame (M5h measurement: 31 ms → 10 ms).
    expect(css).toMatch(/\.prism \{[^}]*will-change: transform;/);
  });
});
