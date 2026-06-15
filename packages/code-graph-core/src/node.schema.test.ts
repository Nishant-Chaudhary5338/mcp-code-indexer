import { describe, it, expect } from 'vitest';
import {
  GraphNode,
  RepoNode,
  FileNode,
  ComponentNode,
  hasSpan,
  hasPath,
  hasMetrics,
  nodePath,
} from './node.schema';
import { emptyStatus } from './status.schema';

const annotations = {
  status: emptyStatus(),
  knowledge: null,
  git: null,
};

describe('GraphNode discriminated union', () => {
  it('accepts a well-formed repo node with no path/span/metrics', () => {
    const repo = {
      id: 'repo:demo',
      type: 'repo' as const,
      name: 'demo',
      parentId: null,
      ...annotations,
    };
    expect(() => GraphNode.parse(repo)).not.toThrow();
    expect(() => RepoNode.parse(repo)).not.toThrow();
  });

  it('rejects a repo node that illegally carries a span/metrics', () => {
    const illegal = {
      id: 'repo:demo',
      type: 'repo' as const,
      name: 'demo',
      parentId: null,
      span: { startLine: 1, endLine: 2 },
      metrics: { loc: 10, exportsCount: 1 },
      bundleBytes: 100,
      ...annotations,
    };
    // discriminatedUnion is strict on the repo variant: extra disallowed keys
    // for a `repo` node must not validate.
    const result = RepoNode.safeParse(illegal);
    expect(result.success).toBe(false);
  });

  it('rejects a folder/container node that carries a source span', () => {
    const illegalFolder = {
      id: 'dir:src/ui',
      type: 'folder' as const,
      name: 'ui',
      path: 'src/ui',
      parentId: 'pkg:ui',
      contentHash: null,
      metrics: { loc: 0, exportsCount: 0 },
      span: { startLine: 1, endLine: 9 },
      ...annotations,
    };
    expect(GraphNode.safeParse(illegalFolder).success).toBe(false);
  });

  it('requires a span on component/function nodes', () => {
    const missingSpan = {
      id: 'cmp:src/Button.tsx#Button',
      type: 'component' as const,
      name: 'Button',
      path: 'src/Button.tsx',
      parentId: 'file:src/Button.tsx',
      contentHash: 'abc',
      metrics: { loc: 5, exportsCount: 0 },
      bundleBytes: null,
      ...annotations,
    };
    expect(ComponentNode.safeParse(missingSpan).success).toBe(false);
  });

  it('accepts a valid file node and exposes path via helpers', () => {
    const file = {
      id: 'file:src/index.ts',
      type: 'file' as const,
      name: 'index.ts',
      path: 'src/index.ts',
      parentId: 'pkg:core',
      contentHash: 'h',
      metrics: { loc: 3, exportsCount: 2 },
      ...annotations,
    };
    const parsed = FileNode.parse(file);
    expect(hasPath(parsed)).toBe(true);
    expect(hasMetrics(parsed)).toBe(true);
    expect(hasSpan(parsed)).toBe(false);
    expect(nodePath(parsed)).toBe('src/index.ts');
  });

  it('narrows span access through hasSpan', () => {
    const component = ComponentNode.parse({
      id: 'cmp:src/Button.tsx#Button',
      type: 'component',
      name: 'Button',
      path: 'src/Button.tsx',
      parentId: 'file:src/Button.tsx',
      contentHash: 'abc',
      span: { startLine: 1, endLine: 10 },
      metrics: { loc: 10, exportsCount: 0 },
      bundleBytes: null,
      ...annotations,
    });
    const node: GraphNode = component;
    expect(hasSpan(node)).toBe(true);
    if (hasSpan(node)) {
      expect(node.span.endLine).toBe(10);
    }
  });
});
