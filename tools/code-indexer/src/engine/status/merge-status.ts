import type {
  GraphSnapshot,
  GraphNode,
  HealthLevel,
} from '@repo/code-graph-core';
import { deriveHealth } from '@repo/code-graph-core';
import type { FileTypeStatus } from './typecheck-runner.js';

const RANK: Record<HealthLevel, number> = {
  error: 3,
  warn: 2,
  ok: 1,
  unknown: 0,
};

const worst = (a: HealthLevel, b: HealthLevel): HealthLevel =>
  RANK[a] >= RANK[b] ? a : b;

type ContainsIndex = {
  childrenOf: Map<string, GraphNode[]>;
  byId: Map<string, GraphNode>;
};

const buildContainsIndex = (snapshot: GraphSnapshot): ContainsIndex => {
  const byId = new Map<string, GraphNode>();
  const childrenOf = new Map<string, GraphNode[]>();
  for (const node of snapshot.nodes) byId.set(node.id, node);
  for (const edge of snapshot.edges) {
    if (edge.type !== 'contains') continue;
    const child = byId.get(edge.target);
    if (!child) continue;
    const list = childrenOf.get(edge.source) ?? [];
    list.push(child);
    childrenOf.set(edge.source, list);
  }
  return { childrenOf, byId };
};

const rollupHealth = (
  node: GraphNode,
  index: ContainsIndex,
  changed: Set<string>,
): HealthLevel => {
  const children = index.childrenOf.get(node.id) ?? [];
  if (children.length === 0) return node.status.health;

  let health: HealthLevel = 'unknown';
  for (const child of children) {
    health = worst(health, rollupHealth(child, index, changed));
  }
  if (node.status.health !== health) {
    node.status.health = health;
    changed.add(node.id);
  }
  return health;
};

export type CheckedPackage = { ownerId: string; relPath: string };

export const mergePackageStatus = (
  snapshot: GraphSnapshot,
  pkg: CheckedPackage,
  fileStatus: Map<string, FileTypeStatus>,
): GraphNode[] => {
  const index = buildContainsIndex(snapshot);
  const changed = new Set<string>();
  const belongs = (filePath: string): boolean =>
    pkg.relPath === '' || filePath.startsWith(`${pkg.relPath}/`);

  for (const node of snapshot.nodes) {
    if (node.type !== 'file' || !node.path) continue;
    if (!belongs(node.path)) continue;

    const fileResult = fileStatus.get(node.path);
    const typeErrors = fileResult?.typeErrors ?? 0;
    node.status.typeErrors = typeErrors;
    // tsc --noEmit success is our proxy for "compiles" — gives clean files a
    // positive signal so they derive to `ok` (green) rather than `unknown`.
    node.status.buildOk = typeErrors === 0;
    node.status.health = deriveHealth(node.status);
    changed.add(node.id);

    for (const child of index.childrenOf.get(node.id) ?? []) {
      child.status.health = node.status.health;
      changed.add(child.id);
    }
  }

  for (const node of snapshot.nodes) {
    if (node.type === 'repo' || node.type === 'app' || node.type === 'package') {
      rollupHealth(node, index, changed);
    }
  }

  return snapshot.nodes.filter((n) => changed.has(n.id));
};
