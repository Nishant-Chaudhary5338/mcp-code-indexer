import { describe, it, expect } from 'vitest';
import { applyPatch, GraphSnapshot, type GraphSnapshot as Snapshot } from './snapshot.schema';
import { emptyStatus } from './status.schema';
import type { GraphNode } from './node.schema';
import type { GraphEdge } from './edge.schema';

const node = (id: string, typeErrors = 0): GraphNode => ({
  id,
  type: 'file',
  name: id,
  path: `${id}.ts`,
  parentId: null,
  contentHash: 'h',
  status: { ...emptyStatus(), typeErrors },
  knowledge: null,
  git: null,
  metrics: { loc: 1, exportsCount: 0 },
});

const edge = (id: string, source: string, target: string): GraphEdge => ({
  id,
  source,
  target,
  type: 'imports',
  weight: 1,
});

const baseSnapshot = (): Snapshot => ({
  meta: {
    root: '/repo',
    generatedAt: 1,
    commit: null,
    nodeCount: 2,
    edgeCount: 1,
    indexerVersion: '0.0.0',
  },
  nodes: [node('a'), node('b')],
  edges: [edge('a->b', 'a', 'b')],
});

describe('applyPatch', () => {
  it('upserts a changed node in place rather than duplicating', () => {
    const result = applyPatch(baseSnapshot(), {
      upsertNodes: [node('a', 3)],
      removeNodeIds: [],
      upsertEdges: [],
      removeEdgeIds: [],
      meta: {},
    });
    const a = result.nodes.filter((n) => n.id === 'a');
    expect(a).toHaveLength(1);
    expect(a[0]?.status.typeErrors).toBe(3);
    expect(result.meta.nodeCount).toBe(2);
  });

  it('removes nodes and recomputes counts', () => {
    const result = applyPatch(baseSnapshot(), {
      upsertNodes: [],
      removeNodeIds: ['b'],
      upsertEdges: [],
      removeEdgeIds: ['a->b'],
      meta: {},
    });
    expect(result.nodes.map((n) => n.id)).toEqual(['a']);
    expect(result.edges).toHaveLength(0);
    expect(result.meta.nodeCount).toBe(1);
    expect(result.meta.edgeCount).toBe(0);
  });

  it('produces a snapshot that still validates against the schema', () => {
    const result = applyPatch(baseSnapshot(), {
      upsertNodes: [node('c')],
      removeNodeIds: [],
      upsertEdges: [edge('b->c', 'b', 'c')],
      removeEdgeIds: [],
      meta: {},
    });
    expect(() => GraphSnapshot.parse(result)).not.toThrow();
  });
});
