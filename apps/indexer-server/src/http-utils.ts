import type { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Express 4 does NOT forward rejected promises from async handlers to the error
 * middleware — an unhandled rejection would otherwise hang the request and can
 * crash the process. Wrap every async handler so rejections reach `next(err)`.
 */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

/** Terminal error-handling middleware: structured JSON 500, no stack leak. */
export const errorHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  // Express identifies error middleware by its 4-arg arity, so `_next` must stay.
  _next: NextFunction,
): void => {
  console.error('[indexer-server] unhandled route error:', err);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Internal server error' });
};

/** Terminal 404 handler for unmatched routes. */
export const notFoundHandler = (req: Request, res: Response): void => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });
};

/**
 * Minimal fixed-window in-memory rate limiter. Hand-rolled (rather than pulling
 * express-rate-limit) so the server has no extra runtime dependency to install
 * offline. Keyed by client IP; suitable for a localhost dev tool.
 */
export const rateLimit = (opts: {
  windowMs: number;
  max: number;
}): RequestHandler => {
  const hits = new Map<string, { count: number; resetAt: number }>();

  // Periodically evict stale buckets so the map can't grow unbounded.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }, opts.windowMs);
  sweep.unref?.();

  return (req, res, next) => {
    const key = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + opts.windowMs });
      next();
      return;
    }
    entry.count += 1;
    if (entry.count > opts.max) {
      res
        .status(429)
        .json({ error: 'Too many requests, slow down.', retryAfterMs: entry.resetAt - now });
      return;
    }
    next();
  };
};
