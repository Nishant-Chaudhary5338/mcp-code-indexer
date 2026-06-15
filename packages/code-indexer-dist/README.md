# @mcp-toolkit/code-indexer

Index any **TypeScript / React** repo (monorepo or standalone) into a queryable **code graph** — nodes for repos, packages, files, components, and functions; edges for `contains`, `imports`, `calls`, `renders`, `references`, `depends-on` — and use it three ways: a **CLI**, an **HTTP + WebSocket server**, and an **MCP server** that AI agents (Claude, Cursor) can call directly.

Built on [`ts-morph`](https://ts-morph.com) (the TypeScript compiler), so edges are resolved, not grepped — and **conservative**: an edge is emitted only when it resolves to a real indexed node, so you get no edge rather than a wrong one.

## Quickstart (npx — no install)

```bash
# One-shot: index a repo to <root>/.code-graph/graph.json
npx @mcp-toolkit/code-indexer index --root /path/to/repo

# Ask graph questions (after indexing)
npx @mcp-toolkit/code-indexer query who-renders   --id "cmp:src/Button.tsx#Button" --root /path/to/repo
npx @mcp-toolkit/code-indexer query who-calls      --id "fn:src/util.ts#format"     --root /path/to/repo
npx @mcp-toolkit/code-indexer query find-references --id "cmp:src/Button.tsx#Button" --types renders,imports --root /path/to/repo
npx @mcp-toolkit/code-indexer query blast-radius   --id "fn:src/util.ts#format"     --root /path/to/repo
npx @mcp-toolkit/code-indexer query find-cycles    --root /path/to/repo
npx @mcp-toolkit/code-indexer query graph          --root /path/to/repo --summary

# Live HTTP + WebSocket server (127.0.0.1 only)
npx @mcp-toolkit/code-indexer serve --root /path/to/repo --port 3002
```

Add `--json` to any `query` for machine-readable output.

## MCP server (Claude Code / Cursor)

```bash
claude mcp add @mcp-toolkit/code-indexer -- npx -y @mcp-toolkit/code-indexer mcp
```

Exposes **8 tools**: `index_repo`, `get_graph` (token-safe — defaults to a summary on large repos), `get_node`, `who_renders`, `who_calls`, `find_references`, `blast_radius`, `find_cycles`.

## Programmatic

```ts
import { runFullIndex, IndexerSession } from '@mcp-toolkit/code-indexer';
import { queryWhoRenders, queryGraph } from '@mcp-toolkit/code-indexer';
import { createIndexerApp } from '@mcp-toolkit/code-indexer/serve';   // mountable Express app + WS
import type { GraphSnapshot } from '@mcp-toolkit/code-indexer/core';  // the schema/contract
```

## Notes

- **Node ≥ 20.19.**
- The optional AI summary/chat features shell out to a local `claude` CLI (no API key); a heuristic fallback always works, so they are never a hard dependency.
- The `serve` HTTP/WS endpoints are unauthenticated and mutating — bound to `127.0.0.1`; do not expose off-host.

MIT © Nishant Chaudhary
