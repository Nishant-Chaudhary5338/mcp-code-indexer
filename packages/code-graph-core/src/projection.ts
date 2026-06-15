import type { GraphNode, NodeType, NodeMetrics } from './node.schema';
import { hasPath, hasMetrics } from './node.schema';
import type { GraphEdge } from './edge.schema';
import type { GraphSnapshot, GraphMeta } from './snapshot.schema';
import { findCycles } from './analysis';

/**
 * Token-safe projections of a graph snapshot. The full snapshot (every node with
 * its status/knowledge/git/span) is fine for a UI that needs it lazily, but it is
 * a context-window bomb for an AI agent. These helpers let a caller ask for a
 * cheap summary, a structural slice, or lean nodes instead of the whole payload.
 */

/** Above this node count, a parameter-less `get_graph` defaults to summary mode. */
export const DEFAULT_FULL_NODE_THRESHOLD = 150;

/**
 * A minimal node projection: identity + structure + metrics only. Drops the heavy
 * annotations (`status`, `knowledge`, `git`) and symbol detail (`span`,
 * `contentHash`, `bundleBytes`) that dominate payload size.
 */
export interface LeanNode {
  id: string;
  type: NodeType;
  name: string;
  parentId: string | null;
  path?: string;
  metrics?: NodeMetrics;
}

export const toLeanNode = (node: GraphNode): LeanNode => {
  const lean: LeanNode = {
    id: node.id,
    type: node.type,
    name: node.name,
    parentId: node.parentId,
  };
  if (hasPath(node)) lean.path = node.path;
  if (hasMetrics(node)) lean.metrics = node.metrics;
  return lean;
};

export interface GraphSummary {
  root: string;
  nodeCount: number;
  edgeCount: number;
  nodesByType: Record<string, number>;
  edgesByType: Record<string, number>;
  topLevel: Array<{ id: string; name: string; type: NodeType }>;
  cycleCount: number;
}

/**
 * A tiny, fixed-size digest of the graph: counts by node/edge type, the
 * top-level containers (direct children of the repo node), and the cycle count.
 * This is what an agent should fetch first — it's a few hundred tokens regardless
 * of repo size, and tells the agent what to drill into next.
 */
export const summarizeSnapshot = (snapshot: GraphSnapshot): GraphSummary => {
  const nodesByType: Record<string, number> = {};
  for (const n of snapshot.nodes) {
    nodesByType[n.type] = (nodesByType[n.type] ?? 0) + 1;
  }
  const edgesByType: Record<string, number> = {};
  for (const e of snapshot.edges) {
    edgesByType[e.type] = (edgesByType[e.type] ?? 0) + 1;
  }

  const repo = snapshot.nodes.find((n) => n.type === 'repo');
  const topLevel = repo
    ? snapshot.nodes
        .filter((n) => n.parentId === repo.id)
        .map((n) => ({ id: n.id, name: n.name, type: n.type }))
    : [];

  return {
    root: snapshot.meta.root,
    nodeCount: snapshot.nodes.length,
    edgeCount: snapshot.edges.length,
    nodesByType,
    edgesByType,
    topLevel,
    cycleCount: findCycles(snapshot.edges).length,
  };
};

export interface ProjectionOptions {
  /** Return only the {@link GraphSummary} digest. */
  summary?: boolean;
  /** Keep only nodes of these type(s) (and edges between survivors). */
  type?: NodeType | NodeType[];
  /** BFS from the repo root over `contains` edges, keeping N levels. */
  depth?: number;
  /** Project every node through {@link toLeanNode}. */
  lean?: boolean;
  /** Whitelist of node fields to keep (overrides `lean`). `id`+`type` always kept. */
  fields?: string[];
}

export interface ProjectedGraph {
  meta: GraphMeta;
  nodes: Array<GraphNode | LeanNode | Record<string, unknown>>;
  edges: GraphEdge[];
}

const pickFields = (
  node: GraphNode,
  fields: string[],
): Record<string, unknown> => {
  const rec = node as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = { id: node.id, type: node.type };
  for (const f of fields) {
    if (f in rec) out[f] = rec[f];
  }
  return out;
};

// Node ids reachable from the repo root within `depth` hops of `contains` edges.
const nodesWithinDepth = (
  snapshot: GraphSnapshot,
  depth: number,
): Set<string> => {
  const childrenByParent = new Map<string, string[]>();
  for (const e of snapshot.edges) {
    if (e.type !== 'contains') continue;
    const list = childrenByParent.get(e.source);
    if (list) list.push(e.target);
    else childrenByParent.set(e.source, [e.target]);
  }

  const keep = new Set<string>();
  const repo = snapshot.nodes.find((n) => n.type === 'repo');
  if (!repo) return keep;

  keep.add(repo.id);
  let frontier = [repo.id];
  for (let d = 0; d < depth; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const child of childrenByParent.get(id) ?? []) {
        if (!keep.has(child)) {
          keep.add(child);
          next.push(child);
        }
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
  return keep;
};

/**
 * Project a snapshot down to what the caller asked for. Returns a
 * {@link GraphSummary} when `summary` is set, otherwise a `{ meta, nodes, edges }`
 * shape with `type`/`depth` filtering and `lean`/`fields` node projection applied.
 * Edges are always kept only when **both** endpoints survive the node filter.
 */
export const projectGraph = (
  snapshot: GraphSnapshot,
  opts: ProjectionOptions = {},
): GraphSummary | ProjectedGraph => {
  if (opts.summary) return summarizeSnapshot(snapshot);

  let nodes: GraphNode[] = snapshot.nodes;

  if (opts.type) {
    const set = new Set(Array.isArray(opts.type) ? opts.type : [opts.type]);
    nodes = nodes.filter((n) => set.has(n.type));
  }
  if (opts.depth !== undefined) {
    const keep = nodesWithinDepth(snapshot, opts.depth);
    nodes = nodes.filter((n) => keep.has(n.id));
  }

  const keepIds = new Set(nodes.map((n) => n.id));
  const edges = snapshot.edges.filter(
    (e) => keepIds.has(e.source) && keepIds.has(e.target),
  );

  let projectedNodes: ProjectedGraph['nodes'] = nodes;
  if (opts.fields && opts.fields.length > 0) {
    const fields = opts.fields;
    projectedNodes = nodes.map((n) => pickFields(n, fields));
  } else if (opts.lean) {
    projectedNodes = nodes.map(toLeanNode);
  }

  return { meta: snapshot.meta, nodes: projectedNodes, edges };
};
