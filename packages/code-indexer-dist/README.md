# code-graph-indexer

**Turn any TypeScript / React / Next.js repo into a queryable code graph — then ask it precise questions from the CLI, an MCP server (Claude / Cursor), an HTTP + WebSocket API, or a 3D web explorer.**

Built on [`ts-morph`](https://ts-morph.com) (the real TypeScript compiler), so relationships are **resolved, not grepped** — and **conservative**: an edge is emitted only when it resolves to a real indexed node. You get *no* edge rather than a *wrong* one.

```bash
npx code-graph-indexer index --root /path/to/repo     # build the graph
npx code-graph-indexer mcp                             # serve it to your AI agent
```

---

## Why this exists

When an AI coding agent (or you) asks *"what breaks if I change this function?"*, the usual answer is to **read a pile of files into context and guess**. That's slow, burns tokens, and still misses things.

A code graph flips that:

| Question | Without a graph | With `code-graph-indexer` |
| --- | --- | --- |
| "What calls `format()`?" | grep the repo, read every hit, hope | `who_calls` → exact callers, **resolved by the compiler** |
| "What breaks if I change this?" | read N files, reason, miss edge cases | `blast_radius` → the full transitive impact set |
| "Where's the auth logic?" | open files until you find it | `semantic_search "logic that decides access"` |
| "Give me context to edit safely" | 4–5 separate file reads | `get_context_pack` → one dense bundle |

**Token savings & speed are the whole point:**

- 🪙 **Fewer tokens.** Instead of streaming whole files into an LLM's context, a single graph query returns just the relevant nodes — typically a few hundred tokens instead of tens of thousands. `get_graph` is **token-safe by default**: on large repos it returns a compact summary unless you explicitly ask for `full`.
- ⚡ **Faster answers.** The graph is computed once and persisted to `.code-graph/graph.json`. Queries are lookups over an in-memory graph — **milliseconds**, not a fresh repo scan per question.
- 🎯 **Correct, not approximate.** Edges come from the TypeScript module/symbol resolver (handles `@/*` path aliases, re-exports, monorepo `workspace:*` deps), so `who_calls` and `blast_radius` don't hallucinate.

---

## What it indexes

**Nodes:** `repo` · `app` · `package` · `folder` · `file` · `component` · `function` · `external` (third-party)
**Edges:** `contains` · `imports` · `calls` · `renders` · `references` · `depends-on`

Each node also carries metrics (LOC, exports), optional health/status, and git metadata.

### Works on

- **TypeScript & JavaScript** — `.ts` / `.tsx` / `.js` / `.jsx`
- **React** — components and their `renders` graph (who renders what)
- **Next.js** — App Router *and* Pages, both **standalone apps** and **monorepo apps**
- **Monorepos** — Turborepo, pnpm / npm / yarn workspaces, Lerna (cross-package `depends-on` edges resolved via `workspace:*`)
- **Standalone single-package repos** — including those that carry a `pnpm-workspace.yaml` only for config (e.g. `ignoredBuiltDependencies`)

---

## The five ways to use it

### 1. CLI — index & query

```bash
# Build (or refresh) the graph → <root>/.code-graph/graph.json
npx code-graph-indexer index --root /path/to/repo
npx code-graph-indexer index --root /path/to/repo --incremental   # only re-parse changed files

# Ask graph questions (add --json to any query for machine-readable output)
npx code-graph-indexer query who-renders     --id "cmp:src/Button.tsx#Button"  --root .
npx code-graph-indexer query who-calls        --id "fn:src/util.ts#format"      --root .
npx code-graph-indexer query find-references  --id "cmp:src/Button.tsx#Button"  --types renders,imports --root .
npx code-graph-indexer query blast-radius     --id "fn:src/util.ts#format"      --root .
npx code-graph-indexer query find-cycles      --root .
npx code-graph-indexer query orphans          --root .          # dead-code candidates
npx code-graph-indexer query search           --query useAuth   --root .          # fuzzy name/path lookup
npx code-graph-indexer query semantic         --query "code that validates a token" --root .   # by meaning
npx code-graph-indexer query graph            --root . --summary
npx code-graph-indexer query context          --id "fn:src/util.ts#format" --root .   # dense edit bundle

# Health gate (CI-friendly): fail on cycles / orphans
npx code-graph-indexer check --root . --max-cycles 0 --fail-on-orphans
```

> **Node ids** are stable and predictable: `cmp:<path>#<Name>` (component), `fn:<path>#<name>` (function), `file:<path>` (file). Don't know the id? Use `search` (lexical) or `semantic` (meaning) to resolve a rough name to a canonical id.

### 2. MCP server — let Claude / Cursor query your code

Register the stdio MCP server once:

```bash
# Claude Code (one command)
claude mcp add code-graph -- npx -y code-graph-indexer mcp
```

```jsonc
// …or a project .mcp.json (Claude Code + Cursor auto-load it)
{
  "mcpServers": {
    "code-graph": { "command": "npx", "args": ["-y", "code-graph-indexer", "mcp"] }
  }
}
```

Now your agent has **13 tools** — it can resolve names, trace impact, and pull edit-ready context **without dumping files into its context window**:

| Tool | What it answers |
| --- | --- |
| `index_repo` | Build the graph and persist it to `.code-graph/graph.json` |
| `get_graph` | Read the graph — **token-safe**: summary on large repos unless `full:true`; narrow with `type`/`depth`/`lean`/`fields` |
| `get_node` | Read one node by id |
| `who_renders` | Which components render this component (incoming `renders`) |
| `who_calls` | Which symbols call this function/component (incoming `calls`) |
| `find_references` | All incoming references, optionally filtered by edge type |
| `blast_radius` | Everything that transitively depends on a node — the impact if it changes |
| `find_cycles` | Import / render / call cycles |
| `find_orphans` | Dead-code candidates (exports nothing imports/renders/calls) |
| `search_nodes` | Fuzzy-find nodes by name or path (resolve a rough name → canonical id) |
| `get_context_pack` | One dense bundle to safely edit a node: source + dependencies + dependents + blast-radius size (replaces 4 separate calls) |
| `build_embeddings` | Compute local vector embeddings (enables `semantic_search`) — incremental |
| `semantic_search` | Find code by **meaning**, not name |

### 3. Semantic search — find code by meaning

```bash
npx code-graph-indexer embed   --root .          # compute embeddings (one-time / incremental)
npx code-graph-indexer query semantic --query "logic that decides who can access a record" --root .
```

- Local model **`Xenova/all-MiniLM-L6-v2`** (384-dim) via [transformers.js](https://github.com/xenova/transformers.js) — **runs on your machine, no API key, no data leaves the box**.
- **Optional dependency**: if the model isn't installed, semantic queries gracefully fall back to lexical search (with a hint). Embeddings are **incremental** — only changed nodes are re-embedded.

### 4. HTTP + WebSocket server — live graph for tools / UIs

```bash
npx code-graph-indexer serve --root /path/to/repo --port 3002
# 🔭 http://127.0.0.1:3002  — indexes on boot, then watches for file changes and pushes updates over WS
```

Exposes a REST + WebSocket API (graph reads, queries, and `POST /api/chat` — see below). **Bound to `127.0.0.1` only; endpoints are unauthenticated and mutating — never expose off-host.**

### 5. 3D web explorer + chatbot (in the repo)

The [source repo](https://github.com/Nishant-Chaudhary5338/mcp-code-indexer) ships a **React + Three.js web explorer** that connects to the `serve` WebSocket:

- **3D force-directed graph** (and a fast **2D canvas** mode) — drill down by folder, filter by node/edge type, hover to trace a node's neighbours, color by type or health, and light up a node's **blast radius**.
- **Built-in chatbot** — ask questions about the codebase in natural language. It shells out to your **local `claude` CLI** (no API key) with a heuristic fallback, grounded in the graph.

```bash
# from a clone of the repo
pnpm install && pnpm build
pnpm serve --root /path/to/your/repo    # data server (port 3002)
pnpm ui                                 # 3D explorer (Vite dev server)
```

> The web UI lives in the repo, not the npm package — `npx code-graph-indexer serve` gives you the API the UI talks to.

---

## Programmatic API

```ts
import { runFullIndex, IndexerSession } from 'code-graph-indexer';
import { queryWhoRenders, queryBlastRadius, queryGraph } from 'code-graph-indexer';
import { createIndexerApp } from 'code-graph-indexer/serve';   // mountable Express app + WS
import { CodeIndexerServer } from 'code-graph-indexer/mcp';     // the stdio MCP server class
import type { GraphSnapshot } from 'code-graph-indexer/core';   // the schema / contract
```

---

## How it works

1. **Discover** the workspace — detect monorepo vs standalone, enumerate packages/apps.
2. **Parse** each package with `ts-morph` (syntactic pass — no type-checker, lib files skipped for speed/memory), enforcing a per-package file budget so a pathological package can't make indexing unbounded.
3. **Extract** nodes (files, components, functions) and **resolve** edges through the TypeScript module/symbol resolver (path aliases, re-exports, workspace deps).
4. **Persist** to `.code-graph/graph.json`; optionally compute embeddings to a sidecar.
5. **Serve** the graph to the CLI, MCP, HTTP/WS, and UI — all reading the same persisted snapshot.

---

## Performance & limits

- **Large monorepos:** `index` and `embed` automatically re-exec with an 8 GB heap so a big repo doesn't OOM at Node's default limit. Opt out with `CODE_INDEXER_NO_REEXEC=1`, or set your own `--max-old-space-size`.
- **Per-package file budget** keeps a single huge package from dominating; excess files are dropped deterministically with a warning.
- **Incremental** indexing (`--incremental`) and incremental embeddings re-process only what changed.

---

## Requirements

- **Node ≥ 20.19**
- Optional: a local **`claude` CLI** for the AI chat/summary features (heuristic fallback otherwise), and the **transformers.js** model for semantic search (lexical fallback otherwise).

## License

MIT © Nishant Chaudhary
