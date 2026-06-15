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

if (command === 'serve') {
  void startServer(argv.slice(1));
} else if (command === 'mcp') {
  new CodeIndexerServer().run().catch((err) => {
    console.error('code-graph-indexer mcp failed to start:', err);
    process.exit(1);
  });
} else {
  runCli(argv);
}
