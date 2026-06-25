import { runCli } from 'code-indexer-mcp/cli';
import { CodeIndexerServer } from 'code-indexer-mcp/server';
import { startServer } from './serve.js';

/**
 * The `code-graph-indexer` bin. Dispatches the two long-running modes (the HTTP/WS
 * `serve` and the stdio `mcp` server) and delegates everything else
 * (`index`, `query …`) to the shared CLI logic.
 */
const argv = process.argv.slice(2);
const command = argv[0];

const USAGE = `code-graph-indexer — index any TypeScript/React repo into a queryable code graph

Usage:
  code-graph-indexer mcp                                 run as an MCP server over stdio (for Claude Desktop, Cursor, Glama)
  code-graph-indexer serve [--root <path>] [--port <n>]  run the HTTP/WS server + web UI
  code-graph-indexer index [--root <path>] [--incremental]
  code-graph-indexer embed [--root <path>]
  code-graph-indexer check [--root <path>] [--max-cycles <n>] [--fail-on-orphans]
  code-graph-indexer query <who-renders|who-calls|find-references|blast-radius|find-cycles|orphans|graph|search|context|semantic> [--root <path>] [--id <node-id>] [--json]

MCP client config example:
  { "mcpServers": { "code-graph": { "command": "npx", "args": ["code-graph-indexer", "mcp"] } } }`;

// A full index of a large monorepo holds every package's ts-morph AST in memory
// and can exceed Node's default heap. For the heavy commands, re-exec once with a
// bigger heap when the caller hasn't set one. Guarded by an env flag so it can
// never loop; opt out with CODE_INDEXER_NO_REEXEC=1. (The inner `code-indexer`
// bin does this too; the published wrapper must do it independently.)
const HEAVY = new Set(['index', 'embed']);
const heapAlreadySet =
  process.execArgv.some((a) => a.includes('max-old-space-size')) ||
  (process.env.NODE_OPTIONS ?? '').includes('max-old-space-size');

if (
  HEAVY.has(command ?? '') &&
  !heapAlreadySet &&
  !process.env.CODE_INDEXER_REEXEC &&
  process.env.CODE_INDEXER_NO_REEXEC !== '1'
) {
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync(
    process.execPath,
    ['--max-old-space-size=8192', process.argv[1] as string, ...argv],
    { stdio: 'inherit', env: { ...process.env, CODE_INDEXER_REEXEC: '1' } },
  );
  process.exit(result.status ?? 0);
}

if (command === 'serve') {
  void startServer(argv.slice(1));
} else if (command === 'mcp') {
  new CodeIndexerServer().run().catch((err) => {
    console.error('code-graph-indexer mcp failed to start:', err);
    process.exit(1);
  });
} else if (!command || command === '--help' || command === '-h' || command === 'help') {
  console.log(USAGE);
} else {
  runCli(argv);
}
