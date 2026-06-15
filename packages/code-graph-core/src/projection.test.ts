import { describe, it, expect } from 'vitest';
import { GraphNode } from './node.schema';
import type { GraphEdge } from './edge.schema';
import type { GraphSnapshot } from './snapshot.schema';
import { emptyStatus } from './status.schema';
import {
  toLeanNode,
  summarizeSnapshot,
  projectGraph,
  type GraphSummary,
  type ProjectedGraph,
} from './projection';

const base = (id: string, name: string, parentId: string | null) => ({
  id,
  name,
  parentId,
  status: emptyStatus(),
  knowledge: null,
  git: null,
});

const repo = GraphNode.parse({ ...base('repo:r', 'r', null), type: 'repo' });
const app = GraphNode.parse({
  ...base('app:a', 'a', 'repo:r'),
  type: 'app',
  path: 'a',
  contentHash: null,
  metrics: { loc: 0, exportsCount: 0 },
});
const file = GraphNode.parse({
  ...base('file:src/App.tsx', 'App.tsx', 'app:a'),
  type: 'file',
  path: 'src/App.tsx',
  contentHash: null,
  metrics: { loc: 10, exportsCount: 1 },
});
const cmpA = GraphNode.parse({
  ...base('cmp:src/App.tsx#App', 'App', 'file:src/App.tsx'),
  type: 'component',
  path: 'src/App.tsx',
  contentHash: null,
  span: { startLine: 1, endLine: 5 },
  metrics: { loc: 5, exportsCount: 1 },
  bundleBytes: null,
});
const cmpB = GraphNode.parse({
  ...base('cmp:src/App.tsx#Inner', 'Inner', 'file:src/App.tsx'),
  type: 'component',
  path: 'src/App.tsx',
  contentHash: null,
  span: { startLine: 6, endLine: 8 },
  metrics: { loc: 3, exportsCount: 1 },
  bundleBytes: null,
});

const e = (source: string, target: string, type: GraphEdge['type']): GraphEdge => ({
  id: `${source}->${target}:${type}`,
  source,
  target,
  type,
  weight: 1,
});

const snapshot: GraphSnapshot = {
  meta: {
    root: '/repo',
    generatedAt: 0,
    commit: null,
    nodeCount: 5,
    edgeCount: 6,
    indexerVersion: '0.1.0',
  },
  nodes: [repo, app, file, cmpA, cmpB],
  edges: [
    e('repo:r', 'app:a', 'contains'),
    e('app:a', 'file:src/App.tsx', 'contains'),
    e('file:src/App.tsx', 'cmp:src/App.tsx#App', 'contains'),
    e('file:src/App.tsx', 'cmp:src/App.tsx#Inner', 'contains'),
    // A 2-cycle in dependency edges so cycleCount > 0.
    e('cmp:src/App.tsx#App', 'cmp:src/App.tsx#Inner', 'renders'),
    e('cmp:src/App.tsx#Inner', 'cmp:src/App.tsx#App', 'renders'),
  ],
};

describe('toLeanNode', () => {
  it('drops heavy annotations and keeps identity + structure', () => {
    const lean = toLeanNode(file);
    expect(lean).toEqual({
      id: 'file:src/App.tsx',
      type: 'file',
      name: 'App.tsx',
      parentId: 'app:a',
      path: 'src/App.tsx',
      metrics: { loc: 10, exportsCount: 1 },
    });
    expect('status' in lean).toBe(false);
    expect('knowledge' in lean).toBe(false);
  });

  it('omits path/metrics for the repo node', () => {
    const lean = toLeanNode(repo);
    expect(lean.path).toBeUndefined();
    expect(lean.metrics).toBeUndefined();
  });
});

describe('summarizeSnapshot', () => {
  const s = summarizeSnapshot(snapshot);
  it('counts nodes and edges by type', () => {
    expect(s.nodesByType).toEqual({ repo: 1, app: 1, file: 1, component: 2 });
    expect(s.edgesByType).toEqual({ contains: 4, renders: 2 });
  });
  it('lists the repo top-level children', () => {
    expect(s.topLevel).toEqual([{ id: 'app:a', name: 'a', type: 'app' }]);
  });
  it('reports the cycle count', () => {
    expect(s.cycleCount).toBeGreaterThan(0);
  });
});

describe('projectGraph', () => {
  it('returns a summary when summary:true', () => {
    const out = projectGraph(snapshot, { summary: true }) as GraphSummary;
    expect(out.nodeCount).toBe(5);
    expect(out.topLevel).toHaveLength(1);
  });

  it('filters by node type and keeps only edges between survivors', () => {
    const out = projectGraph(snapshot, { type: 'component' }) as ProjectedGraph;
    expect(out.nodes).toHaveLength(2);
    // Only the two renders edges connect two components; contains edges drop.
    expect(out.edges).toHaveLength(2);
    expect(out.edges.every((edge) => edge.type === 'renders')).toBe(true);
  });

  it('limits to a BFS depth from the repo root over contains edges', () => {
    const out = projectGraph(snapshot, { depth: 1 }) as ProjectedGraph;
    const ids = out.nodes.map((n) => (n as { id: string }).id).sort();
    expect(ids).toEqual(['app:a', 'repo:r']);
  });

  it('projects lean nodes when lean:true', () => {
    const out = projectGraph(snapshot, { lean: true }) as ProjectedGraph;
    expect(out.nodes.every((n) => !('status' in (n as object)))).toBe(true);
  });

  it('whitelists fields and always keeps id+type', () => {
    const out = projectGraph(snapshot, { fields: ['name'] }) as ProjectedGraph;
    const first = out.nodes[0] as Record<string, unknown>;
    expect(Object.keys(first).sort()).toEqual(['id', 'name', 'type']);
  });
});
