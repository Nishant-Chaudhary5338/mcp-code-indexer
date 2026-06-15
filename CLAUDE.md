# CLAUDE.md — mcp-indexer

Operational map for the code-intelligence engine. Full rationale in [`docs/DESIGN.md`](docs/DESIGN.md); usage in [`README.md`](README.md).

> Repo-wide context & memory: [`../.claude/`](../.claude/README.md) — esp.
> [`memory.md`](../.claude/memory.md) (history/decisions) and [`indexer.md`](../.claude/indexer.md).

## Commands (turbo, from this dir)

```bash
pnpm build      # topo build: code-graph-core → _shared → code-indexer → indexer-server/web
pnpm typecheck  # tsc --noEmit across packages
pnpm lint       # eslint, shared flat config
pnpm test       # vitest (schemas + engine) + node:test (server) + web
pnpm index:app  # index sibling ../app → app/.code-graph/graph.json
pnpm serve:app  # HTTP+WS server :3002 (INDEXER_ROOT=../app)
pnpm ui         # 3D web viewer :5182 (proxies /api + /ws → :3002)
```

> `pnpm build` is required before running the CLI/MCP (compiled JS) or the server (runs via tsx but imports the compiled engine). If `pnpm` errors with "no importer manifest," you're in the wrong cwd — use `pnpm -C /abs/path/to/mcp-indexer`.

## The model (the whole vocabulary)

- **Nodes**: `repo · app · package · folder · file · component · function`. Strict Zod `discriminatedUnion` — each variant carries only its legal fields (a `repo` has no `span`; only `component`/`function` have `span`+`bundleBytes`). Validation rejects illegal states.
- **Edges**: `contains · imports · references · renders · calls · depends-on`.
  - `imports`/`references` (type-only) = **file-level**, from ts-morph module resolution.
  - `renders` (component→component) / `calls` (symbol→symbol) = **symbol-level**, resolved in the semantic pass through each file's import bindings + local symbols. **Conservative: an edge is emitted only when the target resolves to a real indexed node** (no wrong edges; library/builtin names produce nothing).
  - `depends-on` = package→package, read from `package.json` (monorepos only).

## Pipeline

`discoverWorkspace → indexMacro → indexStructure → buildSnapshot → (progressive) enrichStatus`

- Standalone repos (like `../app`) and monorepos are handled **identically** — a standalone repo is a one-package workspace whose root is the package. No target-specific code.
- `indexStructure` ([`structural/micro-symbols.ts`](tools/code-indexer/src/engine/structural/micro-symbols.ts)) runs two passes: **structural** (file/symbol nodes + contains/imports/references) then **semantic** ([`structural/semantic-edges.ts`](tools/code-indexer/src/engine/structural/semantic-edges.ts), renders/calls, resolved over the full symbol table).
- **Component vs function** is a heuristic ([`structural/detect-components.ts`](tools/code-indexer/src/engine/structural/detect-components.ts)): PascalCase + `.tsx` + returns JSX.
- **Status** (type errors) is a separate, progressive pass per package; it ignores TS2307 (unbuilt-sibling noise).

## Where things live

```
packages/code-graph-core/   Zod schemas + ids + helpers (the contract; zod-only leaf)
tools/_shared/              McpServerBase, ToolRegistry, utils (imported by relative path)
tools/code-indexer/         the engine
  src/engine/
    discovery/              discover-workspace (mono vs standalone)
    structural/             macro-nodes · micro-symbols · symbol-nodes · detect-components
                            · import-edges · semantic-edges · folder-tree
    status/                 typecheck-runner · merge-status
    knowledge/              describe · read-source (for AI summaries)
    incremental/            cache (graph.json + hashes.json sidecar)
    session.ts              IndexerSession — full index, incremental, live reparseFiles
  src/cli.ts                `index [--root <path>] [--incremental]`
  src/server.ts             MCP server: index_repo / get_graph / get_node
apps/indexer-server/        Express + ws runtime, @parcel/watcher, graph-service, routes
apps/web/code-graph/        React 3D viewer (react-force-graph-3d) — pure consumer of the API
```

## Live edits (the hot path)

The watcher debounces 250ms, then `session.reparseFiles` re-extracts changed files **plus one hop of importers** (so symbol edges into a changed file can't dangle), runs the semantic pass, re-type-checks affected packages, and emits a reconciled `GraphPatch` over WS. Full from-scratch rebuild is still available via `POST /api/reindex`.

## Conventions & gotchas

- Strict TS + `noUncheckedIndexedAccess` — guard indexed access (`arr[0] ?? null`), incl. `'x'.split('#')[0] ?? ''`.
- `code-indexer` imports `_shared` by **relative path** (`../../_shared`) and compiles it into its own output — keep the `tools/` layout intact.
- Server binds **127.0.0.1 only** (unauthenticated mutating + LLM endpoints — do not expose off-host).
- The LLM (knowledge summaries / chat) is **optional**: a heuristic fallback always works; never make it a hard dependency.
- Node ids: `repo:` `app:` `pkg:` `dir:` `file:<rel>` `cmp:<rel>#Name` `fn:<rel>#Name[~n]`. Ids are line-independent (stable across whitespace edits).
- When adding an edge type: update `edge.schema.ts`, emit it somewhere, add it to `EDGE_COLOR`/`EDGE_LABEL` + the web `Legend`, and consider whether it's a dependency for `apps/web/code-graph/src/lib/analysis.ts` (blast radius / cycles).

## The web viewer palette is NOT locked

Unlike `app/`, colors in `apps/web/code-graph` may change. Tokens/edge colors live in [`apps/web/code-graph/src/lib/graph-style.ts`](apps/web/code-graph/src/lib/graph-style.ts).
