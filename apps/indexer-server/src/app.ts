import type { Server } from 'http';
import express from 'express';
import cors from 'cors';
import type { AsyncSubscription } from '@parcel/watcher';
import { GraphService } from './graph-service.js';
import { graphRouter } from './routes/graph.js';
import { queryRouter } from './routes/query.js';
import { reindexRouter } from './routes/reindex.js';
import { knowledgeRouter } from './routes/knowledge.js';
import { attachWsHub, type WsHub } from './ws-hub.js';
import { startWatcher } from './watcher.js';
import { errorHandler, notFoundHandler } from './http-utils.js';

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
  /** The live graph service backing every route and the WS hub. */
  graph: GraphService;
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
export function createIndexerApp(opts: { root: string }): IndexerAppHandle {
  const { root } = opts;
  const graph = new GraphService(root);

  // Port the standalone server binds, surfaced via /health for parity with the
  // pre-refactor server. Read from env only — the factory never binds it.
  const PORT = Number(process.env.INDEXER_PORT ?? 3002);

  // Tracks whether the live-edit watcher is up, surfaced via /health and /.
  let watcherReady = false;

  const app = express();
  app.use(cors({ origin: /^http:\/\/localhost:\d+$/ }));
  app.use(express.json({ limit: '256kb' }));

  // Friendly root: this is a JSON API with no web UI, so make a browser hit to
  // "/" self-describing instead of a bare 404.
  app.get('/', (_req, res) => {
    const snapshot = graph.getSnapshot();
    res.json({
      service: 'code-intelligence indexer',
      status: 'ok',
      root,
      indexed: snapshot !== null,
      watching: watcherReady,
      graph: snapshot ? { nodes: snapshot.meta.nodeCount, edges: snapshot.meta.edgeCount } : null,
      endpoints: {
        'GET /health': 'liveness + readiness',
        'GET /api/graph': 'the code graph; ?summary|type|depth|lean|fields|full project it',
        'GET /api/node/:id': 'a single node with its source',
        'GET /api/who-renders/:id': 'components that render a node',
        'GET /api/who-calls/:id': 'symbols that call a node',
        'GET /api/references/:id': 'references into a node (?types=renders,calls)',
        'GET /api/blast-radius/:id': 'everything that transitively depends on a node',
        'GET /api/cycles': 'dependency cycles in the graph',
        'POST /api/reindex': 'force a full re-index',
        'POST /api/knowledge/:id': 'generate a knowledge summary for a node',
        'POST /api/chat': 'ask a question about the codebase',
        'WS /ws': 'live graph patches as files change',
      },
    });
  });

  app.get('/health', (_req, res) =>
    res.json({
      status: 'ok',
      port: PORT,
      indexed: graph.getSnapshot() !== null,
      watching: watcherReady,
    }),
  );
  app.use('/api', graphRouter(graph));
  app.use('/api', queryRouter(graph));
  app.use('/api', reindexRouter(graph));
  app.use('/api', knowledgeRouter(graph));

  // 404 + terminal error middleware must be registered last.
  app.use(notFoundHandler);
  app.use(errorHandler);

  // Captured so a host can close the hub during its own shutdown if it wants;
  // the standalone entrypoint closes it directly via the returned WsHub today,
  // but here we hold the reference for symmetry / future host-driven teardown.
  let wsHub: WsHub | null = null;
  const attachWs = (server: Server, path = '/ws'): void => {
    wsHub = attachWsHub(server, graph, path);
  };

  const indexOnBoot = async (): Promise<void> => {
    const startedAt = Date.now();
    const snapshot = await graph.indexFull();
    console.log(
      `   ✓ ${snapshot.meta.nodeCount} nodes · ${snapshot.meta.edgeCount} edges in ${Date.now() - startedAt}ms`,
    );
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

  return { app, graph, attachWs, indexOnBoot, startWatching };
}
