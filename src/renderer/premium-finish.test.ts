import { describe, expect, it } from 'vitest';
import libraryCss from './library/Library.module.css?raw';
import skyCss from './sky/Sky.module.css?raw';
import appCss from './app/App.module.css?raw';
import tokensCss from './styles/tokens.css?raw';
import galaxyCss from './sky/Galaxy.module.css?raw';
import profileCss from './sky/Profile.module.css?raw';
import brandCss from './brand/Brand.module.css?raw';

const normal = (text: string) => text.replace(/\r\n/g, '\n');
const library = normal(libraryCss);
const sky = normal(skyCss);
const app = normal(appCss);
const tokens = normal(tokensCss);
const all = [library, sky, app, galaxyCss, profileCss, brandCss].map(normal).join('\n');

describe('質感精修(M5f,DESIGN.md §10.1)', () => {
  it('紙紋是預先算好的 64×64 平鋪圖,卡片與閱讀紙沒有逐卡即時濾鏡', () => {
    expect(tokens).toMatch(/--paper-tex: url\("data:image\/svg\+xml,[^"]*width='64' height='64'/);
    expect(library).not.toContain('url(#paperGrain)');
    expect(library).toMatch(/\.plaqueFace \{[^}]*background: var\(--paper-tex\) 0 0 \/ 64px 64px, var\(--card-paper\);/);
    expect(library).toMatch(/\.plaqueFace::after \{[^}]*inset: 4px; border: 1px solid var\(--foil-frame\)/);
    expect(library).toMatch(/\.shelf \{[^}]*background: var\(--velvet\);[^}]*box-shadow: var\(--velvet-inset\);/);
  });

  it('動態只剩 hover 上移 2px、開卷淡入、確認時金箔掃光;低動態與系統減少動態全部 0ms', () => {
    expect(app).toContain("--hover-dur: 0ms; --foil-dur: 0ms; }\n@media (prefers-reduced-motion: reduce) { .shell { --paper-fade: 0ms; --stamp-duration: 0ms; --hover-dur: 0ms; --foil-dur: 0ms; } }");
    expect(library).toContain('.plaque:hover .plaqueFace { transform: translateY(-2px);');
    expect(library).toContain('animation: foil-sweep var(--foil-dur) ease-out forwards;');
    expect(sky).toContain('.skyScene .crystal:hover { transform: translateY(-2px); }');
    expect(sky).not.toContain('floatCrystal');
  });

  it('效能:光暈不用 blur 濾鏡;backdrop-filter 只留頂列與單一履歷欄', () => {
    expect(all).not.toMatch(/(?<!backdrop-)filter:\s*blur\(/);
    const blurred = [...all.matchAll(/([^{}]+)\{[^}]*backdrop-filter:\s*blur/g)].map((match) => match[1].trim().split('\n').at(-1)!.trim());
    expect(blurred).toEqual(['.skyScene .detailPanel', '.hud']);
  });

  it('「其餘一律靜止」的兩個例外:彩虹光暈慢轉、星圖外環軌道;兩者在低動態與系統減少動態(data-quiet)都靜止', () => {
    expect(sky).toMatch(/\.crystalAura::before \{[^}]*animation: rainbowSpin 10s linear infinite;/);
    expect(sky).toMatch(/\.ringOuter \{[^}]*animation: orbit1 /);
    expect(sky).toContain(".skyScene[data-quiet='true'] .ring, .skyScene[data-quiet='true'] .crystalShape { animation: none; }");
    expect(sky).toContain(".skyScene[data-quiet='true'] .crystal[data-glow='rainbow'] .crystalAura::before { animation: none; }");
    // Nothing else in the sky sheet runs an endless animation.
    const endless = [...sky.matchAll(/animation:\s*(\w+)[^;]*infinite/g)].map((match) => match[1]);
    expect(new Set(endless)).toEqual(new Set(['orbit1', 'orbit2', 'orbit3', 'orbit4', 'rainbowSpin']));
  });

  it('決策卡的 filter 只能是靜態 drop-shadow:不得含 blur(),也不得有動畫或過場改變它', () => {
    const rules = [...library.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((match) => /\bfilter:/.test(match[2]) && !/backdrop-filter/.test(match[2]));
    const decision = rules.filter((match) => match[1].includes("data-shelf='decision'"));
    expect(decision).toHaveLength(1);
    const value = /(?:^|;)\s*filter:\s*([^;]+)/.exec(decision[0][2])![1].trim();
    expect(value).toMatch(/^(drop-shadow\([^()]*(\([^()]*\)[^()]*)*\)\s*)+$/);
    expect(value).not.toMatch(/blur\(/);
    // Nothing animates or transitions the filter, and no keyframes touch it.
    expect(library).not.toMatch(/transition:[^;]*\bfilter\b/);
    expect(library).not.toMatch(/@keyframes[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\bfilter:/);
    // Every other filter in the library sheet is a static saturate/none, not a blur.
    for (const match of rules) expect(match[2]).not.toMatch(/(?<!backdrop-)filter:\s*[^;]*blur\(/);
  });

  it('水晶:黃銅雙圈座、七級光暈的大小與強度逐級遞增', () => {
    expect(sky).toMatch(/\.skyScene \.crystalPedestal \{[^}]*border: 1\.5px solid var\(--brass\);[^}]*rgba\(217,164,65,0\.55\)/);
    const tiers = ['white', 'green', 'blue', 'violet', 'gold', 'red'].map((tier) => {
      const rule = tier === 'white' ? /\.skyScene \.crystal \{ --aura: var\(--glow-white\); --aura-scale: ([\d.]+); --aura-opacity: ([\d.]+);/
        : new RegExp(String.raw`data-glow='${tier}'\] \{ --aura: var\(--glow-${tier}\); --aura-scale: ([\d.]+); --aura-opacity: ([\d.]+);`);
      const match = rule.exec(sky)!;
      return [Number(match[1]), Number(match[2])];
    });
    for (let i = 1; i < tiers.length; i++) {
      expect(tiers[i][0]).toBeGreaterThan(tiers[i - 1][0]);
      expect(tiers[i][1]).toBeGreaterThan(tiers[i - 1][1]);
    }
  });
});
