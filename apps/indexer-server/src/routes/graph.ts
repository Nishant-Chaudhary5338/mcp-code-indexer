import { Router } from 'express';
import {
  projectGraph,
  summarizeSnapshot,
  DEFAULT_FULL_NODE_THRESHOLD,
  NodeType,
  type ProjectionOptions,
} from '@repo/code-graph-core';
import type { GraphService } from '../graph-service.js';

/** The valid node-type values, for filtering the `?type=` query param. */
const NODE_TYPES = new Set<string>(NodeType.options);

/**
 * Tiny query-param coercion helpers. Express types a query value as
 * `string | string[] | ParsedQs | ParsedQs[] | undefined`; these accept the
 * permissive `unknown` and only act on a plain `string`, ignoring anything else.
 */
export const queryParam = {
  /** `1`/`true` (case-insensitive) → true; everything else → false. */
  bool(raw: unknown): boolean {
    if (typeof raw !== 'string') return false;
    const v = raw.trim().toLowerCase();
    return v === '1' || v === 'true';
  },
  /** A finite, non-negative integer, or undefined when absent/invalid. */
  int(raw: unknown): number | undefined {
    if (typeof raw !== 'string' || raw.trim().length === 0) return undefined;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  },
  /** A comma-separated list → trimmed, non-empty strings, or undefined. */
  list(raw: unknown): string[] | undefined {
    if (typeof raw !== 'string' || raw.trim().length === 0) return undefined;
    const items = raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return items.length > 0 ? items : undefined;
  },
};

/**
 * Build {@link ProjectionOptions} from the request query. `type` is filtered to
 * real {@link NodeType} values (unknowns dropped); `depth`/`fields`/`lean`/`summary`
 * pass through their respective parsers.
 */
const parseProjectionOptions = (query: Record<string, unknown>): ProjectionOptions => {
  const opts: ProjectionOptions = {};
  if (queryParam.bool(query.summary)) opts.summary = true;
  if (queryParam.bool(query.lean)) opts.lean = true;

  const types = queryParam.list(query.type)?.filter((t): t is NodeType => NODE_TYPES.has(t));
  if (types && types.length > 0) opts.type = types;

  const depth = queryParam.int(query.depth);
  if (depth !== undefined) opts.depth = depth;

  const fields = queryParam.list(query.fields);
  if (fields) opts.fields = fields;

  return opts;
};

export const graphRouter = (graph: GraphService): Router => {
  const router = Router();

  router.get('/graph', (req, res) => {
    const snapshot = graph.getSnapshot();
    if (!snapshot) {
      res.status(503).json({ error: 'Graph not indexed yet' });
      return;
    }

    const query = req.query as Record<string, unknown>;
    const opts = parseProjectionOptions(query);
    const full = queryParam.bool(query.full);

    // Any explicit projection param means the caller has opted into a shape —
    // honor it directly (this includes `?summary=1`).
    const hasProjection =
      opts.summary === true ||
      opts.lean === true ||
      opts.type !== undefined ||
      opts.depth !== undefined ||
      opts.fields !== undefined;

    if (hasProjection) {
      res.json(projectGraph(snapshot, opts));
      return;
    }

    // No params: large graphs default to the cheap summary (a context-window
    // safeguard for AI callers) with a hint on how to get more; `?full=1` forces
    // the whole snapshot. Small graphs are returned in full, unchanged.
    if (!full && snapshot.nodes.length > DEFAULT_FULL_NODE_THRESHOLD) {
      res.json({
        ...summarizeSnapshot(snapshot),
        _hint:
          `Large graph (${snapshot.nodes.length} nodes): returning a summary. ` +
          'Add ?full=1 for the whole graph, or narrow it with ?lean=1, ' +
          '?type=component,function, or ?depth=2.',
      });
      return;
    }

    res.json(snapshot);
  });

  router.get('/node/:id', (req, res) => {
    const node = graph.getNode(req.params.id);
    if (!node) {
      res.status(404).json({ error: `Node not found: ${req.params.id}` });
      return;
    }
    res.json({ node });
  });

  router.get('/node/:id/source', (req, res) => {
    if (!graph.getSnapshot()) {
      res.status(503).json({ error: 'Graph not indexed yet' });
      return;
    }
    const src = graph.getNodeSource(req.params.id);
    if (!src) {
      res.status(404).json({ error: `No source for: ${req.params.id}` });
      return;
    }
    res.json(src);
  });

  return router;
};
