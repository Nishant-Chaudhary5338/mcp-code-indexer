import { useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d';
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

type GraphCanvas2DProps = {
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
  /** Canvas ground color (theme-derived). */
  background: string;
  /** Active theme — selects node/edge palettes and label/ring colors. */
  theme: Theme;
  /** Structure (folder drill) vs dependency (subtree leaves by deps) layout. */
  layout: Layout;
  onDrill: (id: string) => void;
  onSelect: (id: string) => void;
};

type ForceNode = GraphNode & { x?: number; y?: number };
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

export const GraphCanvas2D = ({
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
}: GraphCanvas2DProps): React.ReactElement => {
  const [containerRef, size] = useElementSize();
  const fgRef = useRef<ForceGraphMethods | undefined>(undefined);
  const [hoverId, setHoverId] = useState<string | null>(null);
  // Once the user pans/zooms, stop auto-framing so we never fight them.
  const userMovedRef = useRef(false);
  const fittedFocusRef = useRef<string | null>(null);

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
    fgRef.current?.zoomToFit(800, 60);
  };

  // Detect manual pan/zoom so auto-fit yields to the user.
  const markUserMoved = (): void => {
    userMovedRef.current = true;
  };

  useEffect(() => {
    fgRef.current?.d3ReheatSimulation?.();
  }, [statusVersion]);

  // Explicit recenter (view controls / mode reset) — always re-enables auto-fit.
  useEffect(() => {
    if (fitSignal > 0) {
      userMovedRef.current = false;
      fitView();
    }
  }, [fitSignal]);

  // Reframe for the deliberate impact toggle.
  useEffect(() => {
    if (impactSet === null) return;
    const id = setTimeout(() => fitView(), 60);
    return () => clearTimeout(id);
  }, [impactSet]);

  // New focus = fresh framing: reset interaction state and compact the layout.
  useEffect(() => {
    userMovedRef.current = false;
    fittedFocusRef.current = null;
    const fg = fgRef.current;
    if (!fg) return;
    fg.d3Force('charge')?.strength(-120);
    fg.d3Force('link')?.distance(48);
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

  // Only dim into highlight mode if a match is actually visible (see GraphCanvas).
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

  const valFor = (node: ForceNode): number => {
    const childCount = index.childrenOf.get(node.id)?.length ?? 0;
    return nodeSize(hasMetrics(node) ? node.metrics.loc : 0, childCount);
  };

  const linkHot = (link: ForceLink): boolean =>
    hoverId !== null &&
    (linkEnd(link.source) === hoverId || linkEnd(link.target) === hoverId);

  // Draw a filled disc plus a legible label beneath each node. Radius derives
  // from the same nodeSize() weight as 3D so the two views agree.
  const drawNode = (
    n: ForceNode,
    ctx: CanvasRenderingContext2D,
    globalScale: number,
  ): void => {
    if (n.x === undefined || n.y === undefined) return;
    const color = colorFor(n);
    const radius = Math.max(2.5, valFor(n) * 0.7);

    ctx.beginPath();
    ctx.arc(n.x, n.y, radius, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
    if (n.id === selectedId) {
      ctx.lineWidth = 1.5 / globalScale;
      ctx.strokeStyle = theme === 'light' ? '#0f172a' : '#ffffff';
      ctx.stroke();
    }

    // Labels only when zoomed in enough to be readable, and never on dimmed nodes.
    const isDimmed = color === dimmed;
    if (globalScale > 1.1 && !isDimmed) {
      const fontSize = Math.min(5, 11 / globalScale);
      ctx.font = `500 ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = theme === 'light' ? '#3f3f46' : '#e4e4e7';
      ctx.fillText(n.name, n.x, n.y + radius + 1);
    }
  };

  return (
    <div ref={containerRef} className="h-full w-full">
      <ForceGraph2D
        ref={fgRef}
        width={size.width}
        height={size.height}
        graphData={data}
        backgroundColor={background}
        nodeRelSize={5}
        nodeVal={(n) => valFor(n as ForceNode)}
        nodeColor={(n) => colorFor(n as ForceNode)}
        nodeLabel={(n) => {
          const node = n as ForceNode;
          const mark = expandable.has(node.id) ? '  ↧ click to open' : '';
          return `<div style="font:500 12px ui-sans-serif;color:#e4e4e7">${node.name}<span style="color:#71717a"> · ${node.type}${mark}</span></div>`;
        }}
        nodeCanvasObject={(n, ctx, scale) => drawNode(n as ForceNode, ctx, scale)}
        nodeCanvasObjectMode={() => 'replace'}
        linkCurvature={0.12}
        linkColor={(l) =>
          linkHot(l as ForceLink)
            ? HOT_EDGE_COLOR[theme]
            : edgeTypeColor((l as ForceLink).type, theme)
        }
        linkWidth={(l) =>
          linkHot(l as ForceLink) ? 2 : Math.min(2, (l as ForceLink).weight)
        }
        linkDirectionalParticles={(l) => (linkHot(l as ForceLink) ? 4 : 0)}
        linkDirectionalParticleWidth={(l) => (linkHot(l as ForceLink) ? 2.5 : 1.1)}
        linkDirectionalParticleSpeed={0.006}
        cooldownTicks={COOLDOWN_TICKS}
        onEngineStop={handleEngineStop}
        onZoom={markUserMoved}
        onNodeDrag={markUserMoved}
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
