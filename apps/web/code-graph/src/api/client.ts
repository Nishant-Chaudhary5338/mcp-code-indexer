import { GraphSnapshot, type NodeKnowledge } from '@repo/code-graph-core';

/**
 * The repo every API call targets. Set by the store when a repo is opened so the
 * existing call sites don't each need a repo argument threaded through them.
 */
let activeRepoId: string | null = null;
export const setActiveRepo = (id: string | null): void => {
  activeRepoId = id;
};

/** Build an `/api/...` URL with the active `repo` query param folded in. */
const apiUrl = (path: string, extra: Record<string, string> = {}): string => {
  const params = new URLSearchParams(extra);
  if (activeRepoId) params.set('repo', activeRepoId);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
};

/** A repo as the server's `/api/repos` endpoints describe it. */
export type RepoSummary = {
  id: string;
  label: string;
  origin: 'live' | 'curated' | 'github';
  status: 'cloning' | 'indexing' | 'ready' | 'error';
  nodeCount: number | null;
  edgeCount: number | null;
  error: string | null;
};

export const fetchRepos = async (): Promise<{
  repos: RepoSummary[];
  defaultId: string | null;
}> => {
  const res = await fetch('/api/repos');
  if (!res.ok) throw new Error(`Failed to load repos (${res.status})`);
  return (await res.json()) as { repos: RepoSummary[]; defaultId: string | null };
};

/** Kick off a clone + index for a public GitHub repo. */
export const loadGithubRepo = async (
  url: string,
): Promise<{ id: string; label: string; status: RepoSummary['status'] }> => {
  const res = await fetch('/api/repos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  const data = (await res.json()) as
    | { id: string; label: string; status: RepoSummary['status'] }
    | { error: string };
  if (!res.ok || 'error' in data) {
    throw new Error('error' in data ? data.error : `Load failed (${res.status})`);
  }
  return data;
};

export const fetchRepoStatus = async (id: string): Promise<RepoSummary> => {
  const res = await fetch(`/api/repos/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Repo status failed (${res.status})`);
  return (await res.json()) as RepoSummary;
};

export const fetchGraph = async (): Promise<GraphSnapshot> => {
  // The viewer needs the whole graph to render. `?full=1` bypasses the server's
  // token-safe default, which returns a compact summary (no nodes/edges) on large
  // repos — that default is for AI agents, not this client.
  const res = await fetch(apiUrl('/api/graph', { full: '1' }));
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
  const res = await fetch(apiUrl(`/api/knowledge/${encodeURIComponent(nodeId)}`), {
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

export const postChat = async (
  question: string,
  apiKey?: string,
): Promise<ChatResult> => {
  const res = await fetch(apiUrl('/api/chat'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // apiKey (bring-your-own) is sent for this request only; never persisted server-side.
    body: JSON.stringify(apiKey ? { question, apiKey } : { question }),
  });
  if (!res.ok) throw new Error(`Chat failed (${res.status})`);
  return (await res.json()) as ChatResult;
};

export const fetchSource = async (
  id: string,
): Promise<{ code: string; lang: string } | null> => {
  const res = await fetch(apiUrl(`/api/node/${encodeURIComponent(id)}/source`));
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
  const res = await fetch(apiUrl('/api/semantic-search', { query, limit: String(limit) }));
  if (!res.ok) throw new Error(`Semantic search failed (${res.status})`);
  return (await res.json()) as SemanticSearchResult;
};
