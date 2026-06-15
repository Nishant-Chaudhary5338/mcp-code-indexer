import { Router } from 'express';
import type { GraphService } from '../graph-service.js';
import { asyncHandler, rateLimit } from '../http-utils.js';

/** Hard cap on chat input so we never pipe unbounded text to the Claude CLI. */
const MAX_QUESTION_CHARS = 4000;

export const knowledgeRouter = (graph: GraphService): Router => {
  const router = Router();

  // Both routes spawn work (LLM subprocess / typecheck) — rate-limit them.
  const limiter = rateLimit({ windowMs: 60_000, max: 20 });

  router.post(
    '/knowledge/:id',
    limiter,
    asyncHandler(async (req, res) => {
      const node = await graph.generateKnowledge(req.params.id);
      if (!node) {
        res.status(404).json({ error: `Node not found: ${req.params.id}` });
        return;
      }
      res.json({ knowledge: node.knowledge });
    }),
  );

  router.post(
    '/chat',
    limiter,
    asyncHandler(async (req, res) => {
      const question = (req.body as { question?: unknown }).question;
      if (typeof question !== 'string' || question.trim().length === 0) {
        res.status(400).json({ error: 'question must be a non-empty string' });
        return;
      }
      if (question.length > MAX_QUESTION_CHARS) {
        res.status(400).json({
          error: `question exceeds ${MAX_QUESTION_CHARS} characters`,
        });
        return;
      }
      const result = await graph.askCodebase(question);
      res.json(result);
    }),
  );

  return router;
};
