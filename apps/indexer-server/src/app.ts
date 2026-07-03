import type { Server } from 'http';
import * as path from 'path';
import { existsSync } from 'node:fs';
import express from 'express';
import cors, { type CorsOptions } from 'cors';
import type { AsyncSubscription } from '@parcel/watcher';
import { GraphService } from './graph-service.js';
import { SessionRegistry } from './session-registry.js';
import { graphRouter } from './routes/graph.js';
import { queryRouter } from './routes/query.js';
import { reindexRouter } from './routes/reindex.js';
import { knowledgeRouter } from './routes/knowledge.js';
import { reposRouter } from './routes/repos.js';
import type { GraphResolver } from './routes/resolve.js';
import { attachWsHub, type WsHub } from './ws-hub.js';
import { startWatcher } from './watcher.js';
import { errorHandler, notFoundHandler } from './http-utils.js';

/** The default (always-live) repo's id — the boot/local-dev repo. */
const DEFAULT_REPO_ID = 'default';

/**
 * CORS policy. The web app is served from the SAME origin as the API in
 * production, so same-origin and tool requests (no Origin header) are always
 * allowed; localhost dev ports are allowed too; additional origins can be
 * whitelisted via the `CORS_ORIGIN` env (comma-separated).
 */
const buildCorsOptions = (hosted: boolean): CorsOptions => {
  const extra = (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    origin(origin, callback) {
      // No Origin (same-origin / curl / the bundled SPA) is always allowed.
      // Localhost dev ports are allowed only in local mode — a public deploy
      // serves its own SPA same-origin, so it shouldn't trust arbitrary localhost.
      const allowed =
        !origin ||
        extra.includes(origin) ||
        (!hosted && /^http:\/\/localhost:\d+$/.test(origin));
      callback(null, allowed);
    },
  };
};

/**
 * Everything a host needs to run the indexer: the configured Express app (routes
 * mounted, no `listen`), the live {@link GraphService}, plus hooks to attach the
 * WS hub to a caller-owned `http.Server`, run the boot index, and start/stop the
 * filesystem watcher. The factory never creates an `http.Server`, never calls
 * `listen`, and never hard-codes a port — so it can be mounted inside a larger
 * Express app (e.g. a toolkit server hosting the WS at '/indexer/ws').
 */
export interface IndexerAppHandle {
  /** The configured router/app — routes mounted, NO listen. */
  app: express.Express;
  /** The live graph service for the default repo (watcher + reindex). */
  graph: GraphService;
  /** Multi-repo registry: default repo + curated showcase + on-demand clones. */
  registry: SessionRegistry;
  /** Attach the WS hub to a provided http.Server at `path` (default '/ws'). */
  attachWs(server: Server, path?: string): void;
  /** Run a full index + kick progressive status enrichment (boot behavior). */
  indexOnBoot(): Promise<void>;
  /** Start the @parcel/watcher for live edits; returns a stop fn. */
  startWatching(): () => void;
}

/**
 * Build the indexer's Express app and its runtime wiring without owning the HTTP
 * server or the process lifecycle. The standalone entrypoint composes this with
 * `http.createServer` + `listen`; a host app composes it with its own server.
 *
 * The HTTP port is read from the environment purely for the informational
 * `/health` payload — the factory itself never binds a port.
 */
