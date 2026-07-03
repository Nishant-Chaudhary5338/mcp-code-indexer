import type { NodeType, HealthLevel } from '@repo/code-graph-core';

export type Theme = 'dark' | 'light';

// Node type → color. Retuned to the ember/signal identity (see
// docs/EXPLORER_REDESIGN.md §B): one ember accent that means "the thing you
// render" (component), one neutral ramp for structure, violet for behaviour.
// These are tuned for the DARK canvas (#05060a) — bright hues read on near-black.
export const TYPE_COLOR: Record<NodeType, string> = {
  repo: '#F2F3F5', // bright neutral — the root
  app: '#5B9DFF', // info blue — an application surface
  package: '#46D88A', // ok green — a unit that builds
  // Structure types share a cool steel-cyan family — colorful and calm (never
  // dead grey), so warm component/function nodes still read as the stars. Folder
  // is the deeper container; file is the lighter, most-numerous grain.
  folder: '#4E7A8F', // deep steel-teal — a container
  file: '#8FC2D6', // soft steel-cyan — the grain (lighter than folder)
  component: '#FF6A2B', // EMBER — the star
  function: '#C792EA', // violet — behaviour / logic
  external: '#C2A878', // warm tan — a third-party (node_modules) package
};

// The paper (#fbfbfa) counterpart: the dark-canvas hues (near-white repo, light
// grey file, pastel violet) vanish on white, so every type gets a deeper,
// higher-contrast variant. Same identity (blue app, green pkg, ember component,
// violet fn) — just darkened to read on a light ground.
export const TYPE_COLOR_LIGHT: Record<NodeType, string> = {
  repo: '#0F172A', // ink — the root
  app: '#2563EB', // blue-600
  package: '#15803D', // green-700
  folder: '#3F6579', // deep steel-teal — container (matches the dark identity)
  file: '#5091A8', // steel-cyan — the grain, distinct from app-blue, reads on white
  component: '#E8551A', // deepened ember (matches the light --color-accent)
  function: '#7C3AED', // violet-600
  external: '#8A6D3B', // bronze — third-party package, distinct from the cool ramp
};

export const nodeTypeColor = (type: NodeType, theme: Theme): string =>
  (theme === 'light' ? TYPE_COLOR_LIGHT : TYPE_COLOR)[type];

// Health palette — paired everywhere with text/icons (never color alone).
export const HEALTH_COLOR: Record<HealthLevel, string> = {
  ok: '#46D88A',
  warn: '#F5B544',
  error: '#F2606A',
  unknown: '#474B52',
};

// Edges read as light, low-alpha threads; only the active relation lights up.
// renders = signal teal (UI composition), calls = ember (behaviour flow),
// depends-on = info blue (package graph). Structure stays faint.
export const EDGE_COLOR: Record<string, string> = {
  contains: 'rgba(71,75,82,0.22)',
  imports: 'rgba(157,162,169,0.30)',
  references: 'rgba(107,112,121,0.22)',
  renders: 'rgba(63,217,196,0.45)',
  calls: 'rgba(255,140,90,0.42)',
  'depends-on': 'rgba(91,157,255,0.45)',
};

// Paper edges: the white-ish dark-theme threads are invisible on white, so use
// ink-alpha for structure and deeper hues for the semantic relations.
export const EDGE_COLOR_LIGHT: Record<string, string> = {
  contains: 'rgba(15,23,42,0.10)',
  imports: 'rgba(51,65,85,0.28)',
  references: 'rgba(71,85,105,0.20)',
  renders: 'rgba(13,148,136,0.6)',
  calls: 'rgba(216,93,30,0.55)',
  'depends-on': 'rgba(37,99,235,0.55)',
};

const EDGE_FALLBACK: Record<Theme, string> = {
  dark: 'rgba(100,100,120,0.3)',
  light: 'rgba(30,41,59,0.25)',
};

export const edgeTypeColor = (type: string, theme: Theme): string =>
  (theme === 'light' ? EDGE_COLOR_LIGHT : EDGE_COLOR)[type] ?? EDGE_FALLBACK[theme];

/** Hover-trace highlight for a hot edge — readable on each ground. */
export const HOT_EDGE_COLOR: Record<Theme, string> = {
  dark: 'rgba(196,181,253,0.95)',
  light: 'rgba(109,40,217,0.9)',
};

