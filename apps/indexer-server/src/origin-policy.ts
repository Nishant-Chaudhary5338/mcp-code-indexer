/**
 * Which browser origins may call the API or open the live WebSocket. Requests
 * with no Origin (curl, MCP tools) are always allowed; extra origins come from
 * the comma-separated `CORS_ORIGIN` env. Localhost dev ports are trusted only in
 * local mode — a public deploy serves its own SPA and shouldn't trust them.
 *
 * `host` is the request's Host header. Browsers send an Origin on every
 * WebSocket handshake, including same-origin ones, so the WS check passes it to
 * accept the page this server itself served.
 */
export const isAllowedOrigin = (
  origin: string | undefined,
  opts: { hosted: boolean; host?: string },
): boolean => {
  if (!origin) return true;
  const extra = (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (extra.includes(origin)) return true;
  if (!opts.hosted && /^http:\/\/localhost:\d+$/.test(origin)) return true;
  if (!opts.host) return false;
  try {
    return new URL(origin).host === opts.host;
  } catch {
    return false;
  }
};
