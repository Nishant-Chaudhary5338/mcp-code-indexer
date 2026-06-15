import type { GraphNode } from '@repo/code-graph-core';
import { hasMetrics } from '@repo/code-graph-core';

const countMatches = (source: string, re: RegExp): number =>
  (source.match(re) ?? []).length;

const extractImports = (source: string): string[] => {
  const matches = source.matchAll(/from\s+['"]([^'"]+)['"]/g);
  return [...matches]
    .map((m) => m[1])
    .filter((s): s is string => s !== undefined)
    .slice(0, 6);
};

// Deterministic, zero-cost summary from code structure — used as a fallback
// when the local Claude CLI is unavailable.
export const describeNode = (node: GraphNode, source: string): string => {
  const imports = extractImports(source);
  const usesHooks = /\buse[A-Z]\w+\(/.test(source);
  const usesState = /useState|useReducer|create\(/.test(source);
  const usesEffect = /useEffect|useLayoutEffect/.test(source);
  const exportsCount = countMatches(source, /^export /gm);

  const parts: string[] = [];
  const kind = node.type === 'component' ? 'React component' : node.type;
  const loc = hasMetrics(node) ? node.metrics.loc : 0;
  parts.push(`${kind} \`${node.name}\` (${loc} LOC).`);

  if (node.type === 'component') {
    const traits: string[] = [];
    if (usesState) traits.push('manages state');
    if (usesEffect) traits.push('runs effects');
    if (usesHooks) traits.push('uses hooks');
    if (traits.length) parts.push(`It ${traits.join(', ')}.`);
  }

  if (exportsCount > 0 && node.type === 'file') {
    parts.push(`Exports ${exportsCount} symbol(s).`);
  }
  if (imports.length > 0) {
    parts.push(`Depends on: ${imports.join(', ')}.`);
  }

  return parts.join(' ');
};
