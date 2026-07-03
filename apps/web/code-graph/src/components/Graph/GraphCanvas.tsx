import { useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph3D, { type ForceGraphMethods } from 'react-force-graph-3d';
import { forceX, forceY, forceZ } from 'd3-force-3d';
import { FogExp2, DirectionalLight, Vector2 } from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// `controlType` is a real runtime prop of the underlying 3d-force-graph
// (trackball | orbit | fly) but is missing from react-force-graph-3d's typings.
// Orbit keeps the horizon level (no disorienting barrel-roll) and supports
// damping — a far smoother, more predictable camera than the default trackball.
const ForceGraph3DTyped = ForceGraph3D as unknown as React.ForwardRefExoticComponent<
  React.ComponentProps<typeof ForceGraph3D> & {
    controlType?: 'trackball' | 'orbit' | 'fly';
  }
>;
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
  perfTierFor,
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
  // True while the user is actively orbiting/panning/zooming the camera. During a
  // drag, react-force-graph keeps firing onNodeHover as nodes sweep under the
  // (stationary) cursor — each one recolors the whole graph via refresh(),
  // producing the mid-drag stutter. We gate hover off for the duration.
  const interactingRef = useRef(false);
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

  // Node size is structural and frame-invariant — precompute once per visible set
  // rather than recomputing nodeSize() for every node on every frame.
  const sizeOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of data.nodes) {
      const childCount = index.childrenOf.get(n.id)?.length ?? 0;
      m.set(n.id, nodeSize(hasMetrics(n) ? n.metrics.loc : 0, childCount));
    }
    return m;
  }, [data.nodes, index]);

  // Degrade cosmetic GPU effects (ambient particles, bloom, sphere poly count) and
  // bound settle time as the visible graph grows — the freeze fix for big graphs.
  const perf = useMemo(
    () => perfTierFor(data.nodes.length, data.links.length),
    [data],
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
    if (nodes.length <= 2) {
      fg.cameraPosition({ x: 0, y: 0, z: 120 }, { x: 0, y: 0, z: 0 }, 800);
      return;
    }
    // Frame from node POSITIONS. The built-in zoomToFit also measures each node's
    // three object, so the persistent label sprites (small views) would balloon
    // the box and over-zoom. Compute the camera distance from the coordinate
    // bbox: fit the larger of width/height to the viewport at the camera FOV.
    const bbox = fg.getGraphBbox?.();
    if (!bbox) {
      fg.zoomToFit(800, 80);
      return;
    }
    const cx = (bbox.x[0] + bbox.x[1]) / 2;
    const cy = (bbox.y[0] + bbox.y[1]) / 2;
    const cz = (bbox.z[0] + bbox.z[1]) / 2;
    const spanY = bbox.y[1] - bbox.y[0];
    const spanX = bbox.x[1] - bbox.x[0];
    const aspect = size.width && size.height ? size.width / size.height : 1.6;
    // vertical half-extent that must fit, accounting for the wider-than-tall canvas.
    const halfExtent = Math.max(spanY, spanX / aspect, 30) / 2;
    const fov = (fg.camera?.() as { fov?: number } | undefined)?.fov ?? 50;
    const dist = halfExtent / Math.tan(((fov / 2) * Math.PI) / 180);
    // 1.35 leaves comfortable breathing room without shrinking the graph to a dot.
    fg.cameraPosition({ x: cx, y: cy, z: cz + dist * 1.35 + 20 }, { x: cx, y: cy, z: cz }, 800);
  };

  // Detect manual camera interaction so auto-fit yields to the user AND so hover
  // tracing can be suppressed for the duration of a drag (the stutter fix).
  useEffect(() => {
    let controls: { addEventListener?: (e: string, fn: () => void) => void; removeEventListener?: (e: string, fn: () => void) => void } | undefined;
    const onStart = (): void => {
      userMovedRef.current = true;
      interactingRef.current = true;
      // Clear any lingering hover so the graph paints undimmed while orbiting.
      setHoverId((cur) => (cur === null ? cur : null));
    };
    const onEnd = (): void => {
      interactingRef.current = false;
    };
    const attach = (): void => {
      controls = fgRef.current?.controls?.() as typeof controls;
      if (controls?.addEventListener) {
        controls.addEventListener('start', onStart);
        controls.addEventListener('end', onEnd);
        // Smooth, weighted camera motion instead of the raw 1:1 (and slightly
        // jittery) default. These props exist on OrbitControls; guarded so a
        // different control type is a harmless no-op.
        const c = controls as unknown as {
          enableDamping?: boolean;
          dampingFactor?: number;
          rotateSpeed?: number;
          zoomSpeed?: number;
          panSpeed?: number;
        };
        c.enableDamping = true;
        c.dampingFactor = 0.14;
        c.rotateSpeed = 0.65;
        c.zoomSpeed = 0.8;
        c.panSpeed = 0.6;
      } else timer = setTimeout(attach, 200);
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    attach();
    return () => {
      if (timer) clearTimeout(timer);
      controls?.removeEventListener?.('start', onStart);
      controls?.removeEventListener?.('end', onEnd);
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
    // crisp, high-contrast nodes instead. Skip it entirely on large graphs, where
    // the full-screen pass per frame is a major cost on weaker GPUs.
    if (theme === 'dark' && perf.bloom) {
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
  }, [size.width, size.height, background, theme, perf.bloom]);

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
      <ForceGraph3DTyped
        ref={fgRef}
        controlType="orbit"
        width={size.width}
        height={size.height}
        graphData={data}
        backgroundColor={background}
        showNavInfo={false}
        nodeRelSize={5}
        nodeResolution={perf.nodeResolution}
        nodeOpacity={1}
        nodeColor={(n) => colorFor(n as ForceNode)}
        nodeVal={(n) => {
          const node = n as ForceNode;
          const base = sizeOf.get(node.id) ?? 3;
          // Pop the hovered node so pointing at it feels responsive and clear.
          return node.id === hoverId ? base * 1.4 : base;
        }}
        nodeLabel={(n) => {
          const node = n as ForceNode;
          const mark = expandable.has(node.id) ? '  ↧ click to open' : '';
          return `<div style="font:500 12px ui-sans-serif;color:#e4e4e7">${node.name}<span style="color:#71717a"> · ${node.type}${mark}</span></div>`;
        }}
        linkCurvature={perf.curveLinks ? 0.16 : 0}
        linkColor={(l) =>
          linkHot(l as ForceLink)
            ? HOT_EDGE_COLOR[theme]
            : edgeTypeColor((l as ForceLink).type, theme)
        }
        linkWidth={(l) => (linkHot(l as ForceLink) ? 2 : Math.min(2, (l as ForceLink).weight))}
        linkDirectionalParticles={(l) =>
          linkHot(l as ForceLink) ? 4 : perf.ambientParticles ? 1 : 0
        }
        linkDirectionalParticleWidth={(l) => (linkHot(l as ForceLink) ? 2.5 : 1.1)}
        linkDirectionalParticleSpeed={0.006}
        cooldownTicks={perf.cooldownTicks}
        cooldownTime={perf.cooldownTime}
        onEngineStop={handleEngineStop}
        onNodeHover={(n) => {
          // Ignore hover churn while orbiting/zooming — nodes sweeping under a
          // fixed cursor would otherwise recolor the whole graph every frame.
          if (interactingRef.current) return;
          const id = n ? (n as ForceNode).id : null;
          setHoverId((cur) => (cur === id ? cur : id));
        }}
        onNodeClick={(n) => {
          const node = n as ForceNode;
          if (expandable.has(node.id)) onDrill(node.id);
          else onSelect(node.id);
        }}
      />
    </div>
  );
};
