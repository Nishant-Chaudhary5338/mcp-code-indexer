import * as path from 'path';
import { createServer } from 'http';
import { createIndexerApp, type IndexerAppHandle } from 'indexer-server/app';

// Re-export the mountable factory so a host (e.g. the merged toolkit server) can
// mount the indexer as a sub-app + WS on its own http.Server.
export { createIndexerApp };
export type { IndexerAppHandle };

const flag = (argv: string[], name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : undefined;
};

/**
 * Boot the standalone HTTP + WebSocket indexer server (the `serve` bin command).
 * Binds 127.0.0.1 only — the endpoints are unauthenticated and mutating.
 */
export const startServer = async (argv: string[] = []): Promise<void> => {
  const rootArg = flag(argv, '--root') ?? process.env.INDEXER_ROOT ?? process.cwd();
  const root = path.resolve(rootArg);
  const port = Number(flag(argv, '--port') ?? process.env.INDEXER_PORT ?? 3002);

  const handle = createIndexerApp({ root });
  const server = createServer(handle.app);
  handle.attachWs(server);
  server.listen(port, '127.0.0.1', () => {
    console.log(`🔭 code-graph-indexer server on http://127.0.0.1:${port}`);
    console.log(`   root: ${root}`);
    void handle.indexOnBoot().then(() => handle.startWatching());
  });
};
