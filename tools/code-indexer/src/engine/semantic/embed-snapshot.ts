import type { GraphNode, GraphSnapshot } from '@repo/code-graph-core';
import { isEmbeddable } from '@repo/code-graph-core';
import { writeSnapshot } from '../incremental/cache.js';
import { buildEmbedText, embedTextHash } from './embed-text.js';
import { embedTexts, EMBED_MODEL, EMBED_DIM } from './embedder.js';
import {
  readEmbeddingStore,
  writeEmbeddingStore,
  type EmbeddingStore,
} from './store.js';

export interface EmbedResult {
  available: boolean;
  embedded: number;
  skipped: number;
  total: number;
  model: string;
}

const unavailable = (total: number): EmbedResult => ({
  available: false,
  embedded: 0,
  skipped: 0,
  total,
  model: EMBED_MODEL,
});

/**
 * Compute (or refresh) embeddings for every embeddable node in a snapshot and
 * persist them to the sidecar. **Incremental**: a node whose embed-text hash is
 * unchanged keeps its existing vector and is skipped; entries for nodes that no
 * longer exist are pruned. Sets `node.embeddingId = node.id` on embedded nodes
 * and rewrites `graph.json` so the slot reflects what's stored.
 *
 * Returns `available: false` (a no-op) when the local model can't load, so the
 * caller falls back to lexical search.
 */
export const embedSnapshot = async (
  root: string,
  snapshot: GraphSnapshot,
  onProgress?: (done: number, total: number) => void,
): Promise<EmbedResult> => {
  const targets = snapshot.nodes.filter(isEmbeddable);

  const prior = readEmbeddingStore(root);
  const priorEntries =
    prior && prior.model === EMBED_MODEL ? prior.entries : {};

  // Decide per node: reuse the stored vector (hash match) or re-embed.
  const texts: { node: GraphNode; text: string; hash: string }[] = [];
  const reused: EmbeddingStore['entries'] = {};
  for (const node of targets) {
    const text = buildEmbedText(root, node);
    const hash = embedTextHash(text);
    const existing = priorEntries[node.id];
    if (existing && existing.hash === hash) reused[node.id] = existing;
    else texts.push({ node, text, hash });
  }

  let freshVecs: number[][] | null = [];
  if (texts.length > 0) {
    freshVecs = await embedTexts(texts.map((t) => t.text), onProgress);
    if (freshVecs === null) return unavailable(targets.length);
  }

  const entries: EmbeddingStore['entries'] = { ...reused };
  texts.forEach((t, i) => {
    const vec = freshVecs?.[i];
    if (vec) entries[t.node.id] = { vec, hash: t.hash };
  });

  writeEmbeddingStore(root, { model: EMBED_MODEL, dim: EMBED_DIM, entries });

  // The sidecar (keyed by node id) is the source of truth for which nodes are
  // embedded. Where a node also has an AI knowledge record, wire its previously
  // unused `embeddingId` slot to point at the stored vector (its own id), so the
  // graph itself records the cross-reference. Rewrite only if something changed.
  const embeddedIds = new Set(Object.keys(entries));
  let changed = false;
  for (const node of snapshot.nodes) {
    if (!node.knowledge) continue;
    const next = embeddedIds.has(node.id) ? node.id : null;
    if (node.knowledge.embeddingId !== next) {
      node.knowledge.embeddingId = next;
      changed = true;
    }
  }
  if (changed) writeSnapshot(snapshot.meta.root, snapshot);

  return {
    available: true,
    embedded: texts.length,
    skipped: Object.keys(reused).length,
    total: targets.length,
    model: EMBED_MODEL,
  };
};
