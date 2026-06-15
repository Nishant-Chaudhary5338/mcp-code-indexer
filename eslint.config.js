import { nodeConfig } from '@repo/eslint-config';

/**
 * Root flat config for the indexer Turborepo.
 *
 * ESLint v9 walks up the directory tree to find the nearest flat config, so each
 * workspace package (code-graph-core, _shared, code-indexer, indexer-server)
 * resolves to this file unless it ships its own. That makes the shared
 * `@repo/eslint-config` the single source of lint rules across all four packages.
 *
 * `pnpm lint` at the root runs `turbo run lint`, which invokes the `lint` script
 * in every package that defines one — so adding a `lint` script to a package is
 * all that's needed to bring it under the gate.
 */
export default [
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/coverage/**',
    ],
  },
  ...nodeConfig,
];
