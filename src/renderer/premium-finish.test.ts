import { describe, expect, it } from 'vitest';
import libraryCss from './library/Library.module.css?raw';
import skyCss from './sky/Sky.module.css?raw';
import appCss from './app/App.module.css?raw';
import tokensCss from './styles/tokens.css?raw';
import galaxyCss from './sky/Galaxy.module.css?raw';
import profileCss from './sky/Profile.module.css?raw';
import brandCss from './brand/Brand.module.css?raw';
import prismCss from './sky/PrismCrystal.module.css?raw';
import paperGrain from '../../assets/ui/paper-grain.svg?raw';

const normal = (text: string) => text.replace(/\r\n/g, '\n');
const library = normal(libraryCss);
const sky = normal(skyCss);
const app = normal(appCss);
const tokens = normal(tokensCss);
const prism = normal(prismCss);
const all = [library, sky, app, galaxyCss, profileCss, brandCss, prism].map(normal).join('\n');

describe('質感精修(M5f,DESIGN.md §10.1)', () => {
  it('紙紋是預先算好的 64×64 平鋪圖,卡片與閱讀紙沒有逐卡即時濾鏡', () => {
    expect(tokens).toContain("--paper-tex: url('../../../assets/ui/paper-grain.svg');");
    expect(paperGrain).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="64" height="64">/);
    expect(paperGrain).toContain('opacity=".04"');
    expect(library).not.toContain('url(#paperGrain)');
    expect(library).toMatch(/\.plaqueFace \{[^}]*background: var\(--paper-tex\) 0 0 \/ 64px 64px, var\(--card-paper\);/);
    expect(library).toMatch(/\.plaqueFace::after \{[^}]*inset: 4px; border: 1px solid var\(--foil-frame\)/);
    expect(library).toMatch(/\.shelf \{[^}]*background: var\(--velvet\);[^}]*box-shadow: var\(--velvet-inset\);/);
  });

  it('樣式表不內嵌 data: 圖片(App 的 CSP 只允許同源與 vault-image: 圖片,data: 會被擋下;M5g)', () => {
    const sheets = Object.entries(import.meta.glob('./**/*.css', { query: '?raw', import: 'default', eager: true }) as Record<string, string>);
    expect(sheets.length).toBeGreaterThan(5);
    for (const [file, text] of sheets) expect(text, file).not.toMatch(/url\(\s*["']?data:/i);
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
    expect(prism).toMatch(/\.prism\[data-glow='rainbow'\] > \.aura::before \{[^}]*animation: prismRainbow 10s linear infinite;/);
    expect(sky).toMatch(/\.ringOuter \{[^}]*animation: orbit1 /);
    expect(sky).toContain(".skyScene[data-quiet='true'] .ring { animation: none; }");
    expect(prism).toContain("[data-quiet='true'] .prism[data-glow='rainbow'] > .aura::before { animation: none; }");
    // Nothing else in the sky sheets runs an endless animation.
    const endless = [...(sky + prism).matchAll(/animation:\s*(\w+)[^;]*infinite/g)].map((match) => match[1]);
    expect(new Set(endless)).toEqual(new Set(['orbit1', 'orbit2', 'orbit3', 'orbit4', 'prismRainbow']));
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

  it('水晶:黃銅底座加等級色環、七級光暈的大小與強度逐級遞增(M5h 稜鏡水晶)', () => {
    expect(prism).toMatch(/\.pedestal \{[^}]*background: radial-gradient\(ellipse at 50% 35%, rgba\(154,118,72,0\.9\)[^}]*border: 1\.5px solid var\(--ped-ring\);[^}]*box-shadow: var\(--ped-glow\);/);
    const block = (tier: string) => {
      const start = tier === 'white' ? prism.indexOf('.prism {') : prism.indexOf(`.prism[data-glow='${tier}'] {`);
      return prism.slice(start, prism.indexOf('}', start));
    };
    const tiers = ['white', 'green', 'blue', 'violet', 'gold', 'red'].map((tier) => {
      const text = block(tier);
      return [Number(/--aura-scale: ([\d.]+);/.exec(text)![1]), Number(/--aura-opacity: ([\d.]+);/.exec(text)![1])];
    });
    for (let i = 1; i < tiers.length; i++) {
      expect(tiers[i][0]).toBeGreaterThan(tiers[i - 1][0]);
      expect(tiers[i][1]).toBeGreaterThan(tiers[i - 1][1]);
    }
  });
});
