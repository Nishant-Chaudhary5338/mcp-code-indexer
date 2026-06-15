import { GraphSnapshot, type NodeKnowledge } from '@repo/code-graph-core';

export const fetchGraph = async (): Promise<GraphSnapshot> => {
  // The viewer needs the whole graph to render. `?full=1` bypasses the server's
  // token-safe default, which returns a compact summary (no nodes/edges) on large
  // repos — that default is for AI agents, not this client.
  const res = await fetch('/api/graph?full=1');
  if (!res.ok) {
    throw new Error(`Failed to load graph (${res.status})`);
  }
  const raw = (await res.json()) as unknown;
  const snapshot = GraphSnapshot.parse(raw);
  console.log(
    '[code-graph] graph loaded:',
    snapshot.nodes.length,
    'nodes,',
    snapshot.edges.length,
    'edges',
  );
  return snapshot;
};

export const postKnowledge = async (
  nodeId: string,
): Promise<NodeKnowledge | null> => {
  const res = await fetch(`/api/knowledge/${encodeURIComponent(nodeId)}`, {
    method: 'POST',
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { knowledge: NodeKnowledge | null };
  return data.knowledge;
};

export type ChatResult = {
  answer: string;
  citations: string[];
  usedLlm: boolean;
};

export const postChat = async (question: string): Promise<ChatResult> => {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
  });
  if (!res.ok) throw new Error(`Chat failed (${res.status})`);
  return (await res.json()) as ChatResult;
};

export const fetchSource = async (
  id: string,
): Promise<{ code: string; lang: string } | null> => {
  const res = await fetch(`/api/node/${encodeURIComponent(id)}/source`);
  if (!res.ok) return null;
  return (await res.json()) as { code: string; lang: string };
};

export type SemanticHit = {
  id: string;
  name: string;
  type: string;
  path: string | null;
  score: number;
};

export type SemanticSearchResult = {
  query: string;
  /** True when results came from embeddings; false when the server fell back. */
  usedEmbeddings: boolean;
  count: number;
  results: SemanticHit[];
  /** Present only on fallback — e.g. "run embed to enable semantic search". */
  hint?: string;
};

/** Find-by-meaning over the indexed graph (vector search, lexical fallback). */
export const fetchSemanticSearch = async (
  query: string,
  limit = 30,
): Promise<SemanticSearchResult> => {
  const params = new URLSearchParams({ query, limit: String(limit) });
  const res = await fetch(`/api/semantic-search?${params.toString()}`);
  if (!res.ok) throw new Error(`Semantic search failed (${res.status})`);
  return (await res.json()) as SemanticSearchResult;
};
