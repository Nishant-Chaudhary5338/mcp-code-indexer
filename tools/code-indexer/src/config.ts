import { existsSync, statSync } from 'node:fs';

export type IndexerConfig = {
  root: string;
  includeGlobs: string[];
  excludeDirs: string[];
  maxFilesPerPackage: number;
};

/**
 * Validate that `root` points at a real directory before any indexing work, so a
 * mistyped path (the most common agent/CLI error) yields a clear, actionable
 * message instead of a raw ts-morph/fs stack trace deep in the engine.
 */
export const validateRoot = (root: string): void => {
  if (!existsSync(root)) {
    throw new Error(
      `Root path does not exist: ${root}\n` +
        `  Pass an existing repo directory with --root, e.g. --root .`,
    );
  }
  if (!statSync(root).isDirectory()) {
    throw new Error(
      `Root path is not a directory: ${root}\n` +
        `  --root must point at a repo folder, not a file.`,
    );
  }
};

export const DEFAULT_EXCLUDE_DIRS: string[] = [
  'node_modules',
  'build',
  'dist',
  '.turbo',
  '.git',
  'coverage',
  'storybook-static',
  '.code-graph',
];

const SOURCE_EXTENSIONS = ['.ts', '.tsx'] as const;

export const isSourceFile = (filePath: string): boolean =>
  SOURCE_EXTENSIONS.some((ext) => filePath.endsWith(ext)) &&
  !filePath.endsWith('.d.ts');

export const createConfig = (
  root: string,
  overrides: Partial<IndexerConfig> = {},
): IndexerConfig => {
  validateRoot(root);
  return {
    root,
    includeGlobs: ['src/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}'],
    excludeDirs: DEFAULT_EXCLUDE_DIRS,
    maxFilesPerPackage: 1500,
    ...overrides,
  };
};
