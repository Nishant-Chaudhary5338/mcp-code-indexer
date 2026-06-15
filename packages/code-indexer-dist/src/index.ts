// Library surface. The engine, the query facade, and the MCP server class.
// The HTTP/WS server factory lives in the `./serve` subpath (it pulls in
// express/ws/@parcel/watcher); core schemas live in `./core`.
export {
  runFullIndex,
  runIncrementalIndex,
  IndexerSession,
  type IndexResult,
} from 'code-indexer-mcp/engine';
export * from 'code-indexer-mcp/query';
export { CodeIndexerServer } from 'code-indexer-mcp/server';
