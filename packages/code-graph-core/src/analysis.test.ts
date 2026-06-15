import { describe, it, expect } from 'vitest';
import type { GraphEdge, EdgeType } from './edge.schema';
import type { GraphNode } from './node.schema';
import { emptyStatus as emptyStatusForTest } from './status.schema';
import {
  blastRadius,
  findCycles,
  whoRenders,
  whoCalls,
  findReferences,
  findOrphans,
  buildReverseIndex,
  buildForwardIndex,
  DEPENDENCY_TYPES,
} from './analysis';

const edge = (
  source: string,
  target: string,
  type: EdgeType = 'imports',
): GraphEdge => ({ id: `${source}->${target}:${type}`, source, target, type, weight: 1 });

describe('blastRadius', () => {
  // a → b → c (a imports b, b imports c). Breaking c impacts b and a; d imports a.
  const edges = [edge('a', 'b'), edge('b', 'c'), edge('d', 'a')];

  it('finds transitive dependents of a node', () => {
    expect([...blastRadius(edges, 'c')].sort()).toEqual(['a', 'b', 'd']);
  });

  it('returns empty for a node nothing depends on', () => {
    expect(blastRadius(edges, 'd').size).toBe(0);
  });

  it('ignores contains edges (structure is not a dependency)', () => {
    const withContains = [...edges, edge('folder', 'c', 'contains')];
    expect(blastRadius(withContains, 'c').has('folder')).toBe(false);
  });
});

describe('findCycles', () => {
  it('detects a simple cycle', () => {
    expect(findCycles([edge('a', 'b'), edge('b', 'a')]).length).toBeGreaterThan(0);
  });

  it('reports no cycles for a DAG', () => {
    expect(findCycles([edge('a', 'b'), edge('b', 'c')])).toHaveLength(0);
  });
});

describe('reverse-lookup queries', () => {
  const edges = [
    edge('cmp:App#App', 'cmp:Header#Header', 'renders'),
    edge('cmp:Page#Page', 'cmp:Header#Header', 'renders'),
    edge('fn:a#a', 'fn:util#util', 'calls'),
    edge('cmp:App#App', 'fn:util#util', 'calls'),
    edge('file:App', 'file:Header', 'imports'),
  ];

  it('whoRenders returns the incoming renders edges', () => {
    const r = whoRenders(edges, 'cmp:Header#Header');
    expect(r.map((e) => e.source).sort()).toEqual(['cmp:App#App', 'cmp:Page#Page']);
    expect(r.every((e) => e.type === 'renders')).toBe(true);
  });

  it('whoCalls returns the incoming calls edges', () => {
    const c = whoCalls(edges, 'fn:util#util');
    expect(c.map((e) => e.source).sort()).toEqual(['cmp:App#App', 'fn:a#a']);
  });

  it('findReferences defaults to all dependency types', () => {
    const refs = findReferences(edges, 'cmp:Header#Header');
    expect(refs).toHaveLength(2); // both renders edges
  });

  it('findReferences honors an explicit type filter', () => {
    const onlyCalls = findReferences(edges, 'fn:util#util', new Set<EdgeType>(['calls']));
    expect(onlyCalls).toHaveLength(2);
    const onlyRenders = findReferences(edges, 'fn:util#util', new Set<EdgeType>(['renders']));
    expect(onlyRenders).toHaveLength(0);
  });

  it('returns empty for a node with no incoming edges', () => {
    expect(whoRenders(edges, 'cmp:App#App')).toHaveLength(0);
  });
});

describe('index builders', () => {
  const edges = [edge('a', 'b', 'renders'), edge('c', 'b', 'calls'), edge('a', 'd', 'imports')];

  it('buildReverseIndex groups by target', () => {
    const rev = buildReverseIndex(edges);
    expect(rev.get('b')?.map((e) => e.source).sort()).toEqual(['a', 'c']);
  });

  it('buildReverseIndex filters by type set', () => {
    const rev = buildReverseIndex(edges, new Set<EdgeType>(['renders']));
    expect(rev.get('b')?.map((e) => e.source)).toEqual(['a']);
  });

  it('buildForwardIndex groups by source', () => {
    const fwd = buildForwardIndex(edges);
    expect(fwd.get('a')?.map((e) => e.target).sort()).toEqual(['b', 'd']);
  });
});

describe('DEPENDENCY_TYPES', () => {
  it('excludes contains', () => {
    expect(DEPENDENCY_TYPES.has('contains')).toBe(false);
    expect(DEPENDENCY_TYPES.has('imports')).toBe(true);
    expect(DEPENDENCY_TYPES.has('renders')).toBe(true);
  });
});

describe('findOrphans', () => {
  const node = (id: string, type: 'file' | 'component' | 'function', path: string): GraphNode => ({
    type,
    id,
    name: id,
    parentId: null,
    path,
    ...(type === 'file'
      ? { metrics: { loc: 1, exportsCount: 1 } }
      : { span: { startLine: 1, endLine: 2 }, metrics: { loc: 1, exportsCount: 1 }, bundleBytes: null, signature: null }),
    contentHash: null,
    status: emptyStatusForTest(),
    knowledge: null,
    git: null,
  });

  // Header is rendered by App; Unused is rendered by nobody.
  const nodes = [
    node('cmp:App', 'component', 'src/App.tsx'),
    node('cmp:Header', 'component', 'src/Header.tsx'),
    node('cmp:Unused', 'component', 'src/Unused.tsx'),
    node('file:src/index.ts', 'file', 'src/index.ts'),
  ];
  const edges = [edge('cmp:App', 'cmp:Header', 'renders')];

  it('flags a component nothing renders/calls/imports', () => {
    const ids = findOrphans(nodes, edges).map((o) => o.id);
    expect(ids).toContain('cmp:Unused');
  });

  it('does not flag a referenced node', () => {
    expect(findOrphans(nodes, edges).map((o) => o.id)).not.toContain('cmp:Header');
  });

  it('excludes entry-point files (index/App) by default', () => {
    const ids = findOrphans(nodes, edges).map((o) => o.id);
    expect(ids).not.toContain('file:src/index.ts');
    expect(ids).not.toContain('cmp:App'); // App.tsx matches the entry pattern
  });

  it('includes entry points when asked', () => {
    const ids = findOrphans(nodes, edges, { includeEntryPoints: true }).map((o) => o.id);
    expect(ids).toContain('file:src/index.ts');
  });
});
