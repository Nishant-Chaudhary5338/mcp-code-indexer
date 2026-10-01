import { Router } from 'express';
import { asyncHandler, rateLimit } from '../http-utils.js';
import { resolveGraphOr, type GraphResolver } from './resolve.js';

export const reindexRouter = (resolve: GraphResolver): Router => {
  const router = Router();

  // Reindex is expensive and mutates shared state — rate-limit it.
  const limiter = rateLimit({ windowMs: 60_000, max: 5 });

  router.post(
    '/reindex',
    limiter,
    asyncHandler(async (req, res) => {
      // Hosted demo: a full index runs synchronous ts-morph on this thread and
      // freezes every other request, so the public server never runs one on demand.
      if (process.env.WEB_DIST) {
        res.status(403).json({ error: 'Reindexing is disabled in the hosted demo.' });
        return;
      }
      const graph = resolveGraphOr(resolve, req, res);
      if (!graph) return;
      // Read-only (cloned) repos are served from a worker-built snapshot; never
      // run ts-morph for them in this process.
      if (graph.readOnly) {
        res.status(405).json({ error: 'This repo is read-only.' });
        return;
      }
      const startedAt = Date.now();
      // Goes through the serialize queue inside the service, so it can't
      // interleave with watcher reparse/enrichment.
      const snapshot = await graph.indexFull();
      res.json({
        nodeCount: snapshot.meta.nodeCount,
        edgeCount: snapshot.meta.edgeCount,
        durationMs: Date.now() - startedAt,
      });
    }),
  );

  return router;
};
