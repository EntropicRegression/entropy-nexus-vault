import { useId } from 'react';
import type { NodeCrystal } from '../../shared/types';
import { usePortraitChain } from '../brand/brand-portrait';
import styles from './PrismCrystal.module.css';

/**
 * The prismatic gem crystal (Hagemi's spec, accepted by the user 2026-11-22; DESIGN.md §6.5, §6.9). One reusable
 * piece for the star map and the galaxy interior, so later design changes stay in this file and PrismCrystal.module.css.
 *
 * Layers inside the 96×136 hexagon, back to front:
 *   backlight (tier colour) → main picture (portrait, avatar, brand image, or the constellation glyph) in the 52×106
 *   central table → refraction ring (the outer six facets only, magnified ×1.13 with ±2px cyan/pink fringes) →
 *   facet SVG (six facet gradients, iridescent rims, two vertex stars) → hover sheen.
 * Around it: the aura (a radial gradient, no blur filter) and the brass pedestal with a tier-coloured ring. The glow tier
 * (data-glow) drives aura, backlight, inner glass glow and pedestal ring together.
 */
export function PrismCrystal({ node, glow }: {
  node: Pick<NodeCrystal, 'portraitUrl' | 'avatarUrl' | 'brand'> & Partial<Pick<NodeCrystal, 'nodeId' | 'customPortraitUrl'>>;
  glow: string;
}) {
  const { current, generation, fail } = usePortraitChain(node);
  const key = current ? current.url + '#' + generation : 'constellation';
  return <span className={styles.prism} data-glow={glow} data-prism="">
    <span className={styles.aura} data-prism-aura="" aria-hidden="true" />
    <span className={styles.shape} data-prism-shape="">
      <span className={styles.backlight} aria-hidden="true" />
      {/* The main picture comes first in the DOM (tests and the portrait fallback chain look for it). */}
      {current
        ? <img key={key} className={styles.portrait} src={current.url} alt="" decoding="async"
          data-portrait="image" data-portrait-source={current.source} onError={() => fail(current.url)} />
        : <span className={styles.sigil} data-portrait="constellation" aria-hidden="true" />}
      <span className={styles.ring} aria-hidden="true">
        {current ? <>
          <img key={key + 'r'} className={styles.ringBase} src={current.url} alt="" decoding="async" />
          <img key={key + 'c'} className={styles.fringeCyan} src={current.url} alt="" decoding="async" />
          <img key={key + 'm'} className={styles.fringePink} src={current.url} alt="" decoding="async" />
        </> : <>
          <span className={styles.sigilFringe + ' ' + styles.fringeCyan} />
          <span className={styles.sigilFringe + ' ' + styles.fringePink} />
        </>}
      </span>
      <PrismFacets />
      <span className={styles.sheen} aria-hidden="true" />
    </span>
    <span className={styles.pedestal} data-prism-pedestal="" aria-hidden="true" />
  </span>;
}

/** Front facet layer (viewBox 96×136): six facet gradients, inner and outer iridescent rims, vertex stars. */
function PrismFacets() {
  const id = 'pf' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const ref = (name: string) => 'url(#' + id + name + ')';
  return <svg className={styles.facets} viewBox="0 0 96 136" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id={id + 'tl'} x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#fef9c3" stopOpacity="0.78" /><stop offset="55%" stopColor="#67e8f9" stopOpacity="0.34" /><stop offset="100%" stopColor="#c084fc" stopOpacity="0.15" />
      </linearGradient>
      <linearGradient id={id + 'tr'} x1="100%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#f472b6" stopOpacity="0.46" /><stop offset="100%" stopColor="#38bdf8" stopOpacity="0.12" />
      </linearGradient>
      <linearGradient id={id + 'l'} x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#67e8f9" stopOpacity="0.5" /><stop offset="55%" stopColor="#a855f7" stopOpacity="0.24" /><stop offset="100%" stopColor="#f472b6" stopOpacity="0.4" />
      </linearGradient>
      <linearGradient id={id + 'r'} x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.22" /><stop offset="50%" stopColor="#7e22ce" stopOpacity="0.3" /><stop offset="100%" stopColor="#fde047" stopOpacity="0.36" />
      </linearGradient>
      <linearGradient id={id + 'br'} x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#c084fc" stopOpacity="0.16" /><stop offset="60%" stopColor="#f472b6" stopOpacity="0.42" /><stop offset="100%" stopColor="#fef08a" stopOpacity="0.65" />
      </linearGradient>
      <linearGradient id={id + 'rim'} x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#fef9c3" stopOpacity="0.88" /><stop offset="35%" stopColor="#67e8f9" stopOpacity="0.72" /><stop offset="70%" stopColor="#e879f9" stopOpacity="0.72" /><stop offset="100%" stopColor="#fde68a" stopOpacity="0.85" />
      </linearGradient>
      <linearGradient id={id + 'table'} x1="15%" y1="0%" x2="85%" y2="100%">
        <stop offset="0%" stopColor="#fef9c3" stopOpacity="0.15" /><stop offset="40%" stopColor="#ffffff" stopOpacity="0" /><stop offset="72%" stopColor="#c084fc" stopOpacity="0.06" /><stop offset="100%" stopColor="#67e8f9" stopOpacity="0.14" />
      </linearGradient>
    </defs>
    {/* The facet polygons are grouped and blended once (one screen group), not one blend per polygon. */}
    <g className={styles.facetGlow}>
      <polygon points="48,0 7.68,32.64 22,39 48,15" fill={ref('tl')} />
      <polygon points="48,0 88.32,32.64 74,39 48,15" fill={ref('tr')} />
      <polygon points="7.68,32.64 7.68,103.36 22,97 22,39" fill={ref('l')} />
      <polygon points="88.32,32.64 88.32,103.36 74,97 74,39" fill={ref('r')} />
      <polygon points="88.32,103.36 48,136 48,121 74,97" fill={ref('br')} />
      <polygon points="48,15 74,39 74,97 48,121 22,97 22,39" fill={ref('table')} />
    </g>
    <polygon points="7.68,103.36 48,136 48,121 22,97" fill="rgba(88,28,135,0.28)" />
    <polygon points="48,15 74,39 74,97 48,121 22,97 22,39" fill="none" stroke={ref('rim')} strokeWidth="0.85" opacity="0.85" />
    <path d="M48 0 L48 15 M7.68 32.64 L22 39 M88.32 32.64 L74 39 M7.68 103.36 L22 97 M88.32 103.36 L74 97 M48 136 L48 121"
      stroke="rgba(255,255,255,0.52)" strokeWidth="0.7" fill="none" />
    <polygon points="48,0.8 87.6,32.9 87.6,103.1 48,135.2 8.4,103.1 8.4,32.9" fill="none" stroke={ref('rim')} strokeWidth="1.25" />
    <path d="M22 35 V43 M18 39 H26" stroke="#ffffff" strokeWidth="0.9" strokeLinecap="round" opacity="0.85" />
    <path d="M74 93 V101 M70 97 H78" stroke="#fef08a" strokeWidth="0.8" strokeLinecap="round" opacity="0.72" />
  </svg>;
}