// Blast radius IS the alarm in this vocabulary — honest err red (the old viewer's
// magenta is retired; warn-amber stays reserved for cycles, so the two never
// collide). Selection is ember; hover-trace halo is signal-bright.
export const SELECTED_COLOR = '#FF6A2B'; // ember
export const TRACE_COLOR = '#67ECDA'; // signal-bright (hover trace)
export const IMPACT_COLOR = '#F2606A'; // err red (blast radius)
export const CYCLE_COLOR = '#F5B544'; // warn amber (cycle members)
export const DIMMED_COLOR = '#1C1F23'; // surface-3 — backgrounded nodes (dark)

// On paper, backgrounded nodes must fade toward the page, not toward black.
export const DIMMED_COLOR_LIGHT = '#C8CCD2';
export const dimmedColor = (theme: Theme): string =>
  theme === 'light' ? DIMMED_COLOR_LIGHT : DIMMED_COLOR;

// Per reverse-query highlight color — what the painted match set glows. Each
// reads as the relation it answers, so the panel swatch and the graph agree.
export const QUERY_COLOR: Record<string, string> = {
  renders: '#3FD9C4', // signal teal — UI composition
  calls: '#FF8C5A', // ember-bright — behaviour
  references: '#9DA2A9', // muted — generic reference
  'blast-radius': IMPACT_COLOR, // err red — impact
};

// The WebGL/2D canvas ground per theme — matches `--page-bg` in index.css so the
// graph surface recolors with the chrome (the canvas can't read a CSS var).
export const CANVAS_BG: Record<'dark' | 'light', string> = {
  dark: '#05060a',
  light: '#fbfbfa',
};

const MIN_SIZE = 3;
const MAX_SIZE = 11;

export const nodeSize = (loc: number, childCount: number): number => {
  const weight = Math.max(loc, childCount * 30);
  const scaled = MIN_SIZE + Math.log10(weight + 1) * 2.4;
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, scaled));
};

/**
 * Render-cost tier derived from the visible graph size. Large graphs freeze on
 * software-rendered canvas / weaker GPUs (notably Windows laptops) because every
 * link animates a directional particle and is drawn as a bezier curve, every 3D
 * node is a high-poly sphere, and the bloom pass runs full-screen each frame.
 * Above these thresholds we drop the expensive-but-cosmetic effects and bound the
 * force-sim settle so the main thread is never pinned for long.
 */
export type PerfTier = {
  /** Curve links (pretty) vs straight (much cheaper to paint). */
  curveLinks: boolean;
  /** Animate a particle on EVERY link — fine when small, lethal at scale. */
  ambientParticles: boolean;
  /** Sphere segments for 3D nodes — fewer = lighter geometry. */
  nodeResolution: number;
  /** Full-screen bloom post-process (3D dark mode only). */
  bloom: boolean;
  /** Force-sim tick budget — fewer ticks settle faster on huge graphs. */
  cooldownTicks: number;
  /** Hard cap (ms) on settle time so a big graph can't freeze indefinitely. */
  cooldownTime: number;
  /** Min canvas zoom before 2D node labels are drawn (higher = fewer at scale). */
  labelScale: number;
};

export const perfTierFor = (nodeCount: number, linkCount: number): PerfTier => {
  const heavy = nodeCount > 500 || linkCount > 1200;
  const huge = nodeCount > 1500 || linkCount > 4000;
  return {
    curveLinks: !heavy,
    // Ambient particles animate a mesh on EVERY link every frame — the single
    // biggest reason the canvas never idles. Reserve them for genuinely small
    // views (where the cost is negligible and the sparkle reads as intentional);
    // everywhere else, particles appear only on the hovered/traced links.
    ambientParticles: !heavy && linkCount <= 60,
    // 18 segments is imperceptibly rounder than 14 at node scale but ~40% more
    // geometry per sphere; 14 keeps them smooth while lightening every frame.
    nodeResolution: huge ? 6 : heavy ? 10 : 14,
    bloom: !heavy,
    cooldownTicks: huge ? 100 : heavy ? 160 : 240,
    cooldownTime: huge ? 4000 : heavy ? 8000 : 15000,
    labelScale: heavy ? 1.6 : 1.1,
  };
};
