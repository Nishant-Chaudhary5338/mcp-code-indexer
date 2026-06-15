export {
  NodeType,
  SourceSpan,
  NodeMetrics,
  GraphNode,
  RepoNode,
  AppNode,
  PackageNode,
  FolderNode,
  FileNode,
  ComponentNode,
  FunctionNode,
  ExternalNode,
  hasSpan,
  hasPath,
  hasMetrics,
  nodePath,
} from './node.schema';
export { EdgeType, GraphEdge } from './edge.schema';
export {
  HealthLevel,
  NodeStatus,
  emptyStatus,
  deriveHealth,
} from './status.schema';
export { NodeKnowledge, GitMeta } from './knowledge.schema';
export {
  GraphMeta,
  GraphSnapshot,
  GraphPatch,
  applyPatch,
} from './snapshot.schema';
export {
  repoId,
  appId,
  packageId,
  folderId,
  fileId,
  externalId,
  componentId,
  functionId,
  edgeId,
} from './ids';
export {
  DEPENDENCY_TYPES,
  buildReverseIndex,
  buildForwardIndex,
  whoRenders,
  whoCalls,
  findReferences,
  blastRadius,
  findCycles,
  findOrphans,
} from './analysis';
export type { OrphanNode } from './analysis';
export {
  DEFAULT_FULL_NODE_THRESHOLD,
  toLeanNode,
  summarizeSnapshot,
  projectGraph,
} from './projection';
export type {
  LeanNode,
  GraphSummary,
  ProjectionOptions,
  ProjectedGraph,
} from './projection';
export { searchNodes } from './search';
export type { SearchResult, SearchOptions } from './search';
export {
  cosineSimilarity,
  rankBySimilarity,
  EMBEDDABLE_TYPES,
  isEmbeddable,
} from './semantic';
export type { VectorEntry, SemanticHit } from './semantic';
export { buildContextPack } from './context';
export type {
  ContextPack,
  ContextRef,
  ContextTarget,
  ContextPackOptions,
} from './context';