export function createIndexerApp(opts: {
  root: string;
  label?: string;
  /**
   * Absolute path to a built web app to serve same-origin. Overrides the
   * `WEB_DIST` env var (which the hosted deploy still uses). The npm package
   * passes its bundled `dist/web` here, resolved from `import.meta.url`.
   */
  webDist?: string;
}): IndexerAppHandle {
  const { root } = opts;
  const graph = new GraphService(root);
  const registry = new SessionRegistry();
  registry.registerLive(DEFAULT_REPO_ID, opts.label ?? path.basename(root), graph);

  // Resolve a request's `?repo=` to a ready GraphService (or a typed error). The
  // default repo is used when the param is absent, preserving single-repo calls.
  const resolveGraph: GraphResolver = (req) => {
    const raw = req.query.repo;
    const repoId = typeof raw === 'string' && raw.length > 0 ? raw : registry.defaultId();
    if (!repoId) return { ok: false, status: 503, error: 'No repo available yet.' };
    const entry = registry.get(repoId);
    if (!entry) return { ok: false, status: 404, error: `Unknown repo: ${repoId}` };
    const resolved = registry.resolveGraph(repoId);
    if (!resolved) {
      return { ok: false, status: 503, error: `Repo "${entry.label}" is ${entry.status}.` };
    }
    return { ok: true, graph: resolved };
  };

  // Port the standalone server binds, surfaced via /health for parity with the
  // pre-refactor server. Read from env only — the factory never binds it.
  const PORT = Number(process.env.INDEXER_PORT ?? 3002);
  // Path to the built web app to serve same-origin. Explicit option wins (the
  // npm package's bundled UI); the WEB_DIST env is the hosted-deploy fallback.
  const webDist = opts.webDist ?? process.env.WEB_DIST;

  // Tracks whether the live-edit watcher is up, surfaced via /health and /.
  let watcherReady = false;

  const app = express();
  // Behind Render's proxy, trust one hop so `req.ip` is the real client — the
  // per-IP rate limiters key on it (otherwise every client collapses to the
  // proxy IP and the limits become global).
  if (webDist) app.set('trust proxy', 1);
  app.use(cors(buildCorsOptions(Boolean(webDist))));
  app.use(express.json({ limit: '256kb' }));

  // When no web app is bundled, a browser hit to "/" gets a self-describing
  // JSON API map instead of a bare 404. With WEB_DIST set, the static handler
  // below owns "/" and serves the SPA.
  if (!webDist) {
    app.get('/', (_req, res) => {
      const snapshot = graph.getSnapshot();
      res.json({
        service: 'code-intelligence indexer',
        status: 'ok',
        root,
        indexed: snapshot !== null,
        watching: watcherReady,
        graph: snapshot
          ? { nodes: snapshot.meta.nodeCount, edges: snapshot.meta.edgeCount }
          : null,
        endpoints: {
          'GET /health': 'liveness + readiness',
          'GET /api/repos': 'list known repos + the default id',
          'POST /api/repos': 'load a public GitHub repo (clone + index)',
          'GET /api/repos/:id': 'one repo build status',
          'GET /api/graph': 'the code graph; ?repo=<id>&summary|type|depth|lean|fields|full',
          'GET /api/node/:id': 'a single node with its source (?repo=<id>)',
          'GET /api/blast-radius/:id': 'everything that transitively depends on a node',
          'GET /api/cycles': 'dependency cycles in the graph',
          'POST /api/chat': 'ask a question (optional bring-your-own apiKey)',
          'WS /ws?repo=<id>': 'live graph patches as files change',
        },
      });
    });
  }

  app.get('/health', (_req, res) =>
    res.json({
      status: 'ok',
      port: PORT,
      indexed: graph.getSnapshot() !== null,
      watching: watcherReady,
      repos: registry.list().length,
    }),
  );
  app.use('/api', reposRouter(registry));
  app.use('/api', graphRouter(resolveGraph));
  app.use('/api', queryRouter(resolveGraph));
  app.use('/api', reindexRouter(resolveGraph));
  app.use('/api', knowledgeRouter(resolveGraph));

  // Production: serve the built web app from the same origin (so the client's
  // same-origin WS + fetch "just work"), with an SPA fallback for client routes.
  if (webDist && existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get(/^\/(?!api\/|ws\b|health\b).*/, (_req, res) => {
      res.sendFile(path.join(webDist, 'index.html'));
    });
  }

  // 404 + terminal error middleware must be registered last.
  app.use(notFoundHandler);
  app.use(errorHandler);

  // Captured so a host can close the hub during its own shutdown if it wants;
  // the standalone entrypoint closes it directly via the returned WsHub today,
  // but here we hold the reference for symmetry / future host-driven teardown.
  let wsHub: WsHub | null = null;
  const attachWs = (server: Server, path = '/ws'): void => {
    wsHub = attachWsHub(server, registry, path);
  };

  const indexOnBoot = async (): Promise<void> => {
    const startedAt = Date.now();
    const snapshot = await graph.indexFull();
    console.log(
      `   ✓ ${snapshot.meta.nodeCount} nodes · ${snapshot.meta.edgeCount} edges in ${Date.now() - startedAt}ms`,
    );
    registry.markLiveReady(DEFAULT_REPO_ID);
    console.log('   GET  /api/graph · GET /api/node/:id · POST /api/reindex · WS /ws');
    console.log('   enriching status in background…');
    await graph.enrichStatusProgressive();
    console.log('   ✓ status enrichment complete');
  };

  const startWatching = (): (() => void) => {
    // The subscription resolves asynchronously; capture it so the returned stop
    // fn can unsubscribe even if called before the subscribe promise settles.
    let watcherSub: AsyncSubscription | null = null;
    let stopped = false;
    void startWatcher(root, graph)
      .then((sub) => {
        if (stopped) {
          // Stopped before the watcher came up — tear it down immediately.
          void sub.unsubscribe();
          return;
        }
        watcherSub = sub;
        watcherReady = true;
        console.log('   👀 watching for changes — edit a file to see it update live\n');
      })
      .catch((err) => {
        console.error('watcher start failed:', err);
      });

    return () => {
      stopped = true;
      watcherReady = false;
      if (watcherSub) {
        const sub = watcherSub;
        watcherSub = null;
        void sub.unsubscribe().catch((err) => {
          console.error('watcher unsubscribe error:', err);
        });
      }
      if (wsHub) {
        wsHub.close();
        wsHub = null;
      }
    };
  };

  return { app, graph, registry, attachWs, indexOnBoot, startWatching };
}
