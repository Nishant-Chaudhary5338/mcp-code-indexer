import type {
  GraphNode,
  GraphEdge,
  RepoNode,
  AppNode,
  PackageNode,
} from '@repo/code-graph-core';
import {
  repoId,
  appId,
  packageId,
  edgeId,
  emptyStatus,
} from '@repo/code-graph-core';
import type { Workspace, WorkspacePackage } from '../discovery/discover-workspace.js';

export type MacroResult = { nodes: GraphNode[]; edges: GraphEdge[] };

const ownerId = (pkg: WorkspacePackage): string =>
  pkg.type === 'app' ? appId(pkg.name) : packageId(pkg.name);

const packageNode = (
  pkg: WorkspacePackage,
  rootId: string,
): AppNode | PackageNode => ({
  id: ownerId(pkg),
  type: pkg.type === 'app' ? 'app' : 'package',
  name: pkg.name,
  path: pkg.relPath,
  parentId: rootId,
  contentHash: null,
  status: emptyStatus(),
  knowledge: null,
  git: null,
  metrics: { loc: 0, exportsCount: 0 },
});

export const indexMacro = (workspace: Workspace): MacroResult => {
  const rootId = repoId(workspace.rootName);
  const nameToId = new Map<string, string>(
    workspace.packages.map((p) => [p.name, ownerId(p)]),
  );

  const repoNode: RepoNode = {
    id: rootId,
    type: 'repo',
    name: workspace.rootName,
    parentId: null,
    status: emptyStatus(),
    knowledge: null,
    git: null,
  };

  const nodes: GraphNode[] = [repoNode];
  const edges: GraphEdge[] = [];

  for (const pkg of workspace.packages) {
    const id = ownerId(pkg);
    nodes.push(packageNode(pkg, rootId));
    edges.push({
      id: edgeId(rootId, id, 'contains'),
      source: rootId,
      target: id,
      type: 'contains',
      weight: 1,
    });
    for (const dep of pkg.internalDeps) {
      const targetId = nameToId.get(dep);
      if (!targetId) continue;
      edges.push({
        id: edgeId(id, targetId, 'depends-on'),
        source: id,
        target: targetId,
        type: 'depends-on',
        weight: 1,
      });
    }
  }

  return { nodes, edges };
};
