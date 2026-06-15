import { describe, it, expect } from 'vitest';
import type { GraphSnapshot, GraphNode, GraphEdge } from '@repo/code-graph-core';
import { emptyStatus } from '@repo/code-graph-core';
import { buildIndex, visibleGraph, pathToRoot, rootId } from './graph-model';

// Synthetic nodes for graph-topology tests — only id/type/parentId are read by
// the functions under test, so we cast past the per-variant discriminated union.
const n = (id: string, type: GraphNode['type'], parentId: string | null): GraphNode =>
  ({
    id,
    type,
    name: id,
    path: null,
    parentId,
    span: null,
    contentHash: null,
    status: emptyStatus(),
    knowledge: null,
    git: null,
    bundleBytes: null,
    metrics: { loc: 1, exportsCount: 0 },
  }) as unknown as GraphNode;

const contains = (source: string, target: string): GraphEdge => ({
  id: `${source}->${target}:contains`,
  source,
  target,
  type: 'contains',
  weight: 1,
});

const imports = (source: string, target: string): GraphEdge => ({
  id: `${source}->${target}:imports`,
  source,
  target,
  type: 'imports',
  weight: 1,
});

const snapshot: GraphSnapshot = {
  meta: {
    root: '/r',
    generatedAt: 1,
    commit: null,
    nodeCount: 5,
    edgeCount: 4,
    indexerVersion: '0.1.0',
  },
  nodes: [
    n('repo:r', 'repo', null),
    n('app:a', 'app', 'repo:r'),
    n('pkg:b', 'package', 'repo:r'),
    n('file:a/x.ts', 'file', 'app:a'),
    n('file:a/y.ts', 'file', 'app:a'),
  ],
  edges: [
    contains('repo:r', 'app:a'),
    contains('repo:r', 'pkg:b'),
    contains('app:a', 'file:a/x.ts'),
    contains('app:a', 'file:a/y.ts'),
    imports('file:a/x.ts', 'file:a/y.ts'),
  ],
};

describe('visibleGraph drill-down', () => {
  const index = buildIndex(snapshot);

  it('shows top-level apps and packages at repo focus', () => {
    const view = visibleGraph(index, 'repo:r');
    expect(view.nodes.map((x) => x.id).sort()).toEqual(['app:a', 'pkg:b']);
    expect(view.expandable.has('app:a')).toBe(true);
    expect(view.expandable.has('pkg:b')).toBe(false);
  });

  it('reveals files and their import edges when drilled into an app', () => {
    const view = visibleGraph(index, 'app:a');
    expect(view.nodes).toHaveLength(2);
    expect(view.links).toHaveLength(1);
    expect(view.links[0]?.type).toBe('imports');
  });

  it('builds a breadcrumb path from root to a focused node', () => {
    const path = pathToRoot(index, 'app:a').map((x) => x.id);
    expect(path).toEqual(['repo:r', 'app:a']);
  });

  it('finds the repo root id', () => {
    expect(rootId(snapshot)).toBe('repo:r');
  });
});
