# Minimal image for running the code-graph-indexer MCP server over stdio.
# Used by Glama (and any container-based MCP host) to verify the server starts
# and responds to introspection. The server communicates over stdio, so there
# is no port to expose.
FROM node:20-slim

# Install the published package globally so the `code-graph-indexer` bin is on PATH.
# Pin via build arg to reproduce a specific release; defaults to latest.
ARG VERSION=latest
RUN npm install -g code-graph-indexer@${VERSION}

# Launch the stdio MCP server. This is the canonical entrypoint Glama exercises.
ENTRYPOINT ["code-graph-indexer", "mcp"]
