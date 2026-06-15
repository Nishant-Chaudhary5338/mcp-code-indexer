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
  folder: '#555A63', // dark slate — structural container, recedes into the bg
  file: '#B0B6BE', // light grey — the default grain (kept well clear of folder)
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
  folder: '#334155', // slate-700 — dark structural container
  file: '#7C8698', // slate — the grain (lighter than folder, still reads on white)
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
