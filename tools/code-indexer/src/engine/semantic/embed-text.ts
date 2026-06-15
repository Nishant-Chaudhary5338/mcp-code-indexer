import * as crypto from 'crypto';
import type { GraphNode } from '@repo/code-graph-core';
import { nodePath } from '@repo/code-graph-core';
import { readNodeSource } from '../knowledge/read-source.js';

const MAX_SOURCE_CHARS = 1200;

/** Turn a path like `src/features/auth/useAuth.ts` into readable word tokens. */
const humanizePath = (rel: string | null): string =>
  rel ? rel.replace(/[/_.-]+/g, ' ').replace(/\b(ts|tsx|js|jsx)\b/g, '').trim() : '';

/**
 * Build the text we embed for a node. We blend the strongest semantic signals —
 * what it's called, where it lives, its AI summary if present, and a bounded
 * slice of its source — so a meaning-level query ("logic that decides trustee
 * access") can match code that never contains those exact words.
 */
export const buildEmbedText = (root: string, node: GraphNode): string => {
  const parts: string[] = [`${node.type} ${node.name}`];

  const human = humanizePath(nodePath(node));
  if (human) parts.push(human);

  if (node.knowledge?.summary) parts.push(node.knowledge.summary);

  const source = readNodeSource(root, node).slice(0, MAX_SOURCE_CHARS);
  if (source) parts.push(source);

  return parts.join('\n');
};

/** A stable hash of the embed text — lets the embed pass skip unchanged nodes. */
export const embedTextHash = (text: string): string =>
  crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
