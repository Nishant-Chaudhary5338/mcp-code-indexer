import { describe, it, expect } from 'vitest';
import type { GraphEdge } from '@repo/code-graph-core';
import { blastRadius, findCycles } from './analysis';

const imp = (source: string, target: string): GraphEdge => ({
  id: `${source}->${target}`,
  source,
  target,
  type: 'imports',
  weight: 1,
});

describe('blastRadius', () => {
  // a → b → c  (a imports b, b imports c). Breaking c impacts b and a.
  const edges = [imp('a', 'b'), imp('b', 'c'), imp('d', 'a')];

  it('finds transitive dependents of a node', () => {
    const impacted = blastRadius(edges, 'c');
    expect([...impacted].sort()).toEqual(['a', 'b', 'd']);
  });

  it('returns empty for a node nothing depends on', () => {
    expect(blastRadius(edges, 'd').size).toBe(0);
  });
});

describe('findCycles', () => {
  it('detects a simple cycle', () => {
    const cycles = findCycles([imp('a', 'b'), imp('b', 'a')]);
    expect(cycles.length).toBeGreaterThan(0);
  });

  it('reports no cycles for a DAG', () => {
    const cycles = findCycles([imp('a', 'b'), imp('b', 'c')]);
    expect(cycles).toHaveLength(0);
  });
});
