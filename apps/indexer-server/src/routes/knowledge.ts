import { Router } from 'express';
import { asyncHandler, rateLimit } from '../http-utils.js';
import { resolveGraphOr, type GraphResolver } from './resolve.js';

/** Hard cap on chat input so we never pipe unbounded text to an LLM. */
const MAX_QUESTION_CHARS = 4000;
/** A sane upper bound for a bring-your-own Anthropic key; longer is ignored. */
const MAX_API_KEY_CHARS = 200;

export const knowledgeRouter = (resolve: GraphResolver): Router => {
  const router = Router();

  // Both routes spawn work (LLM subprocess / typecheck) — rate-limit them.
  const limiter = rateLimit({ windowMs: 60_000, max: 20 });

  router.post(
    '/knowledge/:id',
    limiter,
    asyncHandler(async (req, res) => {
      const graph = resolveGraphOr(resolve, req, res);
      if (!graph) return;
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
      const graph = resolveGraphOr(resolve, req, res);
      if (!graph) return;
      const body = req.body as { question?: unknown; apiKey?: unknown };
      const question = body.question;
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
      // Optional bring-your-own key: used for this one request, never stored.
      const apiKey =
        typeof body.apiKey === 'string' &&
        body.apiKey.length > 0 &&
        body.apiKey.length <= MAX_API_KEY_CHARS
          ? body.apiKey
          : undefined;
      const result = await graph.askCodebase(question, { apiKey });
      res.json(result);
    }),
  );

  return router;
};
