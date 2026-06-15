import type { GraphSnapshot } from '@repo/code-graph-core';
import { repoId } from '@repo/code-graph-core';
import type { IndexerConfig } from '../config.js';
import { IndexerSession } from './session.js';
import { readSnapshot } from './incremental/cache.js';

export { IndexerSession } from './session.js';

export type IndexResult = {
  snapshot: GraphSnapshot;
  durationMs: number;
};

export const runFullIndex = (config: IndexerConfig): IndexResult => {
  const startedAt = Date.now();
  const session = new IndexerSession(config.root, config);
  const snapshot = session.indexFull();
  return { snapshot, durationMs: Date.now() - startedAt };
};

/**
 * Run an incremental index: hydrate the session with the persisted snapshot,
 * then reindex reusing unchanged files. Falls back to a full index when no
 * prior cache exists on disk.
 */
export const runIncrementalIndex = (config: IndexerConfig): IndexResult => {
  const startedAt = Date.now();
  const session = new IndexerSession(config.root, config);
  const prior = readSnapshot(config.root);
  if (!prior) {
    const snapshot = session.indexFull();
    return { snapshot, durationMs: Date.now() - startedAt };
  }
  session.hydrate(prior);
  const snapshot = session.reindexIncremental();
  return { snapshot, durationMs: Date.now() - startedAt };
};

export const repoNodeId = (rootName: string): string => repoId(rootName);
