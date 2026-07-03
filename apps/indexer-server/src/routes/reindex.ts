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
