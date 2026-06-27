import { Router } from 'express';
import { rateLimit } from '../http-utils.js';
import type { SessionRegistry } from '../session-registry.js';

/**
 * Repo lifecycle endpoints for the multi-repo demo:
 *   GET  /repos       — every known repo + the default id (for the picker)
 *   POST /repos        — load a public GitHub repo (clone + index, async)
 *   GET  /repos/:id    — one repo's build status (clients poll this)
 */
export const reposRouter = (registry: SessionRegistry): Router => {
  const router = Router();

  // Cloning + indexing is the expensive, abusable action — rate-limit hard.
  const loadLimiter = rateLimit({ windowMs: 60_000, max: 5 });

  router.get('/repos', (_req, res) => {
    res.json({ repos: registry.list(), defaultId: registry.defaultId() });
  });

  router.post('/repos', loadLimiter, (req, res) => {
    const url = (req.body as { url?: unknown }).url;
    if (typeof url !== 'string' || url.trim().length === 0) {
      res.status(400).json({ error: 'url must be a non-empty string' });
      return;
    }
    const result = registry.loadGithub(url);
    if ('error' in result) {
      res.status(400).json({ error: result.error });
      return;
    }
    const { entry } = result;
    res.status(202).json({ id: entry.id, label: entry.label, status: entry.status });
  });

  router.get('/repos/:id', (req, res) => {
    const entry = registry.get(req.params.id);
    if (!entry) {
      res.status(404).json({ error: `Unknown repo: ${req.params.id}` });
      return;
    }
    res.json({
      id: entry.id,
      label: entry.label,
      origin: entry.origin,
      status: entry.status,
      nodeCount: entry.nodeCount,
      edgeCount: entry.edgeCount,
      error: entry.error,
    });
  });

  return router;
};
