import * as fs from 'fs';
import * as path from 'path';
import type { VectorEntry } from '@repo/code-graph-core';
import { cacheDir } from '../incremental/cache.js';

const EMBED_FILE = 'embeddings.json';

/**
 * The on-disk vector store, a sidecar next to `graph.json`. Records the model
 * and dimension that produced it (so a model change invalidates cleanly) and one
 * entry per embedded node, keyed by node id.
 */
export interface EmbeddingStore {
  model: string;
  dim: number;
  entries: Record<string, { vec: number[]; hash: string }>;
}

export const embedStorePath = (root: string): string =>
  path.join(cacheDir(root), EMBED_FILE);

export const readEmbeddingStore = (root: string): EmbeddingStore | null => {
  const target = embedStorePath(root);
  if (!fs.existsSync(target)) return null;
  try {
    return JSON.parse(fs.readFileSync(target, 'utf-8')) as EmbeddingStore;
  } catch {
    return null; // corrupt sidecar — treat as absent
  }
};

export const writeEmbeddingStore = (root: string, store: EmbeddingStore): void => {
  fs.mkdirSync(cacheDir(root), { recursive: true });
  fs.writeFileSync(embedStorePath(root), JSON.stringify(store), 'utf-8');
};

/** Flatten a store's entries into the {@link VectorEntry}[] the ranker consumes. */
export const toVectorEntries = (store: EmbeddingStore): VectorEntry[] =>
  Object.entries(store.entries).map(([id, e]) => ({ id, vec: e.vec, hash: e.hash }));
