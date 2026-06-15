// blastRadius / findCycles (and the reverse-lookup queries) now live in the
// shared contract `@repo/code-graph-core` so the engine, server, MCP tools, and
// this viewer all share one implementation. Re-exported here so the existing
// `./lib/analysis` import sites in the web app keep resolving unchanged.
export {
  DEPENDENCY_TYPES,
  blastRadius,
  findCycles,
  whoRenders,
  whoCalls,
  findReferences,
} from '@repo/code-graph-core';
