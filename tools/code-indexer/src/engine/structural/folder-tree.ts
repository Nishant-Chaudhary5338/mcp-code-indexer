import * as path from 'path';
import type { GraphNode, GraphEdge, FolderNode } from '@repo/code-graph-core';
import { folderId, edgeId, emptyStatus } from '@repo/code-graph-core';

const folderNode = (
  id: string,
  name: string,
  relPath: string,
  parentId: string,
): FolderNode => ({
  id,
  type: 'folder',
  name,
  path: relPath,
  parentId,
  contentHash: null,
  status: emptyStatus(),
  knowledge: null,
  git: null,
  metrics: { loc: 0, exportsCount: 0 },
});

// Ensures folder nodes exist for every directory between the package root and
// the file, chaining `contains` edges. Returns the file's immediate parent id.
export const ensureFolderChain = (
  pkgRelPath: string,
  fileRel: string,
  ownerId: string,
  folders: Map<string, GraphNode>,
  edges: GraphEdge[],
): string => {
  const within = pkgRelPath ? fileRel.slice(pkgRelPath.length + 1) : fileRel;
  const dir = path.dirname(within);
  if (dir === '.' || dir === '') return ownerId;

  let parentId = ownerId;
  let accPath = pkgRelPath;
  for (const segment of dir.split('/')) {
    accPath = accPath ? `${accPath}/${segment}` : segment;
    const id = folderId(accPath);
    if (!folders.has(id)) {
      folders.set(id, folderNode(id, segment, accPath, parentId));
      edges.push({
        id: edgeId(parentId, id, 'contains'),
        source: parentId,
        target: id,
        type: 'contains',
        weight: 1,
      });
    }
    parentId = id;
  }
  return parentId;
};
