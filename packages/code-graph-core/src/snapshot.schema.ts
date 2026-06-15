import { z } from 'zod';
import { GraphNode } from './node.schema';
import { GraphEdge } from './edge.schema';

export const GraphMeta = z.object({
  root: z.string(),
  generatedAt: z.number(),
  commit: z.string().nullable(),
  nodeCount: z.number().int().nonnegative(),
  edgeCount: z.number().int().nonnegative(),
  indexerVersion: z.string(),
});
export type GraphMeta = z.infer<typeof GraphMeta>;

export const GraphSnapshot = z.object({
  meta: GraphMeta,
  nodes: z.array(GraphNode),
  edges: z.array(GraphEdge),
});
export type GraphSnapshot = z.infer<typeof GraphSnapshot>;

export const GraphPatch = z.object({
  upsertNodes: z.array(GraphNode),
  removeNodeIds: z.array(z.string()),
  upsertEdges: z.array(GraphEdge),
  removeEdgeIds: z.array(z.string()),
  meta: GraphMeta.partial(),
});
export type GraphPatch = z.infer<typeof GraphPatch>;

export const applyPatch = (
  snapshot: GraphSnapshot,
  patch: GraphPatch,
): GraphSnapshot => {
  const removeNodes = new Set(patch.removeNodeIds);
  const removeEdges = new Set(patch.removeEdgeIds);
  const upsertNodeIds = new Set(patch.upsertNodes.map((n) => n.id));
  const upsertEdgeIds = new Set(patch.upsertEdges.map((e) => e.id));

  const nodes = snapshot.nodes
    .filter((n) => !removeNodes.has(n.id) && !upsertNodeIds.has(n.id))
    .concat(patch.upsertNodes);
  const edges = snapshot.edges
    .filter((e) => !removeEdges.has(e.id) && !upsertEdgeIds.has(e.id))
    .concat(patch.upsertEdges);

  return {
    meta: {
      ...snapshot.meta,
      ...patch.meta,
      generatedAt: patch.meta.generatedAt ?? Date.now(),
      nodeCount: nodes.length,
      edgeCount: edges.length,
    },
    nodes,
    edges,
  };
};
