import { defineConfig } from 'tsup';
import { cpSync, existsSync } from 'node:fs';
import * as path from 'node:path';

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
  // Copy the prebuilt 3D web explorer into the bundle AFTER tsup finishes —
  // `clean: true` wipes `dist/` at the start of each build, so the UI must land
  // afterward. `serve.ts` serves it from `dist/web` (resolved via import.meta.url).
  // The UI is built by the `code-graph` workspace package (a devDependency, so
  // Turbo's `^build` builds it first); if its dist is missing we warn but don't
  // fail — the package still works headlessly.
  onSuccess: async () => {
    const uiDist = path.resolve(__dirname, '../../apps/web/code-graph/dist');
    const dest = path.resolve(__dirname, 'dist/web');
    if (existsSync(path.join(uiDist, 'index.html'))) {
      cpSync(uiDist, dest, { recursive: true });
      console.log(`✓ bundled 3D web explorer → dist/web`);
    } else {
      console.warn(
        `⚠ web UI not found at ${uiDist} — package will run headless.\n` +
          `  Build it first: pnpm --filter code-graph build`,
      );
    }
  },
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
