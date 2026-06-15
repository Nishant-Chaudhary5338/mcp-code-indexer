import * as fs from 'fs';
import * as path from 'path';
import type { GraphNode } from '@repo/code-graph-core';
import { hasSpan, nodePath } from '@repo/code-graph-core';

const MAX_CHARS = 8000;

export const readNodeSource = (root: string, node: GraphNode): string => {
  const rel = nodePath(node);
  if (!rel) return '';
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return '';

  const content = fs.readFileSync(abs, 'utf-8');
  if (hasSpan(node)) {
    const lines = content.split('\n');
    const slice = lines.slice(node.span.startLine - 1, node.span.endLine);
    return slice.join('\n').slice(0, MAX_CHARS);
  }
  return content.slice(0, MAX_CHARS);
};
