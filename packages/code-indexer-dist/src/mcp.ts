// Programmatic entry for the stdio MCP server. Exports the class only (no
// side-effect run) so consumers — e.g. the mcp-toolkit `code-indexer` tool — can
// `import { CodeIndexerServer } from 'code-graph-indexer/mcp'` and run it
// themselves. To launch the server standalone, use `code-graph-indexer mcp`.
export { CodeIndexerServer } from 'code-indexer-mcp/server';
