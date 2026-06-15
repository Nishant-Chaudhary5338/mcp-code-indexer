import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { existsSync } from 'node:fs';
import * as path from 'path';
import { createIndexerApp } from './app.js';
import { killAllClaudeChildren } from './claude-cli.js';

const PORT = Number(process.env.INDEXER_PORT ?? 3002);
// Bind to loopback only: this server exposes unauthenticated mutating + LLM
// endpoints, so it must not be reachable off-host.
const HOST = '127.0.0.1';
const here = path.dirname(fileURLToPath(import.meta.url));

/** Walk up from `start` to the repo root (the dir holding pnpm-workspace.yaml). */
const findRepoRoot = (start: string): string => {
  let dir = start;
  while (dir !== path.dirname(dir)) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    dir = path.dirname(dir);
  }
  return start;
};

// A relative INDEXER_ROOT (e.g. "../app") is resolved against the repo
// root, not the process cwd — so it behaves identically whether the server is
// launched from the repo root or via `pnpm --filter` (which changes cwd to the
// package dir). Absolute paths are used as-is. Defaults to indexing this repo.
const REPO_ROOT_DIR = findRepoRoot(here);
const REPO_ROOT = process.env.INDEXER_ROOT
  ? path.resolve(REPO_ROOT_DIR, process.env.INDEXER_ROOT)
  : REPO_ROOT_DIR;

const handle = createIndexerApp({ root: REPO_ROOT });

const server = createServer(handle.app);
handle.attachWs(server);

// Stop fn for the live-edit watcher (also closes the WS hub); set once the
// server is up and the boot index has run.
let stopWatching: (() => void) | null = null;
let shuttingDown = false;

const shutdown = async (signal: string): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} received — shutting down…`);
  try {
    if (stopWatching) stopWatching();
  } catch (err) {
    console.error('watcher unsubscribe error:', err);
  }
  killAllClaudeChildren();
  server.close(() => {
    console.log('   ✓ server closed');
    process.exit(0);
  });
  // Don't hang forever if a connection refuses to drain.
  setTimeout(() => process.exit(0), 5000).unref();
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

server.listen(PORT, HOST, () => {
  console.log(`\n🔭 Indexer server on http://${HOST}:${PORT}`);
  console.log(`   root: ${REPO_ROOT}`);
  console.log('   indexing…');
  void handle
    .indexOnBoot()
    .then(() => {
      stopWatching = handle.startWatching();
    })
    .catch((err) => {
      console.error('initial index failed:', err);
    });
});
