import * as fs from 'fs';
import * as path from 'path';
import type { GraphNode } from '@repo/code-graph-core';
import { hasSpan, nodePath } from '@repo/code-graph-core';

const MAX_CHARS = 8000;

/**
 * Resolve `rel` under `root` to a readable file, or null if its real path
 * leaves the root. Node paths come from the indexed repo, and on the hosted
 * demo that repo is attacker-controlled: a `..` path or a symlink such as
 * `src/env.ts -> /proc/self/environ` must never be read.
 */
const resolveInsideRoot = (root: string, rel: string): string | null => {
  try {
    const realRoot = fs.realpathSync(root);
    const real = fs.realpathSync(path.resolve(realRoot, rel));
    const inside = real === realRoot || real.startsWith(realRoot + path.sep);
    return inside && fs.statSync(real).isFile() ? real : null;
  } catch {
    return null; // missing file or dangling link
  }
};

export const readNodeSource = (root: string, node: GraphNode): string => {
  const rel = nodePath(node);
  if (!rel) return '';
  const abs = resolveInsideRoot(root, rel);
  if (!abs) return '';

  const content = fs.readFileSync(abs, 'utf-8');
  if (hasSpan(node)) {
    const lines = content.split('\n');
    const slice = lines.slice(node.span.startLine - 1, node.span.endLine);
    return slice.join('\n').slice(0, MAX_CHARS);
  }
  return content.slice(0, MAX_CHARS);
};
