import { z } from 'zod';
import { NodeStatus } from './status.schema';
import { NodeKnowledge, GitMeta } from './knowledge.schema';

export const NodeType = z.enum([
  'repo',
  'app',
  'package',
  'folder',
  'file',
  'component',
  'function',
  'external',
]);
export type NodeType = z.infer<typeof NodeType>;

export const SourceSpan = z.object({
  startLine: z.number().int().nonnegative(),
  endLine: z.number().int().nonnegative(),
});
export type SourceSpan = z.infer<typeof SourceSpan>;

export const NodeMetrics = z.object({
  loc: z.number().int().nonnegative(),
  exportsCount: z.number().int().nonnegative(),
});
export type NodeMetrics = z.infer<typeof NodeMetrics>;

// Fields shared by every node kind. Annotations (status/knowledge/git) live on
// every node because the status/knowledge passes roll up the whole tree.
const baseFields = {
  id: z.string(),
  name: z.string(),
  parentId: z.string().nullable(),
  status: NodeStatus,
  knowledge: NodeKnowledge.nullable(),
  git: GitMeta.nullable(),
};

// `contentHash` is only meaningful for nodes backed by a file on disk; it drives
// incremental skip decisions, so it lives on file-system-backed kinds only.
const hashableFields = {
  ...baseFields,
  contentHash: z.string().nullable(),
};

// The repo root is synthetic: no path on disk, no source span, no LOC metrics.
// `.strict()` is what makes the union reject illegal states — a repo node that
// smuggles in a `span`/`metrics`/`bundleBytes` fails validation rather than
// having the extra keys silently stripped.
export const RepoNode = z
  .object({
    ...baseFields,
    type: z.literal('repo'),
    parentId: z.null(),
  })
  .strict();
export type RepoNode = z.infer<typeof RepoNode>;

// Workspace containers (apps/packages/folders) map to a directory: they carry a
// path and aggregate metrics, but never a source span or bundle size.
const ContainerNode = (type: 'app' | 'package' | 'folder') =>
  z
    .object({
      ...hashableFields,
      type: z.literal(type),
      path: z.string(),
      metrics: NodeMetrics,
    })
    .strict();

export const AppNode = ContainerNode('app');
export type AppNode = z.infer<typeof AppNode>;

export const PackageNode = ContainerNode('package');
export type PackageNode = z.infer<typeof PackageNode>;

export const FolderNode = ContainerNode('folder');
export type FolderNode = z.infer<typeof FolderNode>;

// A source file: backed by a path + content hash, carries metrics, but a file
// itself has no single source span and no per-symbol bundle attribution.
export const FileNode = z
  .object({
    ...hashableFields,
    type: z.literal('file'),
    path: z.string(),
    metrics: NodeMetrics,
  })
  .strict();
export type FileNode = z.infer<typeof FileNode>;

// Symbol-level nodes (components/functions) always have a span and may carry a
// per-symbol bundle-size attribution. `signature` is the concise written contract
// — a function's `(params) => ret`, or a component's props type — so a consumer
// can see how to USE a symbol without reading its source. `.default(null)` keeps
// graphs written before this field was added parseable.
const SymbolNode = (type: 'component' | 'function') =>
  z
    .object({
      ...hashableFields,
      type: z.literal(type),
      path: z.string(),
      span: SourceSpan,
      metrics: NodeMetrics,
      bundleBytes: z.number().int().nonnegative().nullable(),
      signature: z.string().nullable().default(null),
    })
    .strict();

export const ComponentNode = SymbolNode('component');
export type ComponentNode = z.infer<typeof ComponentNode>;

export const FunctionNode = SymbolNode('function');
export type FunctionNode = z.infer<typeof FunctionNode>;

// A third-party package pulled from node_modules (e.g. `react`, `@scope/pkg`).
// It has no path/span/metrics on disk — it is a leaf the project depends ON,
// surfaced so the graph shows real external dependencies, not just internal ones.
export const ExternalNode = z
  .object({
    ...baseFields,
    type: z.literal('external'),
  })
  .strict();
export type ExternalNode = z.infer<typeof ExternalNode>;

export const GraphNode = z.discriminatedUnion('type', [
  RepoNode,
  AppNode,
  PackageNode,
  FolderNode,
  FileNode,
  ComponentNode,
  FunctionNode,
  ExternalNode,
]);
export type GraphNode = z.infer<typeof GraphNode>;

// ---------------------------------------------------------------------------
// Type guards / helpers for consumers that need to narrow the union without a
// manual `switch` on `type`.
// ---------------------------------------------------------------------------

const SPANNED = new Set<NodeType>(['component', 'function']);
const PATHED = new Set<NodeType>([
  'app',
  'package',
  'folder',
  'file',
  'component',
  'function',
]);
const METRICED = new Set<NodeType>([
  'app',
  'package',
  'folder',
  'file',
  'component',
  'function',
]);

export const hasSpan = (
  node: GraphNode,
): node is ComponentNode | FunctionNode => SPANNED.has(node.type);

export const hasPath = (
  node: GraphNode,
): node is
  | AppNode
  | PackageNode
  | FolderNode
  | FileNode
  | ComponentNode
  | FunctionNode => PATHED.has(node.type);

export const hasMetrics = (
  node: GraphNode,
): node is
  | AppNode
  | PackageNode
  | FolderNode
  | FileNode
  | ComponentNode
  | FunctionNode => METRICED.has(node.type);

/** Path of a node if it is backed by the filesystem, else null. */
export const nodePath = (node: GraphNode): string | null =>
  hasPath(node) ? node.path : null;
