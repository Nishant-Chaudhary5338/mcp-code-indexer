import type { EdgeType } from './edge.schema';

const normalizePath = (relPath: string): string => relPath.replace(/\\/g, '/');

export const repoId = (rootName: string): string => `repo:${rootName}`;

export const appId = (pkgName: string): string => `app:${pkgName}`;

export const packageId = (pkgName: string): string => `pkg:${pkgName}`;

export const folderId = (relPath: string): string =>
  `dir:${normalizePath(relPath)}`;

export const fileId = (relPath: string): string =>
  `file:${normalizePath(relPath)}`;

/** A third-party (node_modules) package node, e.g. `ext:react`, `ext:@scope/x`. */
export const externalId = (pkg: string): string => `ext:${pkg}`;

export const componentId = (relPath: string, exportName: string): string =>
  `cmp:${normalizePath(relPath)}#${exportName}`;

/**
 * Canonical id for a function/symbol node.
 *
 * The id must be STABLE across trivial edits (adding a blank line above a
 * function must not change its id), so it never embeds an absolute line number.
 * Names are usually unique within a file; when they are not (overloads, two
 * arrow functions assigned to the same name in different scopes), the caller
 * passes a 0-based `occurrence` index — the n-th declaration of that name in
 * source order — which only changes if a same-named sibling is added/removed,
 * not on whitespace churn.
 */
export const functionId = (
  relPath: string,
  symbol: string,
  occurrence = 0,
): string =>
  occurrence === 0
    ? `fn:${normalizePath(relPath)}#${symbol}`
    : `fn:${normalizePath(relPath)}#${symbol}~${occurrence}`;

export const edgeId = (
  source: string,
  target: string,
  type: EdgeType,
): string => `${source}->${target}:${type}`;
