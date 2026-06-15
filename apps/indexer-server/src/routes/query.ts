import { Router } from 'express';
import {
  whoRenders,
  whoCalls,
  findReferences,
  blastRadius,
  findCycles,
  findOrphans,
  searchNodes,
  buildContextPack,
  nodePath,
  EdgeType,
  NodeType,
  type GraphEdge,
  type GraphNode,
} from '@repo/code-graph-core';
import type { GraphService } from '../graph-service.js';

/** The valid edge-type values, for filtering the `?types=` query param. */
const EDGE_TYPES = new Set<string>(EdgeType.options);
/** The valid node-type values, for filtering the search `?type=` query param. */
const NODE_TYPES = new Set<string>(NodeType.options);

/**
 * Identity + location facts for a node, the shape every enriched query result
 * shares. `path` is the node's source path when it has one (`nodePath`), else null.
 */
interface NodeRef {
  id: string;
  name: string;
  type: GraphNode['type'];
  path: string | null;
}

/** Look up a node by id and project it to a {@link NodeRef}, or null if absent. */
const toNodeRef = (byId: Map<string, GraphNode>, id: string): NodeRef | null => {
  const node = byId.get(id);
  if (!node) return null;
  return { id: node.id, name: node.name, type: node.type, path: nodePath(node) };
};

/**
 * Enrich one incoming edge into its SOURCE node's facts plus the edge weight.
 * Returns null when the source node is missing from the snapshot (so callers can
 * filter dangling edges out).
 */
const enrichSource = (
  byId: Map<string, GraphNode>,
  edge: GraphEdge,
): (NodeRef & { weight: number }) | null => {
  const ref = toNodeRef(byId, edge.source);
  if (!ref) return null;
  return { ...ref, weight: edge.weight };
};

/** Parse `?types=renders,calls` into a validated set of EdgeType, or undefined. */
const parseEdgeTypes = (raw: unknown): ReadonlySet<EdgeType> | undefined => {
  if (typeof raw !== 'string' || raw.trim().length === 0) return undefined;
  const valid = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is EdgeType => EDGE_TYPES.has(s));
  return valid.length > 0 ? new Set<EdgeType>(valid) : undefined;
};

/**
 * Reverse-lookup / impact-analysis routes over the live snapshot. Every route
 * answers from `snapshot.edges` + `snapshot.nodes` alone (no symbol table), so
 * they are cheap and depend only on the already-built graph.
 *
 * Each request builds a `Map<id, node>` once for O(1) enrichment, returns 503
 * when the graph isn't indexed yet, and 404 when an `:id` node is unknown.
 */
