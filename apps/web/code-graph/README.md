# code-graph — the 3D explorer

The browser front-end for the code graph. It is a **pure consumer of the API**:
it fetches `GET /api/graph` once, then applies live `GraphPatch`es over `WS /ws`
as you edit files. It holds no analysis logic of its own — if something looks
wrong here, the bug is usually upstream in the engine.

```bash
pnpm serve --root .   # :3002 — server + the pre-built bundle (what npx ships)
pnpm ui               # :5182 — Vite dev server with HMR, proxying to :3002
```

Use `pnpm ui` when you're working on the UI; `pnpm serve` when you want the
thing users actually get.

## The idea

A codebase is a graph, but nobody can hold one in their head. So: draw it,
let people drill from repo → app → package → file → symbol, and make the
questions that normally cost five file reads into one click.

Selecting a node doesn't just highlight it — it **answers something**.
Blast radius lights up everything downstream. Hover traces neighbours. Colour
encodes type-health, so a package that stopped compiling is visible before you
open it.

## Getting around

| Key / action | What happens |
| --- | --- |
| `⌘K` / `Ctrl-K` | Command palette — search every node by name or path, then `↑` `↓` `Enter` |
| `Esc` | Close the palette, then clear selection |
| Click a node | Select it; the detail panel loads its source, status and AI summary |
| Double-click a folder/package | Drill into it; breadcrumbs walk back out |
| Blast-radius toggle | Highlight everything that transitively depends on the selection |

There's a 2D renderer alongside the 3D one (`GraphCanvas2D`) — it's the honest
choice on a large graph or a tired laptop, and it's the same data.

## Layout

```
src/
├── App.tsx                  shell, keyboard wiring, layout
├── store/graphStore.ts      Zustand — the single source of truth (see below)
├── api/{client,ws}.ts       REST + WebSocket; the only code that talks to :3002
├── lib/graph-model.ts       API shape → render shape (nodes, links, positions)
├── lib/graph-style.ts       colour + size encoding — type, health, selection
└── components/
    ├── Graph/               GraphCanvas (3D) · GraphCanvas2D · GraphView switch
    ├── CommandPalette/      ⌘K surface
    ├── Rail/  Toolbar/      filters, view controls, legend, live status, export
    ├── DetailPanel/         source preview, status badges, AI knowledge
    ├── Chat/                ask-the-codebase panel, grounded in the graph
    └── RepoPicker/  DrillDown/  Onboarding/
```

**`graphStore.ts` is where to start reading.** Everything flows through it —
`load` and `bootstrap` bring the graph in, `applyPatch` folds in live updates,
`drillInto` / `drillTo` / `goHome` move the camera and the visible subgraph, and
`runQuery` is how reverse queries reach the server. If you're adding a feature,
you are almost certainly adding an action here first.

## Working on it

- **Render shape is derived, never stored twice.** `graph-model.ts` maps the API
  payload into what the force graph wants. Don't scatter that mapping into
  components.
- **All styling decisions live in `graph-style.ts`.** One place decides what a
  node's colour means, so the legend can't drift from the canvas.
- **Live updates are patches, not reloads.** A file save produces a `GraphPatch`
  over the socket; re-fetching the whole graph on every keystroke was the thing
  this design exists to avoid.

Tests cover `lib/` (the pure mapping and analysis). The store and components
aren't covered yet — that's the honest gap if you're looking for somewhere
useful to contribute.

## Design history

The visual language (ember accent, teal signal, neutral ramp, spring timings)
came from a design brief that also proposed porting this explorer into another
codebase. That port didn't happen here, but sections B and D of
[`docs/archive/EXPLORER_REDESIGN.md`](../../../docs/archive/EXPLORER_REDESIGN.md)
still describe the rules this UI follows.
