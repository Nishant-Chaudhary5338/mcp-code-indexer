# code-graph-indexer

**Turn any TypeScript / React / Next.js repo into a code graph you can query from the CLI, hand to an AI agent over MCP, or explore in a 3D web view — with a built-in chatbot that answers questions about your codebase.**

One command gets you the whole thing:

```bash
npx code-graph-indexer ui --root .
```

That indexes the current repo, starts a local server, and prints a URL. Open it and you're looking at your codebase as a live 3D graph — folders, files, components, functions, and the imports/calls/renders between them — with a chat panel wired to the graph.

Everything is built on [`ts-morph`](https://ts-morph.com) (the real TypeScript compiler), so relationships are **resolved, not grepped**. Edges are conservative: one is drawn only when it resolves to a real indexed node. You get *no* edge rather than a *wrong* one.

---

## Why it exists

When you — or your AI agent — ask *"what breaks if I change this function?"*, the usual move is to read a pile of files into context and guess. It's slow, it burns tokens, and it still misses things.

A code graph flips that around:

| Question | Without a graph | With `code-graph-indexer` |
| --- | --- | --- |
| "What calls `format()`?" | grep the repo, read every hit, hope | `who_calls` → exact callers, resolved by the compiler |
| "What breaks if I change this?" | read N files, reason, miss edge cases | `blast_radius` → the full transitive impact set |
| "Where's the auth logic?" | open files until you find it | `semantic_search "logic that decides access"` |
| "Give me enough to edit this safely" | 4–5 separate file reads | `get_context_pack` → one dense bundle |

The payoff is real on three fronts:

- **Fewer tokens.** A single graph query returns just the relevant nodes — usually a few hundred tokens instead of tens of thousands. `get_graph` is token-safe by default: on a big repo it returns a compact summary unless you explicitly ask for the whole thing.
- **Faster answers.** The graph is computed once and cached to `.code-graph/graph.json`. Queries are lookups over an in-memory graph — milliseconds, not a fresh repo scan every time you ask.
- **Correct, not approximate.** Edges come from the TypeScript module and symbol resolver, so `@/*` path aliases, re-exports, and monorepo `workspace:*` deps all resolve. `who_calls` and `blast_radius` don't hallucinate.

### Faster, cheaper, more reliable — at a glance

Estimated cost of the same question with an agent reading files versus one graph query (typical mid-size repo):

| What you ask | Agent alone (read files) | With `code-graph-indexer` | You save |
| --- | --- | --- | --- |
| "What calls `format()`?" | ~30k tokens · ~40s | ~0.4k tokens · <1s | **~99% tokens** |
| "What breaks if I change this?" | ~50k tokens · ~60s *(and misses edges)* | ~0.6k tokens · <1s *(exact)* | **~99% tokens** |
| "Where's the code that does X?" | ~25k tokens · ~30s | ~0.3k tokens · ~2s | **~98% tokens** |
| "Context to edit this safely" | ~40k tokens · ~50s *(5 reads)* | ~0.8k tokens · <1s *(1 call)* | **~98% tokens** |
| "Any dead code or cycles?" | ~60k tokens · manual audit | ~0.5k tokens · instant | **~99% tokens** |

**Faster** (in-memory lookups, not re-reads) · **cheaper** (fewer tokens = lower bill) · **reliable** (compiler-resolved edges — no hallucinated callers, no missed impact).

---

## What it understands

**Nodes:** `repo` · `app` · `package` · `folder` · `file` · `component` · `function` · `external` (third-party)
**Edges:** `contains` · `imports` · `calls` · `renders` · `references` · `depends-on`

Every node also carries metrics (lines of code, exports), optional health status, and git metadata.

It works on:

- **TypeScript & JavaScript** — `.ts` / `.tsx` / `.js` / `.jsx`
- **React** — components and their `renders` graph (who renders what)
- **Next.js** — App Router *and* Pages, standalone or inside a monorepo
- **Monorepos** — Turborepo, pnpm / npm / yarn workspaces, Lerna, with cross-package `depends-on` edges resolved through `workspace:*`
- **Plain single-package repos** — including ones that carry a `pnpm-workspace.yaml` only for config

---

## The five ways to use it

### 1. The 3D explorer + chatbot — `ui`

```bash
npx code-graph-indexer ui --root .        # index, serve, and print the explorer URL
npx code-graph-indexer ui --root . --port 4000
```

Open the printed URL and you get:

- A **3D force-directed graph** (with a fast **2D** mode too). Drill down through folders, filter by node and edge type, hover a node to trace its neighbours, color by type or health, and light up any node's **blast radius**.
- A **chatbot** grounded in the graph. Ask it anything about the codebase in plain English and it answers with citations back to the nodes it used.

The UI ships **inside this package** — no separate clone or build step. `serve` (below) starts the same server without the friendly banner if you just want the API.

> The server binds to `127.0.0.1` only. Its endpoints are unauthenticated and can mutate the graph, so don't expose it off your machine.

**Chatbot auth, in order of preference — all optional:**

1. Paste an Anthropic API key into the chat panel (kept in your browser, sent per request, never stored on the server), **or**
2. Have the [`claude` CLI](https://docs.claude.com/en/docs/claude-code) installed and logged in — the server shells out to it, no key needed, **or**
3. Set `ANTHROPIC_API_KEY` in the server's environment.

With none of those, chat still works — it falls back to a keyword match over the graph and tells you how to upgrade to real answers.

### 2. MCP server — let Claude / Cursor query your code

Register the stdio server once:

```bash
claude mcp add code-graph -- npx -y code-graph-indexer mcp
```

```jsonc
// …or drop it in a project .mcp.json (Claude Code + Cursor auto-load it)
{
  "mcpServers": {
    "code-graph": { "command": "npx", "args": ["-y", "code-graph-indexer", "mcp"] }
  }
}
```

Your agent gets **14 tools** — it can resolve rough names to real ids, trace impact, and pull edit-ready context without dumping files into its window:

| Tool | What it answers |
| --- | --- |
| `index_repo` | Build the graph and cache it to `.code-graph/graph.json` |
| `get_graph` | Read the graph — token-safe (summary on large repos unless `full:true`; narrow with `type`/`depth`/`lean`/`fields`) |
| `get_node` | Read one node by id |
| `who_renders` | Which components render this one (incoming `renders`) |
| `who_calls` | Which symbols call this function/component (incoming `calls`) |
| `find_references` | All incoming references, optionally filtered by edge type |
| `blast_radius` | Everything that transitively depends on a node — the impact if it changes |
| `find_cycles` | Import / render / call cycles |
| `find_orphans` | Dead-code candidates (nothing imports, renders, or calls them) |
| `search_nodes` | Fuzzy-find nodes by name or path → canonical id |
| `get_context_pack` | One dense bundle to edit a node safely: source + dependencies + dependents + blast size |
| `build_embeddings` | Compute local vector embeddings (enables `semantic_search`) — incremental |
| `semantic_search` | Find code by meaning, not name |
| `open_explorer` | Start the 3D web explorer and return its URL — for "show me this visually" |

`open_explorer` is what lets an agent open the graph for you: ask it to visualize the codebase and it starts the server and hands back a URL to click.

### 3. CLI — index & query by hand

```bash
# Build (or refresh) the graph → <root>/.code-graph/graph.json
npx code-graph-indexer index --root .
npx code-graph-indexer index --root . --incremental        # only re-parse changed files

# Ask questions (add --json to any query for machine-readable output)
npx code-graph-indexer query who-calls       --id "fn:src/util.ts#format"     --root .
npx code-graph-indexer query blast-radius     --id "fn:src/util.ts#format"     --root .
npx code-graph-indexer query who-renders      --id "cmp:src/Button.tsx#Button" --root .
npx code-graph-indexer query find-references  --id "cmp:src/Button.tsx#Button" --types renders,imports --root .
npx code-graph-indexer query find-cycles      --root .
npx code-graph-indexer query orphans          --root .                          # dead-code candidates
npx code-graph-indexer query search           --query useAuth                   --root .
npx code-graph-indexer query semantic         --query "code that validates a token" --root .
npx code-graph-indexer query graph            --root . --summary
npx code-graph-indexer query context          --id "fn:src/util.ts#format"     --root .

# CI health gate: fail the build on cycles / orphans
npx code-graph-indexer check --root . --max-cycles 0 --fail-on-orphans
```

> Node ids are stable and predictable: `cmp:<path>#<Name>` (component), `fn:<path>#<name>` (function), `file:<path>` (file). Don't know an id? Use `search` (by name) or `semantic` (by meaning) to resolve one.

### 4. Semantic search — find code by meaning

```bash
npx code-graph-indexer embed --root .        # compute embeddings (one-time, then incremental)
npx code-graph-indexer query semantic --query "logic that decides who can access a record" --root .
```

Runs the local **`Xenova/all-MiniLM-L6-v2`** model (384-dim) via [transformers.js](https://github.com/xenova/transformers.js) — on your machine, no API key, nothing leaves the box. It's an optional dependency: if the model isn't installed, semantic queries fall back to lexical search with a hint. Embeddings are incremental — only changed nodes get re-embedded.

### 5. HTTP + WebSocket server — `serve`

```bash
npx code-graph-indexer serve --root . --port 3002
```

The same server the `ui` command runs, minus the explorer banner. It indexes on boot, watches for file changes, and pushes live updates over WebSocket. Endpoints cover graph reads, the reverse queries, and `POST /api/chat`. Same rule as `ui`: `127.0.0.1` only, don't expose it off-host.

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

1. **Discover** the workspace — monorepo vs standalone, enumerate packages and apps.
2. **Parse** each package with `ts-morph` (a syntactic pass — no type-checker, lib files skipped for speed and memory), with a per-package file budget so one pathological package can't make indexing run away.
3. **Extract** nodes (files, components, functions) and **resolve** edges through the TypeScript module/symbol resolver — path aliases, re-exports, workspace deps.
4. **Cache** to `.code-graph/graph.json`, optionally with an embeddings sidecar.
5. **Serve** the same snapshot to the CLI, MCP, HTTP/WS, and the 3D UI.

---

## Performance & limits

- **Large monorepos:** `index` and `embed` re-exec once with an 8 GB heap so a big repo doesn't OOM at Node's default limit. Opt out with `CODE_INDEXER_NO_REEXEC=1`, or set your own `--max-old-space-size`.
- **Per-package file budget** stops a single huge package from dominating; excess files are dropped deterministically with a warning.
- **Incremental** indexing (`--incremental`) and incremental embeddings only re-process what changed.
- **The web bundle** adds ~1.8 MB (mostly three.js) to the install. If you only ever use the CLI or MCP, it just sits unused.

---

## Requirements

- **Node ≥ 20.19**
- Optional: the local **`claude` CLI** for zero-key AI chat, and the **transformers.js** model for semantic search. Both degrade gracefully when absent.

## License

MIT © Nishant Chaudhary
