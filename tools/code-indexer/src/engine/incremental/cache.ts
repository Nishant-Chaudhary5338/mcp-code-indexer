import * as fs from 'fs';
import * as path from 'path';
import { GraphSnapshot, nodePath } from '@repo/code-graph-core';

const CACHE_DIR = '.code-graph';
const GRAPH_FILE = 'graph.json';
const HASH_FILE = 'hashes.json';

export const cacheDir = (root: string): string => path.join(root, CACHE_DIR);

export const graphPath = (root: string): string =>
  path.join(cacheDir(root), GRAPH_FILE);

export const hashPath = (root: string): string =>
  path.join(cacheDir(root), HASH_FILE);

/** Sidecar mapping of source relPath -> content hash, persisted next to the
 * graph so a reindex can skip structural re-extraction for unchanged files. */
export type HashIndex = Record<string, string>;

export const writeSnapshot = (root: string, snapshot: GraphSnapshot): string => {
  const dir = cacheDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const target = graphPath(root);
  fs.writeFileSync(target, JSON.stringify(snapshot, null, 2), 'utf-8');
  writeHashIndex(root, deriveHashIndex(snapshot));
  return target;
};

export const readSnapshot = (root: string): GraphSnapshot | null => {
  const target = graphPath(root);
  if (!fs.existsSync(target)) return null;
  const raw = JSON.parse(fs.readFileSync(target, 'utf-8')) as unknown;
  return GraphSnapshot.parse(raw);
};

/**
 * Derive the per-file hash index from a snapshot by reading the contentHash of
 * each `file` node. This is the source of truth for incremental skip decisions.
 */
export const deriveHashIndex = (snapshot: GraphSnapshot): HashIndex => {
  const index: HashIndex = {};
  for (const node of snapshot.nodes) {
    if (node.type !== 'file') continue;
    const rel = nodePath(node);
    if (rel && node.contentHash) index[rel] = node.contentHash;
  }
  return index;
};

export const writeHashIndex = (root: string, index: HashIndex): void => {
  const dir = cacheDir(root);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(hashPath(root), JSON.stringify(index, null, 2), 'utf-8');
};

export const readHashIndex = (root: string): HashIndex | null => {
  const target = hashPath(root);
  if (fs.existsSync(target)) {
    try {
      return JSON.parse(fs.readFileSync(target, 'utf-8')) as HashIndex;
    } catch {
      // Corrupt sidecar — fall through to deriving from the graph.
    }
  }
  // Back-compat: older caches had no sidecar; derive it from the graph.
  const snapshot = readSnapshot(root);
  return snapshot ? deriveHashIndex(snapshot) : null;
};
