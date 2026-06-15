# mcp-indexer

A reusable **code-intelligence engine** that indexes any TypeScript / React repository into a queryable **code graph** — nodes for repos, packages, files, components, and functions; edges for `contains`, `imports`, `calls`, `renders`, and `references` — and serves it three ways: an **HTTP + WebSocket API**, a **CLI**, and a **Model Context Protocol (MCP) server** that AI agents (Claude, Cursor) can call directly.

Point it at a repo, get a live graph of how the code fits together.

```
┌─────────────┐   ts-morph AST    ┌──────────────┐   serve    ┌─────────────────────────┐
│ any TS/React│ ───────────────▶  │  code graph   │ ─────────▶ │ HTTP + WS  ·  CLI  ·  MCP │
│    repo     │   walk + analyze  │ nodes + edges │            │   (consume from anywhere) │
└─────────────┘                   └──────────────┘            └─────────────────────────┘
```

---

## Proof: indexing a real app

This repo's sibling [`../app`](../app) — **The Plan Beyond** (a standalone React 19 + Vite + TS app) — indexed live:

```
$ pnpm index:app
Indexed /…/app
  nodes: 261 (1 repo · 1 app · 135 file · 63 component · 36 function · 25 folder)
  edges: 538 (260 contains · 171 imports · 49 renders · 31 calls · 27 references)
  time:  ~2.7s
```

The indexer is **generic** — it discovers the workspace shape itself and handles **both** monorepos (pnpm / turbo / lerna) **and** standalone single-package repos like The Plan Beyond app. Nothing about the target is hardcoded.

---

## Quickstart

```bash
pnpm install
pnpm build        # turbo builds code-graph-core → _shared → code-indexer (topo order)
pnpm test         # unit tests across the engine + schema packages (run via turbo)
```

> Requires Node ≥ 20.19 and pnpm 10 (pinned to `pnpm@10.32.1` via `packageManager`; `corepack enable` selects it). `pnpm build` is required before running the CLI or server — the server runs via `tsx` but imports the compiled engine, and the CLI/MCP entrypoints are compiled JS.

---

## Three ways to use it

All three resolve the **same engine** against a target repo root. The examples below point at the sibling `../app` (The Plan Beyond); swap in any path.

### 1. Live server + file-watcher (the demo)

```bash
pnpm serve:app
#   → 🔭 Indexer server on http://localhost:3002
#      root: /…/app
#      ✓ 261 nodes · 538 edges in ~2.7s
#      👀 watching for changes — edit a file to see it update live
```

| Endpoint | Description |
|---|---|
| `GET /health` | `{ status, port, indexed }` |
| `GET /api/graph` | Full snapshot — `{ meta, nodes, edges }` |
| `GET /api/node/:id` | One node (e.g. `file:src/App.tsx`) with metrics + status |
| `POST /api/reindex` | Force a full re-index |
| `WS /ws` | Push updates as watched files change |

```bash
curl localhost:3002/api/graph | jq '.meta'
# { "root": "/…/app", "nodeCount": 261, "edgeCount": 538, "indexerVersion": "0.1.0" }

curl localhost:3002/api/node/file:src/App.tsx | jq '.node | {type, metrics, status}'
# { "type": "file", "metrics": { "loc": 12, "exportsCount": 1 }, "status": { "buildOk": true, "health": "ok" } }
```

