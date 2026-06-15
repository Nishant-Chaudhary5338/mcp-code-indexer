import { describe, it, expect } from 'vitest';
import type { GraphNode } from './node.schema';
import type { GraphEdge, EdgeType } from './edge.schema';
import { emptyStatus } from './status.schema';
import { buildContextPack } from './context';

const cmp = (id: string, name: string): GraphNode => ({
  type: 'component',
  id,
  name,
  parentId: null,
  path: `src/${name}.tsx`,
  span: { startLine: 1, endLine: 10 },
  metrics: { loc: 10, exportsCount: 1 },
  bundleBytes: null,
  contentHash: null,
  status: emptyStatus(),
  knowledge: null,
  git: null,
});

const edge = (source: string, target: string, type: EdgeType): GraphEdge => ({
  id: `${source}->${target}:${type}`,
  source,
  target,
  type,
  weight: 1,
});

// App renders Header; Header renders Logo. Page also renders Header.
const nodes = [cmp('App', 'App'), cmp('Header', 'Header'), cmp('Logo', 'Logo'), cmp('Page', 'Page')];
const edges = [
  edge('App', 'Header', 'renders'),
  edge('Header', 'Logo', 'renders'),
  edge('Page', 'Header', 'renders'),
];

describe('buildContextPack', () => {
  it('throws for an unknown node', () => {
    expect(() => buildContextPack(nodes, edges, 'Nope')).toThrow('Node not found');
  });

  it('lists outgoing dependencies (what the target relies on)', () => {
    const pack = buildContextPack(nodes, edges, 'Header');
    expect(pack.dependencies.map((d) => d.id)).toEqual(['Logo']);
  });

  it('lists incoming dependents (the direct first hop)', () => {
    const pack = buildContextPack(nodes, edges, 'Header');
    expect(pack.dependents.map((d) => d.id).sort()).toEqual(['App', 'Page']);
  });

  it('counts the full transitive blast radius', () => {
    // Breaking Logo impacts Header, and through it App + Page.
    const pack = buildContextPack(nodes, edges, 'Logo');
    expect(pack.blastRadiusCount).toBe(3);
  });

  it('caps each list at maxRefs and flags truncation', () => {
    const pack = buildContextPack(nodes, edges, 'Header', { maxRefs: 1 });
    expect(pack.dependents).toHaveLength(1);
    expect(pack.truncated.dependents).toBe(true);
    expect(pack.truncated.dependencies).toBe(false);
  });

  it('surfaces target facts (span, health)', () => {
    const pack = buildContextPack(nodes, edges, 'App');
    expect(pack.target.span).toEqual({ startLine: 1, endLine: 10 });
    expect(pack.target.health).toBe('unknown');
  });
});
