import { useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph3D, { type ForceGraphMethods } from 'react-force-graph-3d';
import { forceX, forceY, forceZ } from 'd3-force-3d';
import { Vector2, FogExp2, DirectionalLight } from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { GraphNode, NodeType } from '@repo/code-graph-core';
import { hasMetrics } from '@repo/code-graph-core';
import { visibleGraph, visibleDependencyGraph, type GraphIndex } from '../../lib/graph-model';
import type { ColorMode, Layout } from '../../store/graphStore';
import {
  HEALTH_COLOR,
  SELECTED_COLOR,
  nodeTypeColor,
  edgeTypeColor,
  dimmedColor,
  HOT_EDGE_COLOR,
  nodeSize,
  type Theme,
} from '../../lib/graph-style';
import { useElementSize } from '../../lib/useElementSize';

type GraphCanvasProps = {
  index: GraphIndex;
  focusId: string;
  selectedId: string | null;
  statusVersion: number;
  impactSet: Set<string> | null;
  /** Color for the painted query-match set (varies by reverse-query kind). */
  highlightColor: string;
  /** Node/edge types hidden via the filter rail. */
  hiddenTypes: Set<NodeType>;
  hiddenEdges: Set<string>;
  colorMode: ColorMode;
  fitSignal: number;
  /** Canvas ground color (theme-derived); also tints the depth fog. */
  background: string;
  /** Active theme — selects node/edge palettes and gates the bloom wash. */
  theme: Theme;
  /** Structure (folder drill) vs dependency (subtree leaves by deps) layout. */
  layout: Layout;
  onDrill: (id: string) => void;
  onSelect: (id: string) => void;
};

type ForceNode = GraphNode & { x?: number; y?: number; z?: number };
type ForceLink = {
  id: string;
  source: string | ForceNode;
  target: string | ForceNode;
  type: string;
  weight: number;
};

const COOLDOWN_TICKS = 240;
const linkEnd = (end: string | ForceNode): string =>
  typeof end === 'string' ? end : end.id;

export const GraphCanvas = ({
  index,
  focusId,
  selectedId,
  statusVersion,
  impactSet,
  highlightColor,
  hiddenTypes,
  hiddenEdges,
  colorMode,
  fitSignal,
  background,
  theme,
  layout,
  onDrill,
  onSelect,
}: GraphCanvasProps): React.ReactElement => {
  const [containerRef, size] = useElementSize();
  const fgRef = useRef<ForceGraphMethods | undefined>(undefined);
  const [hoverId, setHoverId] = useState<string | null>(null);
  // Once the user moves the camera, stop auto-framing so we never fight them.
  const userMovedRef = useRef(false);
  const fittedFocusRef = useRef<string | null>(null);
  const bloomRef = useRef<UnrealBloomPass | null>(null);
  const fxReadyRef = useRef(false);

  const { nodes, links, expandable } = useMemo(
    () =>
      layout === 'dependency'
        ? visibleDependencyGraph(index, focusId)
        : visibleGraph(index, focusId),
    [index, focusId, layout],
  );

  // Apply the rail's type/edge filters before rendering + tracing.
  const filtered = useMemo(() => {
    const visNodes = nodes.filter((n) => !hiddenTypes.has(n.type));
    const visIds = new Set(visNodes.map((n) => n.id));
    const visLinks = links.filter(
      (l) =>
        !hiddenEdges.has(l.type) &&
        visIds.has(linkEnd(l.source)) &&
        visIds.has(linkEnd(l.target)),
    );
    return { visNodes, visLinks };
  }, [nodes, links, hiddenTypes, hiddenEdges]);

  const data = useMemo(
    () => ({
      nodes: filtered.visNodes,
      links: filtered.visLinks.map((l) => ({ ...l })),
    }),
    [filtered],
  );

  // Adjacency over the visible links → trace a node's neighbours on hover.
  const neighbors = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const link = (a: string, b: string): void => {
      const set = map.get(a) ?? new Set<string>();
      set.add(b);
      map.set(a, set);
    };
    for (const edge of filtered.visLinks) {
      link(linkEnd(edge.source), linkEnd(edge.target));
      link(linkEnd(edge.target), linkEnd(edge.source));
    }
    return map;
  }, [filtered]);

  const fitView = (): void => {
    const fg = fgRef.current;
    if (!fg) return;
    // zoomToFit over-zooms on tiny sets — clamp to a comfortable distance.
    if (nodes.length <= 2) {
      fg.cameraPosition({ x: 0, y: 0, z: 110 }, { x: 0, y: 0, z: 0 }, 800);
    } else {
      fg.zoomToFit(800, 80);
    }
  };

  // Detect manual camera interaction so auto-fit yields to the user.
  useEffect(() => {
    let controls: { addEventListener?: (e: string, fn: () => void) => void; removeEventListener?: (e: string, fn: () => void) => void } | undefined;
    const onStart = (): void => {
      userMovedRef.current = true;
    };
    const attach = (): void => {
      controls = fgRef.current?.controls?.() as typeof controls;
      if (controls?.addEventListener) controls.addEventListener('start', onStart);
      else timer = setTimeout(attach, 200);
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    attach();
    return () => {
      if (timer) clearTimeout(timer);
      controls?.removeEventListener?.('start', onStart);
    };
  }, []);

  // Atmosphere: bloom glow + depth fog + colored rim lights. Set up once.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || fxReadyRef.current || size.width === 0) return;
    fxReadyRef.current = true;

    const scene = fg.scene();
    scene.fog = new FogExp2(Number.parseInt(background.slice(1), 16), 0.0011);
    const cool = new DirectionalLight(0x818cf8, 0.8);
    cool.position.set(-1.2, 1, 0.8);
    const warm = new DirectionalLight(0xf0abfc, 0.4);
    warm.position.set(1.2, -0.8, -0.6);
    scene.add(cool, warm);

    // Bloom is an additive glow — gorgeous on the near-black canvas, but on paper
    // it washes nodes into faint halos. Only add it in dark mode; light mode keeps
    // crisp, high-contrast nodes instead.
    if (theme === 'dark') {
      // strength low + threshold high → a glow halo that keeps node colour intact.
      const bloom = new UnrealBloomPass(
        new Vector2(size.width, size.height),
        0.8,
        0.5,
        0.3,
      );
      fg.postProcessingComposer().addPass(bloom);
      bloomRef.current = bloom;
    }
  }, [size.width, size.height, background, theme]);

  useEffect(() => {
    if (bloomRef.current && size.width > 0) {
      bloomRef.current.setSize(size.width, size.height);
    }
  }, [size.width, size.height]);

  useEffect(() => {
    fgRef.current?.refresh();
  }, [statusVersion, selectedId, hoverId, colorMode]);

  // Explicit recenter (view controls / mode reset) — always re-enables auto-fit.
  useEffect(() => {
    if (fitSignal > 0) {
      userMovedRef.current = false;
      fitView();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitSignal]);

  // Reframe for the deliberate impact toggle.
  useEffect(() => {
    fgRef.current?.refresh();
    if (impactSet === null) return;
    const id = setTimeout(() => fitView(), 60);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [impactSet]);

  // New focus = fresh framing: reset interaction state and compact the layout.
  useEffect(() => {
    userMovedRef.current = false;
    fittedFocusRef.current = null;
    const fg = fgRef.current;
    if (!fg) return;
    fg.d3Force('charge')?.strength(-45).distanceMax(220);
    fg.d3Force('link')?.distance(38);
    fg.d3Force('x', forceX(0).strength(0.08));
    fg.d3Force('y', forceY(0).strength(0.08));
    fg.d3Force('z', forceZ(0).strength(0.08));
  }, [focusId]);

  // Fit once when the layout settles for a focus — never after the user moves.
  const handleEngineStop = (): void => {
    if (!userMovedRef.current && fittedFocusRef.current !== focusId) {
      fitView();
      fittedFocusRef.current = focusId;
    }
  };

  const isHighlit = (id: string): boolean => {
    if (!hoverId) return true;
    const hovered = neighbors.get(hoverId);
    // Nothing to trace (e.g. a folder with no cross-edges) — don't dim anything.
    if (!hovered || hovered.size === 0) return true;
    return id === hoverId || hovered.has(id);
  };

  // Only enter "highlight" mode when at least one match is actually in view —
  // otherwise a cross-level query (the match lives at another drill depth) would
  // dim the whole graph to a confusing void. The panel still reports the count.
  const impactVisible = useMemo(
    () => !!impactSet && data.nodes.some((n) => impactSet.has(n.id)),
    [impactSet, data],
  );

  const dimmed = dimmedColor(theme);
  const colorFor = (node: ForceNode): string => {
    if (node.id === selectedId) return SELECTED_COLOR;
    if (impactSet && impactVisible)
      return impactSet.has(node.id) ? highlightColor : dimmed;
    if (!isHighlit(node.id)) return dimmed;
    if (colorMode === 'health') return HEALTH_COLOR[node.status.health];
    return nodeTypeColor(node.type, theme);
  };

  const linkHot = (link: ForceLink): boolean =>
    hoverId !== null &&
    (linkEnd(link.source) === hoverId || linkEnd(link.target) === hoverId);

  return (
    <div ref={containerRef} className="h-full w-full">
      <ForceGraph3D
        ref={fgRef}
        width={size.width}
        height={size.height}
        graphData={data}
        backgroundColor={background}
        showNavInfo={false}
        nodeRelSize={5}
        nodeResolution={18}
        nodeOpacity={1}
        nodeColor={(n) => colorFor(n as ForceNode)}
        nodeVal={(n) => {
          const node = n as ForceNode;
          const childCount = index.childrenOf.get(node.id)?.length ?? 0;
          return nodeSize(hasMetrics(node) ? node.metrics.loc : 0, childCount);
        }}
        nodeLabel={(n) => {
          const node = n as ForceNode;
          const mark = expandable.has(node.id) ? '  ↧ click to open' : '';
          return `<div style="font:500 12px ui-sans-serif;color:#e4e4e7">${node.name}<span style="color:#71717a"> · ${node.type}${mark}</span></div>`;
        }}
        linkCurvature={0.16}
        linkColor={(l) =>
          linkHot(l as ForceLink)
            ? HOT_EDGE_COLOR[theme]
            : edgeTypeColor((l as ForceLink).type, theme)
        }
        linkWidth={(l) => (linkHot(l as ForceLink) ? 2 : Math.min(2, (l as ForceLink).weight))}
        linkDirectionalParticles={(l) => (linkHot(l as ForceLink) ? 4 : 1)}
        linkDirectionalParticleWidth={(l) => (linkHot(l as ForceLink) ? 2.5 : 1.1)}
        linkDirectionalParticleSpeed={0.006}
        cooldownTicks={COOLDOWN_TICKS}
        onEngineStop={handleEngineStop}
        onNodeHover={(n) => setHoverId(n ? (n as ForceNode).id : null)}
        onNodeClick={(n) => {
          const node = n as ForceNode;
          if (expandable.has(node.id)) onDrill(node.id);
          else onSelect(node.id);
        }}
      />
    </div>
  );
};
