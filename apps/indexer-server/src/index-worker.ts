import { writeFileSync } from 'node:fs';
import { runFullIndex } from 'code-indexer-mcp/engine';
import { createConfig } from 'code-indexer-mcp/config';

/**
 * Out-of-process indexer. A public server must never run ts-morph in its own
 * process — one oversized repo can exhaust the heap and take the whole demo down
 * with it. This worker indexes ONE root in isolation (its own heap, its own
 * wall-clock budget enforced by the parent), writes the resulting snapshot to a
 * JSON file, and exits. The parent reads that file and serves it read-only.
 *
 * Usage: node --import tsx index-worker.ts <root> <outPath>
 */
const [root, outPath] = process.argv.slice(2);

if (!root || !outPath) {
  console.error('index-worker: expected <root> <outPath>');
  process.exit(2);
}

try {
  const { snapshot, durationMs } = runFullIndex(createConfig(root));
  writeFileSync(outPath, JSON.stringify(snapshot));
  // Single status line on stdout for the parent to log; the payload is the file.
  console.log(
    `indexed ${snapshot.meta.nodeCount} nodes · ${snapshot.meta.edgeCount} edges in ${durationMs}ms`,
  );
  process.exit(0);
} catch (err) {
  console.error('index-worker failed:', err instanceof Error ? err.message : err);
  process.exit(1);
}