**Web UI (3D graph).** With the server running, launch the visual front-end — an
interactive [`react-force-graph-3d`](https://github.com/vasturiano/react-force-graph)
viewer with drill-down (repo → app → package → file → component), live
type-health coloring, AI summaries, impact analysis, and a codebase chat:

```bash
pnpm ui          # → http://localhost:5182  (Vite proxies /api + /ws → :3002)
```

The UI lives in [`apps/web/code-graph`](apps/web/code-graph) and is a pure
consumer of the HTTP + WS API above — it loads `GET /api/graph`, then applies
live `GraphPatch`es pushed over `WS /ws` as you edit files.

### 2. CLI (one-shot snapshot)

```bash
pnpm index:app
# writes ../app/.code-graph/graph.json and prints node/edge counts

# …or any repo:
node tools/code-indexer/build/code-indexer/src/cli.js index --root /path/to/any/repo
```

### 3. MCP server (connect to Claude Code / Cursor)

The engine is also an MCP server exposing three tools: **`index_repo`**, **`get_graph`**, **`get_node`**.

> It is **not** auto-connected — you register it once. Build first (`pnpm build`), then pick one of:

**A — Claude Code (CLI, one command):**

```bash
claude mcp add code-indexer -- node "$(pwd)/tools/code-indexer/build/code-indexer/src/index.js"
claude mcp list            # → code-indexer: ✓ connected
```

Now in any Claude Code session the three tools are callable. Ask, e.g., *"use index_repo on /path/to/app, then get_node for file:src/App.tsx."*

**B — Project config file** (`.mcp.json` at a repo root — Claude Code and Cursor auto-load it when you open that project):

```json
{
  "mcpServers": {
    "code-indexer": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/mcp-indexer/tools/code-indexer/build/code-indexer/src/index.js"]
    }
  }
}
```

Either way, a tool call returns:

```jsonc
// index_repo  { "root": "/…/app" }
{ "success": true, "root": "/…/app", "nodeCount": 261, "edgeCount": 538, "durationMs": 2700 }
```

> **Path tip:** the MCP entry needs an **absolute** path to `index.js`. For tool args, a relative `root` / `INDEXER_ROOT` (like `../app`) is resolved against the indexer repo root; absolute paths always work.

---

## Architecture

> **Deeper rationale** — the graph model, why ts-morph, the macro/micro split, and the honest trade-offs — is in [docs/DESIGN.md](docs/DESIGN.md).

A focused Turborepo of four packages (plus two shared-config packages):

```
mcp-indexer/
├── packages/
│   └── code-graph-core/     @repo/code-graph-core — Zod schemas: nodes, edges, snapshot, status, knowledge
├── tools/
│   ├── _shared/             @tools/shared — MCP server base (McpServerBase, ToolRegistry), error/file utils
│   └── code-indexer/        code-indexer-mcp — the engine: ts-morph analysis, CLI, and MCP server
└── apps/
    └── indexer-server/      indexer-server — Express + ws runtime, file-watcher, REST/WS over the graph
```

**Dependency flow** (leaves first):

```
code-graph-core ─┬─▶ code-indexer ─▶ indexer-server
   _shared ──────┘
```

- **`code-graph-core`** — the contract. Zod schemas validate every node, edge, and snapshot, so the graph shape is guaranteed end-to-end (engine → API → consumer). Pure, dependency-light, fully unit-tested.
- **`code-indexer`** — the analysis engine. Uses [`ts-morph`](https://ts-morph.com) to parse source, plus a workspace discovery pass (`discoverWorkspace`) that detects monorepo vs standalone layouts. Persists incremental snapshots to `.code-graph/`. Doubles as the MCP server.
- **`indexer-server`** — wraps the engine in Express + `ws`, indexes on boot, enriches node status in the background, and starts a `@parcel/watcher` to push live updates.

### The graph model

| Node types | Edge types |
|---|---|
| `repo` · `app` · `package` · `folder` · `file` · `component` · `function` | `contains` · `imports` · `calls` · `renders` · `references` |

Each node carries metrics (`loc`, `exportsCount`) and a `status` block (type errors, lint, build health) so the graph is a foundation for codebase dashboards, impact analysis, and AI-agent code navigation.

### Data flow

```
target repo ──▶ discoverWorkspace ──▶ ts-morph parse ──▶ build nodes + edges ──▶ snapshot (Zod-validated)
                                                                                      │
                       ┌──────────────────────────────────────────────────────────────┤
                  CLI: write .code-graph/graph.json     Server: GET /api/graph, WS push     MCP: index_repo / get_graph / get_node
```

---

## Scripts

| Command | What it does |
|---|---|
| `pnpm build` | Build all packages (topo order via turbo) |
| `pnpm typecheck` | `tsc --noEmit` across every package |
| `pnpm test` | Unit tests (schemas + engine) |
| `pnpm lint` | ESLint across all packages (`turbo run lint`, shared flat config from `packages/eslint-config`) |
| `pnpm index -- --root <path>` | Index any repo to `<path>/.code-graph/graph.json` |
| `pnpm serve` | Run the server against **this** repo (`:3002`) |
| `pnpm index:app` / `pnpm serve:app` | The same, pointed at the sibling `../app` (The Plan Beyond) |

---

## Tech

TypeScript (strict) · Turborepo · pnpm workspaces · ts-morph · Zod · Express · ws · @parcel/watcher · Model Context Protocol SDK · Vitest.

## Status

`pnpm build` ✓ · `pnpm typecheck` ✓ · `pnpm lint` ✓ · `pnpm test` ✓ — verified against the sibling app (The Plan Beyond) via CLI, HTTP/WS, and MCP. CI runs the same gate (`build → typecheck → lint → test`) on every push and PR (`.github/workflows/ci.yml`).
