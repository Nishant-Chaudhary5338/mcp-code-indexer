import type { GraphNode, NodeType } from './node.schema';

/**
 * Pure vector math for semantic search. The model that produces the vectors and
 * the on-disk store that holds them are engine concerns (they need a heavy,
 * optional ML dependency + the filesystem); this leaf stays dependency-free so
 * the contract package can rank a query against stored vectors anywhere.
 */

/**
 * Cosine similarity of two equal-length vectors, in [-1, 1]. Returns 0 for a
 * length mismatch or a zero vector (no orientation to compare).
 */
export const cosineSimilarity = (a: number[], b: number[]): number => {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    magA += x * x;
    magB += y * y;
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
};

/** A node's stored embedding: its id, the vector, and a hash of the embedded text. */
export interface VectorEntry {
  id: string;
  vec: number[];
  hash: string;
}

export interface SemanticHit {
  id: string;
  score: number;
}

/**
 * Rank stored vectors by cosine similarity to `queryVec`, highest first, capped
 * to `limit`. Below `minScore` (default 0) entries are dropped. Deterministic:
 * ties break by id so the same query yields the same order.
 */
export const rankBySimilarity = (
  queryVec: number[],
  entries: VectorEntry[],
  limit = 20,
  minScore = 0,
): SemanticHit[] => {
  const hits: SemanticHit[] = [];
  for (const entry of entries) {
    const score = cosineSimilarity(queryVec, entry.vec);
    if (score > minScore) hits.push({ id: entry.id, score });
  }
  hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return hits.slice(0, limit);
};

/** Node kinds worth embedding — the ones a "find by meaning" query targets. */
export const EMBEDDABLE_TYPES: ReadonlySet<NodeType> = new Set<NodeType>([
  'file',
  'component',
  'function',
]);

/** Whether a node is a candidate for embedding (a retrievable code unit). */
export const isEmbeddable = (node: GraphNode): boolean =>
  EMBEDDABLE_TYPES.has(node.type);
