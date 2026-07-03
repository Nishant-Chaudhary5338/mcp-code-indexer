# mcp-code-indexer

The source monorepo for **[`code-graph-indexer`](https://www.npmjs.com/package/code-graph-indexer)** — a code-intelligence engine that turns any TypeScript / React / Next.js repo into a queryable **code graph** and serves it five ways: a **CLI**, an **MCP server** for AI agents, an **HTTP + WebSocket API**, a **3D web explorer with a built-in chatbot**, and **local semantic search**.

> **Just want to use it?** You don't need this repo. `npx code-graph-indexer ui --root .` gets you the whole thing — see the [package README](packages/code-indexer-dist/README.md). This repo is for working on the engine itself.

```
┌──────────────┐   ts-morph AST    ┌───────────────┐   serve    ┌───────────────────────────────────────┐
│ any TS/React │ ───────────────▶  │  code graph   │ ─────────▶ │ CLI · MCP · HTTP/WS · 3D UI · semantic │
│     repo     │   walk + resolve  │ nodes + edges │            │        (consume from anywhere)         │
└──────────────┘                   └───────────────┘            └───────────────────────────────────────┘
```

Everything is built on [`ts-morph`](https://ts-morph.com), so edges are **resolved by the compiler, not grepped** — and conservative: an edge is drawn only when it resolves to a real indexed node. The indexer is **generic**; it discovers the workspace shape itself and handles monorepos (pnpm / turbo / lerna) and standalone single-package repos alike. Nothing about the target is hardcoded.

---

## Why it makes development faster, cheaper, and more reliable

Estimated cost of the same question with an agent reading files versus one graph query (typical mid-size repo):

| What you ask                    | Agent alone (read files)            | With the code graph           | You save        |
| ------------------------------- | ----------------------------------- | ----------------------------- | --------------- |
| "What calls `format()`?"        | ~30k tokens · ~40s                  | ~0.4k tokens · <1s            | **~99% tokens** |
| "What breaks if I change this?" | ~50k tokens · ~60s _(misses edges)_ | ~0.6k tokens · <1s _(exact)_  | **~99% tokens** |
| "Where's the code that does X?" | ~25k tokens · ~30s                  | ~0.3k tokens · ~2s            | **~98% tokens** |
| "Context to edit this safely"   | ~40k tokens · ~50s _(5 reads)_      | ~0.8k tokens · <1s _(1 call)_ | **~98% tokens** |
| "Any dead code or cycles?"      | ~60k tokens · manual audit          | ~0.5k tokens · instant        | **~99% tokens** |

**Faster** (in-memory lookups, not re-reads) · **cheaper** (fewer tokens = lower bill) · **reliable** (compiler-resolved edges — no hallucinated callers, no missed impact).

---

## The graph model

| Node types                                                                             | Edge types                                                                 |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `repo` · `app` · `package` · `folder` · `file` · `component` · `function` · `external` | `contains` · `imports` · `calls` · `renders` · `references` · `depends-on` |

Each node carries metrics (`loc`, `exportsCount`), a `status` block (type/lint/build health), and git metadata — enough to build codebase dashboards, impact analysis, and AI-agent navigation on top of.

---

## Quickstart (working on the engine)

```bash
pnpm install
pnpm build        # turbo builds core → _shared → engine → server → web (topo order)
pnpm test         # unit tests across the engine + schema packages
pnpm typecheck
pnpm lint
```

> Requires Node ≥ 20.19 and pnpm 10 (pinned via `packageManager`; `corepack enable` selects it). `pnpm build` is required before running the CLI or server from source.

Run the full explorer against this repo (or any path):

```bash
pnpm serve --root .        # HTTP/WS server on :3002 (serves the built UI too)
pnpm ui                    # OR: Vite dev server on :5182 with HMR, proxying /api + /ws → :3002
```

`pnpm serve` serves the pre-built web bundle; `pnpm ui` is the hot-reloading dev server for working on the UI itself.

---

## The five surfaces

All resolve the **same engine** against a target repo root.

### 1. 3D explorer + chatbot

The [`apps/web/code-graph`](apps/web/code-graph) front-end — a [`react-force-graph-3d`](https://github.com/vasturiano/react-force-graph) viewer with folder drill-down, type/health coloring, hover tracing, blast-radius highlighting, a 2D fallback, and a chat panel grounded in the graph. It's a pure consumer of the HTTP/WS API: it loads `GET /api/graph`, then applies live `GraphPatch`es over `WS /ws` as you edit files. The published package bundles the built version so `npx code-graph-indexer ui` just works.

### 2. MCP server — 14 tools

Registers over stdio so Claude Code / Cursor can call it directly:

```bash
claude mcp add code-graph -- node "$(pwd)/tools/code-indexer/build/code-indexer/src/index.js"
```

Tools: `index_repo`, `get_graph`, `get_node`, `who_renders`, `who_calls`, `find_references`, `blast_radius`, `find_cycles`, `find_orphans`, `search_nodes`, `get_context_pack`, `build_embeddings`, `semantic_search`, and `open_explorer` (starts the 3D UI and returns its URL). Full descriptions are in the [package README](packages/code-indexer-dist/README.md#2-mcp-server--let-claude--cursor-query-your-code).

### 3. CLI

```bash
node tools/code-indexer/build/code-indexer/src/cli.js index --root /path/to/repo
node tools/code-indexer/build/code-indexer/src/cli.js query blast-radius --id "fn:src/util.ts#format" --root /path/to/repo
```

### 4. HTTP + WebSocket API

```bash
pnpm serve --root /path/to/repo
curl localhost:3002/api/graph | jq '.meta'
# { "root": "/…", "nodeCount": 908, "edgeCount": 2138, "indexerVersion": "…" }
```

Reads, reverse queries, `POST /api/reindex`, `POST /api/chat`, and `WS /ws` for live patches. Bound to `127.0.0.1` only — endpoints are unauthenticated and mutating, so never expose it off-host.

### 5. Semantic search

Local `Xenova/all-MiniLM-L6-v2` embeddings via transformers.js — no API key, nothing leaves the machine. Falls back to lexical search when the model isn't installed.

---

## Architecture

> Deeper rationale — the graph model, why ts-morph, the macro/micro split, and the honest trade-offs — is in [docs/DESIGN.md](docs/DESIGN.md).

A Turborepo of a few focused packages (plus shared config):

```
mcp-code-indexer/
├── packages/
│   ├── code-graph-core/       @repo/code-graph-core — Zod schemas: nodes, edges, snapshot, status
│   └── code-indexer-dist/     code-graph-indexer — the published npm bundle (tsup) + bundled web UI
├── tools/
│   ├── _shared/               @tools/shared — MCP server base (McpServerBase, ToolRegistry), utils
│   └── code-indexer/          code-indexer-mcp — the engine: ts-morph analysis, CLI, MCP server
└── apps/
    ├── indexer-server/        indexer-server — Express + ws runtime, file-watcher, REST/WS + chat
    └── web/code-graph/        code-graph — the React + three.js 3D explorer
```

Dependency flow (leaves first):

```
code-graph-core ─┬─▶ code-indexer ─▶ indexer-server ─┐
   _shared ──────┘                                   ├─▶ code-indexer-dist  (the npm package)
   web/code-graph ─────────────────────────────────┘
```

- **`code-graph-core`** — the contract. Zod schemas validate every node, edge, and snapshot, so the graph shape is guaranteed end-to-end. Pure and fully unit-tested.
- **`code-indexer`** — the analysis engine. `ts-morph` parsing plus workspace discovery (monorepo vs standalone), incremental snapshots to `.code-graph/`. Doubles as the MCP server.
- **`indexer-server`** — wraps the engine in Express + `ws`, indexes on boot, enriches node status in the background, watches files for live updates, and serves the chat endpoint (local `claude` CLI → API key → heuristic).
- **`web/code-graph`** — the 3D explorer, a pure API consumer.
- **`code-indexer-dist`** — bundles all of the above into the single `code-graph-indexer` npm package, web UI included.

---

## Scripts

| Command                    | What it does                                         |
| -------------------------- | ---------------------------------------------------- |
| `pnpm build`               | Build every package (topo order via turbo)           |
| `pnpm typecheck`           | `tsc --noEmit` across every package                  |
| `pnpm test`                | Unit tests (schemas + engine)                        |
| `pnpm lint`                | ESLint across all packages (shared flat config)      |
| `pnpm serve --root <path>` | Run the server (with UI) against any repo on `:3002` |
| `pnpm ui`                  | Vite dev server for the explorer on `:5182`          |

## Tech

TypeScript (strict) · Turborepo · pnpm workspaces · ts-morph · Zod · Express · ws · @parcel/watcher · React · three.js · Model Context Protocol SDK · transformers.js · Vitest · tsup.

## Status

`pnpm build` ✓ · `pnpm typecheck` ✓ · `pnpm lint` ✓ · `pnpm test` ✓. CI runs the same gate (`build → typecheck → lint → test`) on every push and PR (`.github/workflows/ci.yml`).
