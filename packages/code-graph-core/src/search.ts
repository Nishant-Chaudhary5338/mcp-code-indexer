import type { GraphNode, NodeType } from './node.schema';
import { nodePath } from './node.schema';

/**
 * A ranked search hit: a node's identity/location plus the match `score` that
 * ordered it. Higher is a better match.
 */
export interface SearchResult {
  id: string;
  name: string;
  type: NodeType;
  path: string | null;
  score: number;
}

export interface SearchOptions {
  /** Restrict results to these node types (e.g. `['component', 'function']`). */
  type?: readonly NodeType[];
  /** Maximum hits to return (default 20). */
  limit?: number;
}

const DEFAULT_LIMIT = 20;

// Score bands, highest signal first. A node is scored by the strongest signal it
// matches on (name beats path; an exact name beats a prefix beats a substring).
const SCORE = {
  exactName: 100,
  prefixName: 80,
  substringName: 60,
  subsequenceName: 40,
  substringPath: 25,
} as const;

/** Are all chars of `q` present in `text`, in order (a loose fuzzy match)? */
const isSubsequence = (q: string, text: string): boolean => {
  let i = 0;
  for (let j = 0; j < text.length && i < q.length; j++) {
    if (text[j] === q[i]) i++;
  }
  return i === q.length;
};

/** The best (highest) match score of `query` against one node, or 0 for no match. */
const scoreNode = (node: GraphNode, query: string): number => {
  const name = node.name.toLowerCase();
  if (name === query) return SCORE.exactName;
  if (name.startsWith(query)) return SCORE.prefixName;
  if (name.includes(query)) return SCORE.substringName;

  const path = (nodePath(node) ?? '').toLowerCase();
  if (path.includes(query)) return SCORE.substringPath;
  if (isSubsequence(query, name)) return SCORE.subsequenceName;
  return 0;
};

/**
 * Fuzzy-rank nodes by name (then path) against a free-text `query`. Pure over the
 * node list — no symbol table, no disk. This is the "I know roughly what it's
 * called but not its id" entry point: an agent can resolve "the auth hook" to a
 * canonical node id in one call instead of guessing ids or grepping.
 *
 * Ordering is deterministic: score desc, then shorter name, then id asc — so the
 * same query always returns the same list for a given snapshot.
 */
export const searchNodes = (
  nodes: GraphNode[],
  query: string,
  opts: SearchOptions = {},
): SearchResult[] => {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return [];

  const typeFilter = opts.type && opts.type.length > 0 ? new Set(opts.type) : null;
  const limit = opts.limit ?? DEFAULT_LIMIT;

  const hits: SearchResult[] = [];
  for (const node of nodes) {
    if (typeFilter && !typeFilter.has(node.type)) continue;
    const score = scoreNode(node, q);
    if (score === 0) continue;
    hits.push({ id: node.id, name: node.name, type: node.type, path: nodePath(node), score });
  }

  hits.sort(
    (a, b) =>
      b.score - a.score || a.name.length - b.name.length || a.id.localeCompare(b.id),
  );
  return hits.slice(0, limit);
};
