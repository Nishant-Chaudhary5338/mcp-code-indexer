import type { GraphNode, NodeType, SourceSpan } from './node.schema';
import { nodePath } from './node.schema';
import type { HealthLevel } from './status.schema';
import type { EdgeType, GraphEdge } from './edge.schema';
import {
  DEPENDENCY_TYPES,
  buildForwardIndex,
  buildReverseIndex,
  blastRadius,
} from './analysis';

/** One end of a dependency relation, enriched with the connecting edge. */
export interface ContextRef {
  id: string;
  name: string;
  type: NodeType;
  path: string | null;
  /** The symbol's written contract, when it has one — so deps read as APIs. */
  signature: string | null;
  edgeType: EdgeType;
  weight: number;
}

/** The target node's own facts (everything but its source body). */
export interface ContextTarget {
  id: string;
  name: string;
  type: NodeType;
  path: string | null;
  span: SourceSpan | null;
  signature: string | null;
  health: HealthLevel;
  typeErrors: number;
  knowledge: string | null;
}

/** A symbol's signature when it carries one (component/function), else null. */
const nodeSignature = (node: GraphNode): string | null =>
  'signature' in node ? node.signature : null;

/**
 * A self-contained "what do I need to safely touch this node" bundle: the target
 * plus what it depends on (outgoing) and what depends on it (incoming first hop),
 * with the full transitive blast-radius size. The source body is attached by the
 * caller (engine/server), since this layer never touches disk.
 */
export interface ContextPack {
  target: ContextTarget;
  dependencies: ContextRef[];
  dependents: ContextRef[];
  blastRadiusCount: number;
  truncated: { dependencies: boolean; dependents: boolean };
}

export interface ContextPackOptions {
  /** Cap on each of the dependency / dependent lists (default 50). */
  maxRefs?: number;
}

const DEFAULT_MAX_REFS = 50;

const targetFacts = (node: GraphNode): ContextTarget => ({
  id: node.id,
  name: node.name,
  type: node.type,
  path: nodePath(node),
  span: 'span' in node ? node.span : null,
  signature: nodeSignature(node),
  health: node.status.health,
  typeErrors: node.status.typeErrors,
  knowledge: node.knowledge?.summary ?? null,
});

/**
 * Project dependency edges into enriched {@link ContextRef}s, looking up the
 * opposite endpoint (`endpoint(edge)`) of each. Sorted by weight desc then name
 * for determinism, then capped to `max`; returns the slice and whether it clipped.
 */
const refsFrom = (
  edges: GraphEdge[],
  byId: Map<string, GraphNode>,
  endpoint: (e: GraphEdge) => string,
  max: number,
): { refs: ContextRef[]; truncated: boolean } => {
  const refs: ContextRef[] = [];
  for (const edge of edges) {
    const node = byId.get(endpoint(edge));
    if (!node) continue; // engine guarantees indexed endpoints; skip dangling
    refs.push({
      id: node.id,
      name: node.name,
      type: node.type,
      path: nodePath(node),
      signature: nodeSignature(node),
      edgeType: edge.type,
      weight: edge.weight,
    });
  }
  refs.sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name));
  return { refs: refs.slice(0, max), truncated: refs.length > max };
};

/**
 * Assemble the structural context pack for `id` from the snapshot alone. Throws
 * if the node is unknown. Dependencies are the target's outgoing dependency edges
 * (what it imports/calls/renders); dependents are the incoming first hop (who
 * relies on it directly); `blastRadiusCount` is the full transitive reach.
 */
export const buildContextPack = (
  nodes: GraphNode[],
  edges: GraphEdge[],
  id: string,
  opts: ContextPackOptions = {},
): ContextPack => {
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const target = byId.get(id);
  if (!target) throw new Error(`Node not found: ${id}`);

  const max = opts.maxRefs ?? DEFAULT_MAX_REFS;
  const forward = buildForwardIndex(edges, DEPENDENCY_TYPES);
  const reverse = buildReverseIndex(edges, DEPENDENCY_TYPES);

  const deps = refsFrom(forward.get(id) ?? [], byId, (e) => e.target, max);
  const dependents = refsFrom(reverse.get(id) ?? [], byId, (e) => e.source, max);

  return {
    target: targetFacts(target),
    dependencies: deps.refs,
    dependents: dependents.refs,
    blastRadiusCount: blastRadius(edges, id).size,
    truncated: { dependencies: deps.truncated, dependents: dependents.truncated },
  };
};
