export type IndexerConfig = {
  root: string;
  includeGlobs: string[];
  excludeDirs: string[];
  maxFilesPerPackage: number;
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
): IndexerConfig => ({
  root,
  includeGlobs: ['src/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}'],
  excludeDirs: DEFAULT_EXCLUDE_DIRS,
  maxFilesPerPackage: 1500,
  ...overrides,
});
