import * as fs from 'fs';
import * as path from 'path';

export type WorkspacePackage = {
  name: string;
  version: string;
  absPath: string;
  relPath: string;
  type: 'app' | 'package' | 'tool' | 'config';
  internalDeps: string[];
};

export type Workspace = {
  root: string;
  rootName: string;
  packages: WorkspacePackage[];
};

const CONFIG_HINTS = ['eslint', 'typescript', 'tailwind'];

const findMonorepoRoot = (startDir: string): string => {
  let dir = startDir;
  let firstPackageDir: string | null = null;
  while (dir !== path.dirname(dir)) {
    const hasMarker =
      fs.existsSync(path.join(dir, 'pnpm-workspace.yaml')) ||
      fs.existsSync(path.join(dir, 'turbo.json')) ||
      fs.existsSync(path.join(dir, 'lerna.json'));
    if (hasMarker) return dir;
    if (firstPackageDir === null && fs.existsSync(path.join(dir, 'package.json'))) {
      firstPackageDir = dir;
    }
    dir = path.dirname(dir);
  }
  // Standalone repo: no workspace file, but a package.json makes it a single package.
  if (firstPackageDir) return firstPackageDir;
  throw new Error('No repo root found (no workspace file or package.json)');
};

const isMonorepo = (root: string): boolean =>
  fs.existsSync(path.join(root, 'pnpm-workspace.yaml')) ||
  fs.existsSync(path.join(root, 'turbo.json')) ||
  fs.existsSync(path.join(root, 'lerna.json'));

const readWorkspacePatterns = (root: string): string[] => {
  const file = path.join(root, 'pnpm-workspace.yaml');
  if (fs.existsSync(file)) {
    const content = fs.readFileSync(file, 'utf-8');
    const match = content.match(/packages:\s*\n((?:\s+-\s+.+\n?)+)/);
    if (match?.[1]) {
      return match[1]
        .split('\n')
        .filter((l) => l.trim().startsWith('-'))
        .map((l) => l.replace(/.*-\s+['"]?/, '').replace(/['"]$/, '').trim())
        .filter(Boolean);
    }
  }
  return ['apps/*', 'packages/*', 'tools/*'];
};

const expandPattern = (pattern: string, root: string): string[] => {
  if (!pattern.includes('*')) {
    const dir = path.join(root, pattern);
    return fs.existsSync(path.join(dir, 'package.json')) ? [dir] : [];
  }
  const parent = path.join(root, pattern.replace(/\*$/, ''));
  if (!fs.existsSync(parent)) return [];
  return fs
    .readdirSync(parent, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(parent, e.name))
    .filter((p) => fs.existsSync(path.join(p, 'package.json')));
};

const classify = (relPath: string, name: string): WorkspacePackage['type'] => {
  if (relPath === '') return 'app'; // standalone repo root
  if (relPath.startsWith('apps/')) return 'app';
  if (relPath.startsWith('tools/')) return 'tool';
  if (CONFIG_HINTS.some((h) => name.includes(h))) return 'config';
  return 'package';
};

type PackageJson = {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

export const discoverWorkspace = (startDir: string): Workspace => {
  const root = findMonorepoRoot(startDir);
  const rootPkg = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf-8'),
  ) as PackageJson;

  const raw: { pkg: PackageJson; absPath: string }[] = [];
  if (isMonorepo(root)) {
    for (const pattern of readWorkspacePatterns(root)) {
      for (const absPath of expandPattern(pattern, root)) {
        const pkg = JSON.parse(
          fs.readFileSync(path.join(absPath, 'package.json'), 'utf-8'),
        ) as PackageJson;
        raw.push({ pkg, absPath });
      }
    }
  } else {
    // Standalone single-package repo — the root itself is the only package.
    raw.push({ pkg: rootPkg, absPath: root });
  }

  const names = new Set(raw.map((r) => r.pkg.name).filter(Boolean) as string[]);

  const packages: WorkspacePackage[] = raw.map(({ pkg, absPath }) => {
    const relPath = path.relative(root, absPath);
    const name = pkg.name ?? path.basename(absPath);
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    const internalDeps = Object.keys(allDeps).filter(
      (d) => names.has(d) && d !== name,
    );
    return {
      name,
      version: pkg.version ?? '0.0.0',
      absPath,
      relPath,
      type: classify(relPath, name),
      internalDeps,
    };
  });

  return { root, rootName: rootPkg.name ?? path.basename(root), packages };
};