export const queryRouter = (graph: GraphService): Router => {
  const router = Router();

  /** Incoming `renders` edges of `:id`, enriched with each source component. */
  router.get('/who-renders/:id', (req, res) => {
    const snapshot = graph.getSnapshot();
    if (!snapshot) {
      res.status(503).json({ error: 'Graph not indexed yet' });
      return;
    }
    const id = req.params.id;
    const byId = new Map(snapshot.nodes.map((n) => [n.id, n] as const));
    if (!byId.has(id)) {
      res.status(404).json({ error: `Node not found: ${id}` });
      return;
    }
    const results = whoRenders(snapshot.edges, id)
      .map((edge) => enrichSource(byId, edge))
      .filter((r): r is NodeRef & { weight: number } => r !== null);
    res.json({ id, results });
  });

  /** Incoming `calls` edges of `:id`, enriched with each calling symbol. */
  router.get('/who-calls/:id', (req, res) => {
    const snapshot = graph.getSnapshot();
    if (!snapshot) {
      res.status(503).json({ error: 'Graph not indexed yet' });
      return;
    }
    const id = req.params.id;
    const byId = new Map(snapshot.nodes.map((n) => [n.id, n] as const));
    if (!byId.has(id)) {
      res.status(404).json({ error: `Node not found: ${id}` });
      return;
    }
    const results = whoCalls(snapshot.edges, id)
      .map((edge) => enrichSource(byId, edge))
      .filter((r): r is NodeRef & { weight: number } => r !== null);
    res.json({ id, results });
  });

  /**
   * Every reference *into* `:id`, optionally narrowed by `?types=renders,calls`.
   * Each result also carries the originating `edge.type`.
   */
  router.get('/references/:id', (req, res) => {
    const snapshot = graph.getSnapshot();
    if (!snapshot) {
      res.status(503).json({ error: 'Graph not indexed yet' });
      return;
    }
    const id = req.params.id;
    const byId = new Map(snapshot.nodes.map((n) => [n.id, n] as const));
    if (!byId.has(id)) {
      res.status(404).json({ error: `Node not found: ${id}` });
      return;
    }
    const types = parseEdgeTypes(req.query.types);
    const results = findReferences(snapshot.edges, id, types)
      .map((edge) => {
        const enriched = enrichSource(byId, edge);
        return enriched ? { ...enriched, edgeType: edge.type } : null;
      })
      .filter((r): r is NodeRef & { weight: number; edgeType: EdgeType } => r !== null);
    res.json({ id, results });
  });

  /** Everything that transitively depends on `:id` — its blast radius. */
  router.get('/blast-radius/:id', (req, res) => {
    const snapshot = graph.getSnapshot();
    if (!snapshot) {
      res.status(503).json({ error: 'Graph not indexed yet' });
      return;
    }
    const id = req.params.id;
    const byId = new Map(snapshot.nodes.map((n) => [n.id, n] as const));
    if (!byId.has(id)) {
      res.status(404).json({ error: `Node not found: ${id}` });
      return;
    }
    const impacted: NodeRef[] = [];
    for (const impactedId of blastRadius(snapshot.edges, id)) {
      const ref = toNodeRef(byId, impactedId);
      if (ref) impacted.push(ref);
    }
    res.json({ id, count: impacted.length, impacted });
  });

  /**
   * Fuzzy node search: `?query=useAuth&type=component,function&limit=20`. Ranks
   * nodes by name/path so a UI or agent can resolve a rough name to ids.
   */
  router.get('/search', (req, res) => {
    const snapshot = graph.getSnapshot();
    if (!snapshot) {
      res.status(503).json({ error: 'Graph not indexed yet' });
      return;
    }
    const query = typeof req.query.query === 'string' ? req.query.query : '';
    if (query.trim().length === 0) {
      res.status(400).json({ error: 'query is required' });
      return;
    }
    const rawTypes = typeof req.query.type === 'string' ? req.query.type : '';
    const types = rawTypes
      .split(',')
      .map((s) => s.trim())
      .filter((t): t is NodeType => NODE_TYPES.has(t));
    const limitRaw = typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : NaN;
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined;

    const results = searchNodes(snapshot.nodes, query, {
      type: types.length > 0 ? types : undefined,
      limit,
    });
    res.json({ query, count: results.length, results });
  });

  /**
   * The "safely edit this" bundle for `:id`: structural context pack (deps,
   * dependents, blast-radius size) plus the target's bounded source. `?maxRefs=`
   * caps each ref list.
   */
  router.get('/context/:id', (req, res) => {
    const snapshot = graph.getSnapshot();
    if (!snapshot) {
      res.status(503).json({ error: 'Graph not indexed yet' });
      return;
    }
    const id = req.params.id;
    const maxRaw = typeof req.query.maxRefs === 'string' ? Number.parseInt(req.query.maxRefs, 10) : NaN;
    const maxRefs = Number.isFinite(maxRaw) && maxRaw > 0 ? maxRaw : undefined;
    try {
      const pack = buildContextPack(snapshot.nodes, snapshot.edges, id, { maxRefs });
      res.json({ ...pack, source: graph.getNodeSource(id) });
    } catch {
      res.status(404).json({ error: `Node not found: ${id}` });
    }
  });

  /**
   * "Find by meaning": `?query=...&type=component,function&limit=20`. Ranks by
   * embedding similarity; falls back to lexical search (flagged in the response)
   * if embeddings haven't been built or the model is unavailable.
   */
  router.get('/semantic-search', (req, res) => {
    const query = typeof req.query.query === 'string' ? req.query.query : '';
    if (query.trim().length === 0) {
      res.status(400).json({ error: 'query is required' });
      return;
    }
    const rawTypes = typeof req.query.type === 'string' ? req.query.type : '';
    const types = rawTypes
      .split(',')
      .map((s) => s.trim())
      .filter((t): t is GraphNode['type'] => NODE_TYPES.has(t));
    const limitRaw = typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : NaN;
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined;

    graph
      .semanticSearch(query, { type: types.length > 0 ? types : undefined, limit })
      .then((result) => res.json(result))
      .catch((err: unknown) => res.status(500).json({ error: (err as Error).message }));
  });

  /** Build/refresh embeddings so semantic search can use real vectors. */
  router.post('/embed', (_req, res) => {
    graph
      .buildEmbeddings()
      .then((result) => res.json(result))
      .catch((err: unknown) => res.status(500).json({ error: (err as Error).message }));
  });

  /** Dead-code candidates: nodes with no incoming dependency edge. */
  router.get('/orphans', (req, res) => {
    const snapshot = graph.getSnapshot();
    if (!snapshot) {
      res.status(503).json({ error: 'Graph not indexed yet' });
      return;
    }
    const includeEntryPoints = req.query.includeEntryPoints === '1' || req.query.includeEntryPoints === 'true';
    const orphans = findOrphans(snapshot.nodes, snapshot.edges, { includeEntryPoints });
    res.json({ count: orphans.length, orphans });
  });

  /** All dependency cycles in the graph, each as an ordered list of node refs. */
  router.get('/cycles', (_req, res) => {
    const snapshot = graph.getSnapshot();
    if (!snapshot) {
      res.status(503).json({ error: 'Graph not indexed yet' });
      return;
    }
    const byId = new Map(snapshot.nodes.map((n) => [n.id, n] as const));
    const cycles = findCycles(snapshot.edges).map((cycle) =>
      cycle
        .map((cid) => {
          const node = byId.get(cid);
          return node ? { id: node.id, name: node.name, type: node.type } : null;
        })
        .filter(
          (n): n is { id: string; name: string; type: GraphNode['type'] } => n !== null,
        ),
    );
    res.json({ count: cycles.length, cycles });
  });

  return router;
};
