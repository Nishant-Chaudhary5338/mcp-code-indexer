import { describe, it, expect } from 'vitest';
import { Project } from 'ts-morph';
import { extractImportEdges, externalPackage } from './import-edges.js';
import type { GraphEdge } from '@repo/code-graph-core';

// Build an in-memory project rooted at /repo with the given files, then extract
// edges for `entry`. `opts` is forwarded to extractImportEdges (externals etc.).
const edgesFor = (
  files: Record<string, string>,
  entry: string,
  opts?: { externals?: boolean; workspacePackages?: ReadonlySet<string> },
): GraphEdge[] => {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { jsx: 4 },
  });
  for (const [name, content] of Object.entries(files)) {
    project.createSourceFile(`/repo/${name}`, content, { overwrite: true });
  }
  const sf = project.getSourceFileOrThrow(`/repo/${entry}`);
  return extractImportEdges(sf, entry, '/repo', opts);
};

describe('extractImportEdges', () => {
  it('emits an imports edge for a static import', () => {
    const edges = edgesFor(
      {
        'a.ts': `import { b } from './b';\nexport const x = b;`,
        'b.ts': `export const b = 1;`,
      },
      'a.ts',
    );
    const imp = edges.find((e) => e.type === 'imports');
    expect(imp?.target).toBe('file:b.ts');
  });

  it('emits an imports edge for a re-export barrel', () => {
    const edges = edgesFor(
      {
        'index.ts': `export { b } from './b';\nexport * from './c';`,
        'b.ts': `export const b = 1;`,
        'c.ts': `export const c = 2;`,
      },
      'index.ts',
    );
    const targets = edges
      .filter((e) => e.type === 'imports')
      .map((e) => e.target)
      .sort();
    expect(targets).toEqual(['file:b.ts', 'file:c.ts']);
  });

  it('emits an imports edge for a dynamic import()', () => {
    const edges = edgesFor(
      {
        'a.ts': `export const load = () => import('./b');`,
        'b.ts': `export const b = 1;`,
      },
      'a.ts',
    );
    const imp = edges.find((e) => e.type === 'imports');
    expect(imp?.target).toBe('file:b.ts');
  });

  it('tags type-only imports as references, not imports', () => {
    const edges = edgesFor(
      {
        'a.ts': `import type { T } from './b';\nexport const x: T = 1 as T;`,
        'b.ts': `export type T = number;`,
      },
      'a.ts',
    );
    expect(edges.find((e) => e.type === 'imports')).toBeUndefined();
    const ref = edges.find((e) => e.type === 'references');
    expect(ref?.target).toBe('file:b.ts');
  });

  it('tags type-only re-exports as references', () => {
    const edges = edgesFor(
      {
        'index.ts': `export type { T } from './b';`,
        'b.ts': `export type T = number;`,
      },
      'index.ts',
    );
    expect(edges.find((e) => e.type === 'imports')).toBeUndefined();
    expect(edges.find((e) => e.type === 'references')?.target).toBe('file:b.ts');
  });

  it('ignores node_modules and out-of-root targets', () => {
    const edges = edgesFor(
      {
        'a.ts': `import { x } from 'some-pkg';\nimport './b';`,
        'b.ts': `export const b = 1;`,
      },
      'a.ts',
    );
    // `some-pkg` is unresolved (no node_modules) -> no edge; only ./b counts.
    expect(edges.every((e) => e.target === 'file:b.ts')).toBe(true);
  });

  it('accumulates weight for repeated imports of the same module', () => {
    const edges = edgesFor(
      {
        'a.ts': `import { b } from './b';\nexport const load = () => import('./b');`,
        'b.ts': `export const b = 1;`,
      },
      'a.ts',
    );
    const imp = edges.find((e) => e.type === 'imports');
    expect(imp?.weight).toBe(2);
  });
});

describe('externalPackage', () => {
  it('extracts the package name from a bare specifier', () => {
    expect(externalPackage('react')).toBe('react');
    expect(externalPackage('react-dom/client')).toBe('react-dom');
    expect(externalPackage('@scope/pkg/sub')).toBe('@scope/pkg');
    expect(externalPackage('lodash/merge')).toBe('lodash');
  });

  it('returns null for relative imports and path aliases', () => {
    expect(externalPackage('./x')).toBeNull();
    expect(externalPackage('../x')).toBeNull();
    expect(externalPackage('@/components/X')).toBeNull(); // alias, not a scoped pkg
    expect(externalPackage('~/lib')).toBeNull();
  });
});

describe('extractImportEdges — externals', () => {
  it('emits a file→external edge for an unresolved package when externals on', () => {
    const edges = edgesFor(
      { 'a.ts': `import { useState } from 'react';\nimport './b';`, 'b.ts': `export const b = 1;` },
      'a.ts',
      { externals: true },
    );
    expect(edges.find((e) => e.target === 'ext:react')?.type).toBe('imports');
  });

  it('does NOT emit an external edge by default (externals off)', () => {
    const edges = edgesFor(
      { 'a.ts': `import 'react';` },
      'a.ts',
    );
    expect(edges.some((e) => e.target.startsWith('ext:'))).toBe(false);
  });

  it('treats a monorepo workspace package as internal, not external', () => {
    const edges = edgesFor(
      { 'a.ts': `import { Button } from '@repo/ui';` },
      'a.ts',
      { externals: true, workspacePackages: new Set(['@repo/ui']) },
    );
    // No external leaf for a sibling workspace package — it lives in the graph
    // as its own package node + a package-level depends-on edge.
    expect(edges.some((e) => e.target === 'ext:@repo/ui')).toBe(false);
  });
});
