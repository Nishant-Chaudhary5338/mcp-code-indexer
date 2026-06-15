import { describe, it, expect } from 'vitest';
import type { GraphNode } from './node.schema';
import { emptyStatus } from './status.schema';
import { searchNodes } from './search';

const fn = (name: string, path: string): GraphNode => ({
  type: 'function',
  id: `fn:${path}#${name}`,
  name,
  parentId: `file:${path}`,
  path,
  span: { startLine: 1, endLine: 5 },
  metrics: { loc: 5, exportsCount: 1 },
  bundleBytes: null,
  contentHash: null,
  status: emptyStatus(),
  knowledge: null,
  git: null,
});

const cmp = (name: string, path: string): GraphNode => ({
  ...(fn(name, path) as Extract<GraphNode, { type: 'function' }>),
  type: 'component',
  id: `cmp:${path}#${name}`,
});

const nodes: GraphNode[] = [
  fn('useAuth', 'src/hooks/useAuth.ts'),
  fn('useAuthGuard', 'src/hooks/useAuthGuard.ts'),
  cmp('AuthProvider', 'src/auth/AuthProvider.tsx'),
  fn('formatDate', 'src/util/date.ts'),
];

describe('searchNodes', () => {
  it('returns nothing for an empty query', () => {
    expect(searchNodes(nodes, '   ')).toEqual([]);
  });

  it('ranks an exact name match above a prefix above a substring', () => {
    const r = searchNodes(nodes, 'useAuth');
    expect(r[0]?.name).toBe('useAuth'); // exact
    expect(r[1]?.name).toBe('useAuthGuard'); // prefix
  });

  it('is case-insensitive', () => {
    expect(searchNodes(nodes, 'AUTHPROVIDER')[0]?.name).toBe('AuthProvider');
  });

  it('matches on path when the name does not match', () => {
    const r = searchNodes(nodes, 'util');
    expect(r.map((x) => x.name)).toContain('formatDate');
  });

  it('honors the type filter', () => {
    const r = searchNodes(nodes, 'auth', { type: ['component'] });
    expect(r.every((x) => x.type === 'component')).toBe(true);
  });

  it('respects the limit', () => {
    expect(searchNodes(nodes, 'auth', { limit: 1 })).toHaveLength(1);
  });

  it('fuzzy-matches a subsequence of the name', () => {
    // u-s-A-t is a subsequence of "useAuth"
    expect(searchNodes(nodes, 'usat').some((x) => x.name === 'useAuth')).toBe(true);
  });
});
