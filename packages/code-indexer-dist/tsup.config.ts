import { defineConfig } from 'tsup';

/**
 * Bundle the whole indexer (engine + MCP server + HTTP/WS server + core schemas)
 * into one self-contained, npx-runnable package.
 *
 * - The workspace packages (`code-indexer-mcp`, `@repo/code-graph-core`,
 *   `@tools/shared`, `indexer-server`) are INLINED via `noExternal` so the
 *   published tarball carries no `workspace:*` deps.
 * - The heavy/native runtime deps stay EXTERNAL: `ts-morph`/`typescript` resolve
 *   their lib `.d.ts` files relative to their own install dir (must not be
 *   inlined), and `@parcel/watcher` ships per-platform native prebuilds. They are
 *   declared as real `dependencies` so npx installs them normally.
 */
export default defineConfig({
  entry: {
    cli: 'src/cli.ts',
    mcp: 'src/mcp.ts',
    serve: 'src/serve.ts',
    index: 'src/index.ts',
    core: 'src/core.ts',
  },
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  // Types are a follow-up; the bundle is fully functional without shipped .d.ts.
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  shims: true,
  banner: { js: '#!/usr/bin/env node' },
  external: [
    'ts-morph',
    'typescript',
    '@modelcontextprotocol/sdk',
    'express',
    'cors',
    'ws',
    '@parcel/watcher',
    // Optional local-embeddings dep (semantic search). Lazy-imported at runtime
    // and ships native onnxruntime/sharp prebuilds — must never be inlined; it's
    // an optionalDependency so absence degrades gracefully to lexical search.
    '@xenova/transformers',
  ],
  noExternal: [
    'code-indexer-mcp',
    '@repo/code-graph-core',
    '@tools/shared',
    'indexer-server',
  ],
});
