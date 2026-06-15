import { Router } from 'express';
import type { GraphService } from '../graph-service.js';
import { asyncHandler, rateLimit } from '../http-utils.js';

export const reindexRouter = (graph: GraphService): Router => {
  const router = Router();

  // Reindex is expensive and mutates shared state — rate-limit it.
  const limiter = rateLimit({ windowMs: 60_000, max: 5 });

  router.post(
    '/reindex',
    limiter,
    asyncHandler(async (_req, res) => {
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
