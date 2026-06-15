import { reactConfig } from '@repo/eslint-config';

/**
 * The code-graph viewer is a React app, so it uses the shared `reactConfig`
 * (which loads the react-hooks / react-refresh plugins) rather than the
 * repo-root `nodeConfig`. A local flat config wins over the upward-resolved
 * root config for files under this package.
 */
export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  ...reactConfig,
];
