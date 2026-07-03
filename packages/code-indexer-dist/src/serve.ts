import * as path from 'path';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
 * Locate the 3D web explorer bundled alongside this file at `dist/web`. Resolved
 * from `import.meta.url` — NOT `process.cwd()`, which points at the user's repo,
 * not the installed package. Returns the dir only if it actually exists (a
 * source-tree run before `tsup` copies the UI in has no bundle).
 */
const resolveBundledWebDist = (): string | undefined => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidate = path.join(here, 'web');
  return existsSync(path.join(candidate, 'index.html')) ? candidate : undefined;
};

/**
 * Boot the standalone HTTP + WebSocket indexer server (the `serve`/`ui` bin
 * commands). Binds 127.0.0.1 only — the endpoints are unauthenticated and
 * mutating. Serves the bundled 3D explorer when it's present in the package.
 */
export const startServer = async (argv: string[] = []): Promise<void> => {
  const rootArg = flag(argv, '--root') ?? process.env.INDEXER_ROOT ?? process.cwd();
  const root = path.resolve(rootArg);
  const port = Number(flag(argv, '--port') ?? process.env.INDEXER_PORT ?? 3002);
  const webDist = resolveBundledWebDist();

  // Fail fast with a clear message on a mistyped root rather than booting and
  // then throwing a raw fs/ts-morph error mid-index.
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.error(
      `\n✖ Root path is not a directory: ${root}\n` +
        `  Point --root at an existing repo folder, e.g.:\n` +
        `    code-graph-indexer ui --root .\n`,
    );
    process.exit(1);
  }

  const handle = createIndexerApp({ root, webDist });
  const server = createServer(handle.app);

  // Surface a friendly, actionable message when the port is already taken
  // instead of an unhandled EADDRINUSE stack trace. MUST be registered BEFORE
  // attachWs: the ws WebSocketServer attaches its own 'error' listener to this
  // server and re-emits on itself (no handler → throws), so our listener has to
  // run first and exit the process before ws's re-emit fires.
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `\n✖ Port ${port} is already in use.\n` +
          `  Another server (maybe a previous run) is on it. Try a different port:\n` +
          `    code-graph-indexer serve --port ${port + 1}\n`,
      );
      process.exit(1);
    }
    throw err;
  });

  handle.attachWs(server);

  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}`;
    console.log(`🔭 code-graph-indexer server on ${url}`);
    console.log(`   root: ${root}`);
    if (webDist) {
      console.log(`\n   ➜  Open the 3D code explorer:  ${url}\n`);
    } else {
      console.log(`   (headless — JSON/WS API only; the bundled UI was not found)`);
    }
    void handle.indexOnBoot().then(() => handle.startWatching());
  });
};
