import type { GraphNode, GraphSnapshot, NodeType } from '@repo/code-graph-core';
import { rankBySimilarity, searchNodes, nodePath } from '@repo/code-graph-core';
import { embedQuery, EMBED_MODEL } from './embedder.js';
import { readEmbeddingStore, toVectorEntries } from './store.js';

export interface SemanticHitResult {
  id: string;
  name: string;
  type: NodeType;
  path: string | null;
  score: number;
}

export interface SemanticSearchResult {
  query: string;
  /** True when results came from vector similarity; false when we fell back. */
  usedEmbeddings: boolean;
  count: number;
  results: SemanticHitResult[];
  /** Present only on fallback — tells the caller how to enable real semantics. */
  hint?: string;
}

export interface SemanticSearchOptions {
  limit?: number;
  type?: readonly NodeType[];
}

const DEFAULT_LIMIT = 20;

/** Lexical fallback shaped as a semantic result, with a hint on how to upgrade. */
const fallback = (
  snapshot: GraphSnapshot,
  query: string,
  opts: SemanticSearchOptions,
  hint: string,
): SemanticSearchResult => {
  const lex = searchNodes(snapshot.nodes, query, {
    type: opts.type,
    limit: opts.limit ?? DEFAULT_LIMIT,
  });
  return {
    query,
    usedEmbeddings: false,
    count: lex.length,
    results: lex.map((r) => ({ id: r.id, name: r.name, type: r.type, path: r.path, score: r.score })),
    hint,
  };
};

/**
 * "Find by meaning" over the snapshot. Embeds the query with the local model and
 * ranks stored node vectors by cosine similarity. Degrades gracefully: if no
 * vectors are stored (run `embed` first) or the model can't load, it returns the
 * lexical {@link searchNodes} result flagged `usedEmbeddings: false` + a hint.
 */
export const semanticSearch = async (
  root: string,
  snapshot: GraphSnapshot,
  query: string,
  opts: SemanticSearchOptions = {},
): Promise<SemanticSearchResult> => {
  const store = readEmbeddingStore(root);
  if (!store || Object.keys(store.entries).length === 0) {
    return fallback(snapshot, query, opts, 'No embeddings found — run `embed` (or build_embeddings) to enable semantic search.');
  }

  const queryVec = await embedQuery(query);
  if (!queryVec) {
    return fallback(snapshot, query, opts, `Embedding model (${EMBED_MODEL}) unavailable — returned lexical matches instead.`);
  }

  const byId = new Map<string, GraphNode>(snapshot.nodes.map((n) => [n.id, n] as const));
  const typeFilter = opts.type && opts.type.length > 0 ? new Set(opts.type) : null;

  // Rank wide, then enrich + apply the type filter, then cap — so the type filter
  // doesn't get starved by an early limit.
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const ranked = rankBySimilarity(queryVec, toVectorEntries(store), limit * 4);

  const results: SemanticHitResult[] = [];
  for (const hit of ranked) {
    const node = byId.get(hit.id);
    if (!node) continue; // node removed since last embed; sidecar is stale for it
    if (typeFilter && !typeFilter.has(node.type)) continue;
    results.push({ id: node.id, name: node.name, type: node.type, path: nodePath(node), score: hit.score });
    if (results.length >= limit) break;
  }

  return { query, usedEmbeddings: true, count: results.length, results };
};
