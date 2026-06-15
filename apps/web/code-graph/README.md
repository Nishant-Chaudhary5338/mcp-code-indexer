# code-graph

Live, codebase-integrated **code indexer** with a 3D interactive graph. Indexes any
TS/React monorepo into apps → packages → files → components/functions with
dependency edges, live type-health status, AI summaries, and impact analysis.

## Architecture

| Piece | What it does |
|---|---|
| `@repo/code-graph-core` | Zod data model (nodes/edges/status/knowledge/snapshot/patch) |
| `tools/code-indexer` | Engine: ts-morph structural parse + per-package typecheck. CLI + MCP server |
| `apps/indexer-server` | Express + WebSocket (:3002). Indexes, watches files, serves graph + patches |
| `apps/web/code-graph` | React 19 + react-force-graph-3d 3D UI (:5182) |

## Run

```bash
pnpm --filter @repo/code-graph-core build   # build the shared data model
pnpm --filter code-indexer-mcp build        # build the engine
pnpm --filter indexer-server start          # :3002 — indexes + watches this repo
pnpm --filter code-graph dev                # :5182 — open the 3D graph
```

CLI only: `node tools/code-indexer/build/code-indexer/src/cli.js index --root <path>`

## Features

- **Drill-down** repo → app → package → file → component (click to expand)
- **Live status** — nodes colored by type-error health; edit a file → its node
  recolors live over WebSocket (no reload)
- **AI knowledge** — per-node summaries + "ask the codebase" chat via the local
  Claude Code CLI (`claude -p`, no API key) with a heuristic fallback
- **Blast radius** — select a node, highlight everything that depends on it
- **Circular-dependency** detection across the workspace
