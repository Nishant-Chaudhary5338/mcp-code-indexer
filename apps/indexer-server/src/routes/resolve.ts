import type { Request, Response } from 'express';
import type { GraphService } from '../graph-service.js';

/** Outcome of resolving the `?repo=` query param against the registry. */
export type RepoResolution =
  | { ok: true; graph: GraphService }
  | { ok: false; status: number; error: string };

/** Resolves a request to the GraphService for its target repo (or an error). */
export type GraphResolver = (req: Request) => RepoResolution;

/**
 * Resolve the request's repo to a ready GraphService, writing the appropriate
 * error response (404 unknown / 503 not-ready) and returning null when it can't.
 * Handlers stay unchanged by shadowing their local `graph`:
 *
 *   const graph = resolveGraphOr(resolve, req, res);
 *   if (!graph) return;
 */
export const resolveGraphOr = (
  resolve: GraphResolver,
  req: Request,
  res: Response,
): GraphService | null => {
  const resolution = resolve(req);
  if (resolution.ok) return resolution.graph;
  res.status(resolution.status).json({ error: resolution.error });
  return null;
};
