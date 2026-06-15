# Explorer Redesign — Code-Graph Viewer → `/explorer` in the MCP Toolkit Client

> **Status:** Design spec (ground-up redesign + merge). **Owner:** FE.
> **Source app:** `mcp-indexer/apps/web/code-graph` (React 19 · Vite · Tailwind v4 · Zustand · `react-force-graph-3d` · three).
> **Target app:** `mcp-toolkit/client` (React 19 · Vite · Tailwind v4 · Zustand · three · `@react-three/fiber` · `@react-three/drei` · framer-motion · react-markdown · lucide).
> **Backend:** code graph + live WS + per-node AI + query endpoints under `/indexer/api` + `/indexer/ws`.
> **Audience:** senior FE engineer (three/r3f, GSAP, Framer Motion). Build for parallel implementation.

This document is the implementer's brief. It is opinionated on purpose. Where it says "port," port; where it says "rebuild," rebuild. Sources for reference UIs are cited inline and collected at the end.

---

## A. Vision & design principles

**The one-liner.** _A keyboard-first, cinematic map of a codebase that answers "what's here, what touches what, and what breaks if I change this" — without reading a single file._

The current viewer (`apps/web/code-graph`) already proves the hard parts: drill-down by `contains`, hover-trace neighbours, blast-radius overlay, cycle detection, live WS patches, ⌘K node search, AI knowledge per node (see `App.tsx`, `GraphCanvas.tsx`, `graphStore.ts`). It looks good. But it is a **standalone tool with a violet/indigo palette** that does not belong to the published toolkit, and its shell (header + single right panel + floating chat) is functional rather than _designed_. We keep the proven graph engine and rebuild everything around it to the toolkit's bar.

### Design principles (the rubric every PR is judged against)

1. **The graph is the product; chrome recedes.** Sourcegraph's redesign reduced non-essential UI to focus on code ([Sourcegraph](https://sourcegraph.com/blog/introducing-sourcegraphs-new-ui)). Panels are glass over the canvas, never opaque walls beside it. Dim, don't delete.
2. **Keyboard is the spine, pointer is the garnish.** ⌘K is not a search box — it is the command surface (Linear/Raycast/Vercel pattern: invoke, type, one keystroke to act — [techinterview](https://www.techinterview.org/post/3233475212/build-command-palette-cmd-k/)). Every action has a key.
3. **Motion is meaning, never decoration.** Springs that carry velocity, ~200-280ms, ease-out. Emil Kowalski: keep durations ≤0.3–0.4s, bounce subtle (0.1–0.3), no bounce in most UI ([ui-skills](https://www.ui-skills.com/skills/emilkowalski/emil-design-eng/)). Camera moves _tween_ the user's attention from A to B; they never teleport.
4. **Restraint (Rams/Ive).** One accent that _means execution_ (ember `#FF6A2B`), one signal hue that _means data-in-motion_ (teal `#3FD9C4`). Everything else is a neutral ramp. Color encodes type/health, not vibe.
5. **Answer-first.** Reverse queries (who-renders / who-calls / find-references / blast-radius) are not buried in a menu — selecting a node _shows you the answer in the graph_ and summarises it in the panel.
6. **Honest at every state.** Empty, loading, error, offline-WS, huge-graph, mobile — each is designed, not a spinner. The current app already does this for empty/error (`App.tsx` lines 66–120); we extend that discipline everywhere.
7. **It must survive a 5,000-node repo.** "The hairball" past ~200 nodes is the canonical failure of force graphs ([Obsidian critique](https://codeculture.store/blogs/developer-culture/obsidian-graph-view-useful)). Semantic zoom + drill-down + clustering are not P2 polish — they are load-bearing.

---

## B. Visual language

The toolkit client already ships a complete, tasteful token system in `mcp-toolkit/client/src/index.css` (ember/signal/neutral ramp, Geist + Geist Mono, radii, elevation, easings, film grain + radial wash background). **We adopt it wholesale and retune the graph palette to it.** No second design system.

### B.1 Color system (dark-first; light is P2)

**Inherited from the toolkit (do not redefine — import):**

| Token                                            | Value                                             | Role                                   |
| ------------------------------------------------ | ------------------------------------------------- | -------------------------------------- |
| `--color-bg`                                     | `#08090A`                                         | page (canvas clear color too)          |
| `--color-bg-subtle`                              | `#0C0D0F`                                         | inset wells                            |
| `--color-surface-1/2/3`                          | `#111214` / `#16181B` / `#1C1F23`                 | panels, raised, hover                  |
| `--color-surface-inset`                          | `#050506`                                         | graph backdrop wash                    |
| `--color-border-subtle/border/strong`            | `#1A1C1F` / `#25282D` / `#34383E`                 | hairlines                              |
| `--color-text` / `secondary` / `muted` / `faint` | `#F2F3F5` / `#9DA2A9` / `#6B7079` / `#474B52`     | text ramp                              |
| `--color-ember` (+ `-bri` `-deep`)               | `#FF6A2B` / `#FF8C5A` / `#E8551A`                 | **selection / focus / execution**      |
| `--color-signal` (+ `-bri`)                      | `#3FD9C4` / `#67ECDA`                             | **edges-in-motion / live / particles** |
| `--color-ok/info/warn/err/run`                   | `#46D88A` `#5B9DFF` `#F5B544` `#F2606A` `#45C7D6` | health + log states                    |

**Retuned graph palette (replaces `graph-style.ts` violet set).** The old viewer used a violet accent (`#a78bfa`) and a rainbow type ramp. We re-map node types onto the toolkit's already-defined `categoryColors` family so the explorer and the tool catalog feel like one product:

```ts
// explorer/lib/graph-tokens.ts  — replaces TYPE_COLOR / HEALTH_COLOR / EDGE_COLOR
export const TYPE_COLOR: Record<NodeType, string> = {
  repo: '#F2F3F5', // text — the root, neutral & bright
  app: '#5B9DFF', // info blue — an application surface
  package: '#46D88A', // ok green — a unit that builds
  folder: '#6B7079', // muted — structural, recedes
  file: '#9DA2A9', // secondary — the default grain
  component: '#FF6A2B', // EMBER — the thing you render (the star)
  function: '#C792EA', // violet — behaviour (kept; reads as "logic")
};

export const HEALTH_COLOR: Record<HealthLevel, string> = {
  ok: '#46D88A', // --color-ok
  warn: '#F5B544', // --color-warn
  error: '#F2606A', // --color-err
  unknown: '#474B52', // --color-text-faint
};

// Edges read as light, low-alpha threads; only the active type lights up.
export const EDGE_COLOR: Record<EdgeType, string> = {
  contains: 'rgba(71,75,82,0.22)', // faint — usually drilled away
  imports: 'rgba(157,162,169,0.30)', // text-muted thread
  references: 'rgba(107,112,121,0.22)',
  renders: 'rgba(63,217,196,0.45)', // SIGNAL teal — UI composition
  calls: 'rgba(255,140,90,0.42)', // ember-bri — behaviour flow
  'depends-on': 'rgba(91,157,255,0.45)', // info blue — package graph
};

export const SELECTED_COLOR = '#FF6A2B'; // ember (was indigo-white)
export const TRACE_COLOR = '#67ECDA'; // signal-bri (hover-trace halo)
export const IMPACT_COLOR = '#F2606A'; // err red — blast radius = danger, now honest
export const CYCLE_COLOR = '#F5B544'; // warn — cycle members
export const DIMMED_COLOR = '#1C1F23'; // surface-3 — backgrounded nodes
```

> **Rationale for the impact recolor:** the old viewer used magenta for blast-radius "so it doesn't read as alarm" (`graph-style.ts` comment). In the toolkit's vocabulary, blast radius _is_ the alarm — `err` red is correct and the palette already separates warn (amber, cycles) from err (red, impact). Magenta is retired.

**Node visual encoding** (two switchable channels, like today's `colorMode`):

- **By type** (default): color = `TYPE_COLOR`, size = `log10(loc | childCount*30)` (keep `nodeSize()` from `graph-style.ts`, it's well-tuned).
- **By health**: color = `HEALTH_COLOR`; pair with an icon/ring so it never relies on hue alone (WCAG 1.4.1). `error` nodes get a thin pulsing ring.
- **Selection** = ember core + ember bloom + ember ring. **Hover-trace** = node and neighbours keep color, everyone else → `DIMMED_COLOR`, traced _edges_ light to `TRACE_COLOR` (this logic exists in `GraphCanvas.tsx` `isHighlit`/`linkHot` — port verbatim, swap colors).

### B.2 Typography

Inherit the toolkit faces — **Geist** (sans) + **Geist Mono**. The rule from the old viewer holds and is _correct_: **all code identifiers render mono** (node names, paths, ids, citations). Adopt the toolkit's `.overline` (uppercase, tracked, mono) for panel section headers, replacing the old `text-xs uppercase tracking-wide` ad-hoc style in `DetailPanel.tsx`.

| Use                     | Class / spec                                                |
| ----------------------- | ----------------------------------------------------------- |
| Panel title (node name) | `font-mono text-sm font-semibold text-text`                 |
| Section header          | `.overline` (existing util)                                 |
| Body / metadata         | `text-[13px] text-text-secondary`, labels `text-text-muted` |
| Path / id / code        | `font-mono text-[12px] text-text-muted`, tabular-nums       |
| Numbers/counts          | tabular-nums (already body default)                         |

### B.3 Spacing, elevation, glass

Use the toolkit radii (`--radius-sm..xl`) and shadows (`--shadow-e1..e3`, `--shadow-accent`). **Panels are glass, tuned to the toolkit, not the old viewer's violet glass.** Replace the old `.glass`/`.animate-panel` in code-graph `index.css` with:

```css
/* explorer-shell.css — glass tuned to the toolkit dark surfaces */
.explorer-glass {
  background: rgba(17, 18, 20, 0.72); /* surface-1 @ 72% */
  backdrop-filter: blur(20px) saturate(140%);
  border: 1px solid var(--hairline); /* rgba(255,255,255,.075) */
  box-shadow: var(--shadow-e3);
}
.explorer-glass--inset {
  box-shadow:
    inset 1px 0 0 0 var(--hairline),
    var(--shadow-e2);
}

/* Canvas atmosphere — retune the old graph-vignette to ember/signal, not indigo */
.explorer-vignette {
  background:
    radial-gradient(ellipse 70% 55% at 50% 40%, rgba(255, 106, 43, 0.05), transparent 70%),
    radial-gradient(ellipse 60% 50% at 70% 80%, rgba(63, 217, 196, 0.035), transparent 65%),
    radial-gradient(ellipse at center, transparent 42%, rgba(0, 0, 0, 0.55) 100%);
}
```

**Elevation ladder:** canvas (z0) → vignette (z1, no-pointer) → minimap / controls / breadcrumb (z10, glass e2) → side panels (z20, glass e3) → command palette + modals (z40, e3 + scrim). Mirrors the toolkit's nav (`z-50`, `backdrop-blur-[16px] saturate-150`).

---

## C. Information architecture & layout

### C.1 Routing & merge

The toolkit client is currently a **single-page marketing site** (`App.tsx` renders `NavBar / Hero / Architecture / ToolCatalog / Workflows / Footer`, anchor-scroll nav). The explorer is a _full-bleed app_, not a section. **Introduce client routing** (`react-router-dom`, the one new dep) with two top-level shells:

```
/                 → existing marketing site (unchanged)
/explorer         → ExplorerShell  (full-viewport, own chrome, no marketing NavBar/Footer)
/explorer/:repo            → repo selected
/explorer/:repo/n/:nodeId  → node focused + selected (shareable deep link)
/explorer/:repo/q/:query   → a saved reverse-query view (e.g. who-renders:cmp:…)
```

`NavBar.tsx` gains one link — **"Explorer"** — that routes (not anchor-scrolls). The explorer shell renders its _own_ slim top bar (wordmark + breadcrumb + live + ⌘K), never the marketing nav. State lives in the URL (focus, selection, query, 2D/3D, colorMode) so any view is a copy-pasteable link.

### C.2 The shell (desktop ≥1024px)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ◧ MCP Toolkit · Explorer   repo ▸ app ▸ src ▸ components   ● live 2s   ⌘K Find │  56px top bar (glass e2)
├──────────────────────────────────────────────────────────────────────────────┤
│ ┌────────────┐                                                  ┌────────────┐ │
│ │ FILTERS    │                                                  │  DETAIL    │ │
│ │ (collapsi- │                                                  │  PANEL     │ │
│ │  ble rail) │              ●───────●                           │            │ │
│ │            │             ╱         ╲          THE GRAPH       │ Component  │ │
│ │ ▸ Type     │            ●  focus    ●         (full-bleed,    │ MyButton   │ │
│ │ ▸ Health   │             ╲    ●    ╱          glass panels    │ ──────────  │ │
│ │ ▸ Path     │              ●───────●           float over it)  │ renders ▸  │ │
│ │ ▸ Edges    │                                                  │ calls ▸    │ │
│ │            │                                                  │ refs ▸     │ │
│ │ [2D] [3D]  │   ┌─────────┐                                    │ blast ▸    │ │
│ │ type|health│   │ minimap │                       ⊕ ⊙ ? ⤢      │ AI summary │ │
│ └────────────┘   └─────────┘                       view-controls└────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
   ↑ left rail 264px, collapsible to 48px icon rail   right panel 360px, dismissible
```

- **Left rail (Filters + view mode).** New. Type/health/path filters, edge-type toggles, 2D⇄3D toggle, color-mode toggle. Collapses to a 48px icon rail (icons only) and is hidden entirely <1024px (moves into a ⌘K-reachable sheet). Replaces today's header-crammed `Legend` + `ModeToggle`.
- **Center: the graph.** Full-bleed `GraphCanvas` (ported). Floating, glass: breadcrumb (top-left, port `Breadcrumbs`), view-controls (bottom-right, port `ViewControls`: home/recenter/help + new fit/2D-3D), **minimap** (bottom-left, P1), onboarding hint (port `OnboardingHint`).
- **Right: Detail panel.** Redesigned `DetailPanel` — node metadata, **reverse-query action rows** (new: who-renders / who-calls / find-references / blast-radius / cycles, each runs a graph query and paints the result), source preview (new), AI summary + inline chat (merge today's separate floating `ChatPanel` _into_ the panel as a tab). Slides from right (spring), dismissible with `Esc`/`×`.

### C.3 Responsive / mobile

3D force graphs are heavy on phones. Strategy:

- **≥1024px:** full shell as above, 3D default.
- **768–1023px:** left rail → off-canvas sheet (⌘K or a filter button); detail panel becomes a bottom sheet (Vaul-style drag-to-dismiss, Emil's drawer pattern); 2D default, 3D opt-in.
- **<768px:** **2D-only** (force the `react-force-graph-2d` renderer — same data interface, see §F). Detail = full-screen bottom sheet. Reuse the toolkit's existing mobile menu motion (`NavBar.tsx` `AnimatePresence` slide). Onboarding nudges "rotate to explore in 3D on a larger screen."
- WebGL/perf guard: port `ProtocolFlow3D`'s `useFPSGuard` + WebGL-capability check → if `webgl` absent or sustained <25fps, auto-fall to 2D and toast it.

### C.4 The state matrix (every one is designed)

| State                          | Treatment                                                                                                                                                |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **First load / no repo**       | Repo picker centered (glass card): recent repos + "Index a repo…" input → `POST /indexer/api/reindex`.                                                   |
| **Indexing**                   | Center: animated node-constellation forming + live progress (`Indexing your codebase…`, files parsed count from WS). Better than today's bare spinner.   |
| **Empty / single-node**        | Port today's honest empty state (`App.tsx` 102–120): "Nothing to graph yet," Reload.                                                                     |
| **Error**                      | Port today's error state (server-down hint + Retry, `App.tsx` 77–98), restyled to ember.                                                                 |
| **WS disconnected**            | Top-bar live pill turns `idle` grey: "live paused — reconnecting." Auto-retry with backoff; manual "reconnect."                                          |
| **Huge graph (>1500 visible)** | Auto-cluster siblings (§E), show "showing N of M — drill in or filter" affordance, defer particles.                                                      |
| **Onboarding**                 | Port `OnboardingHint`; add a 4-step **guided tour** (§E novel) on first `/explorer` visit, dismiss persisted to localStorage (key `explorer-onboarded`). |
| **AI unavailable**             | Knowledge panel shows heuristic fallback + "AI summary off" (backend already guarantees a heuristic — never a hard dep).                                 |

---

## D. Interaction & motion design

Two motion engines, used for what each is best at:

- **Framer Motion** → all DOM chrome (panels, rails, palette, rows, toasts, badges). Springs.
- **GSAP** → camera choreography + timeline-sequenced reveals (tour, presenter mode, path-trace). The graph's three.js camera is imperative; GSAP tweens it cleanly without fighting React.

### D.1 Spring tokens (Framer Motion) — concrete numbers

```ts
// explorer/lib/motion.ts  — the whole vocabulary, in one place
export const spring = {
  // Panels / drawers — confident, no overshoot (Kowalski: no bounce in UI)
  panel: { type: 'spring', stiffness: 320, damping: 34, mass: 0.9 }, // ~260ms settle
  // Snappy chrome: rows, toggles, badges, hover lifts
  snappy: { type: 'spring', stiffness: 420, damping: 30, mass: 0.7 }, // ~200ms
  // Palette / modal pop — a hint of life, bounce ≈ 0.18
  pop: { type: 'spring', stiffness: 380, damping: 26, mass: 0.8 },
  // Layout shared-element (nav underline, selected-row marker)
  layout: { type: 'spring', stiffness: 500, damping: 40 },
} as const;

export const ease = {
  entrance: [0.16, 1, 0.3, 1] as const, // --ease-entrance (toolkit)
  standard: [0.2, 0, 0, 1] as const, // --ease-standard
  exit: [0.4, 0, 1, 1] as const, // --ease-exit
};
export const dur = { instant: 0.12, fast: 0.18, base: 0.24, slow: 0.32 };
```

> These align with the toolkit's existing easings (`index.css`) and Emil's "≤0.3–0.4s, bounce 0.1–0.3" guidance ([ui-skills](https://www.ui-skills.com/skills/emilkowalski/emil-design-eng/)). The old viewer's CSS press-scale (`scale(0.96)` @ 140ms `cubic-bezier(.22,1,.36,1)`) is already on-brand — keep it as the global button press.

### D.2 Interaction → motion map

| Interaction                          | Motion                                                                                                                                                                                                                                             |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Drill in** (click expandable node) | GSAP camera dolly _toward_ the node (0.6s, `power2.inOut`) as children fade/scale-in (`AnimatePresence`, `pop`). Breadcrumb pushes a crumb (layout spring). Never a hard cut.                                                                      |
| **Drill up / breadcrumb**            | Reverse: camera pulls back, crumb pops off, parent siblings fade in.                                                                                                                                                                               |
| **Select node**                      | Node springs to ember + bloom ramps up (lerp emissive over ~6 frames in `useFrame`); detail panel slides in (`spring.panel`).                                                                                                                      |
| **Hover**                            | 60–100ms in: node lifts (size ×1.15), neighbours stay lit, rest dim to `DIMMED_COLOR` (port `isHighlit`); traced edges light + particle count ↑ (already in `GraphCanvas`). Out: 180ms ease.                                                       |
| **Reverse query** (who-renders etc.) | Matching nodes pulse-in (staggered `snappy`, 20ms stagger), camera `zoomToFit` to result set (0.8s), non-matches dim. Panel shows count + list.                                                                                                    |
| **Blast radius**                     | Impact set lights `IMPACT_COLOR` (red) with a brief expanding shock-ring (GSAP scale 0→1, opacity 1→0, 0.5s) radiating from the source; `zoomToFit` to set. (Today's reframe-on-impact lives in `GraphCanvas` lines 165–172 — keep, add the ring.) |
| **Live WS patch**                    | Changed nodes flash a 1-frame signal-teal halo then settle (don't disturb layout — today's `applyPatch` already mutates in place; add the flash). Top-bar live pill ticks "updated now."                                                           |
| **2D⇄3D toggle**                     | Crossfade the canvas (0.3s opacity) while re-mounting renderer; preserve focus/selection; camera resets to fit.                                                                                                                                    |
| **Open ⌘K**                          | Scrim fades (0.12s), palette pops (`spring.pop`) from `scale 0.96 → 1`, `y: -8 → 0`. Results stagger in 12ms.                                                                                                                                      |
| **Panel section expand**             | `layout` height spring + content fade.                                                                                                                                                                                                             |

### D.3 Camera (three.js / GSAP)

Wrap the imperative `fgRef.current.cameraPosition()` in a `useCameraDirector` hook that GSAP-tweens position + lookAt target. Replace the current instant `zoomToFit(800,…)`/`cameraPosition(…,800)` calls (`GraphCanvas.fitView`) with director moves so _every_ framing is a choreographed move, easable and interruptible (springs keep velocity on interrupt — [Maxime Heckel](https://blog.maximeheckel.com/posts/the-physics-behind-spring-animations/)). Keep the existing "user moved → stop auto-fit" guard (`userMovedRef`) so we never fight the user.

### D.4 Reduced motion

Honor `prefers-reduced-motion` (both apps already strip animations in `index.css`). In reduced mode: camera _cuts_ instead of dollies, panels appear without slide, particle/bloom disabled, shock-rings off, stagger → 0. All information remains; only the motion is removed.

---

## E. Feature set

### E.1 Prioritized table

| #   | Feature                                        | P      | Notes / source-of-truth                                                                                              |
| --- | ---------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------- |
| 1   | Drill-down by `contains` + breadcrumbs         | **P0** | Port `visibleGraph` / `Breadcrumbs` / `drillInto` (proven).                                                          |
| 2   | Hover-trace neighbours (dim rest, light edges) | **P0** | Port `isHighlit`/`linkHot` from `GraphCanvas`.                                                                       |
| 3   | Select → detail panel (metadata + status)      | **P0** | Redesign `DetailPanel`.                                                                                              |
| 4   | ⌘K command palette (search + actions)          | **P0** | Rebuild on the toolkit's motion; extend beyond search → commands.                                                    |
| 5   | Live WS patches + live pill                    | **P0** | Port `ws.ts` + `applyPatch`; repoint to `/indexer/ws`.                                                               |
| 6   | Repo picker + (re)index trigger                | **P0** | `POST /indexer/api/reindex`, recents in localStorage.                                                                |
| 7   | URL/state sharing (deep links)                 | **P0** | Router + URL-synced store (§C.1).                                                                                    |
| 8   | 2D⇄3D toggle                                   | **P1** | Add `react-force-graph-2d`; shared data interface.                                                                   |
| 9   | Type / health / path filters                   | **P1** | New left rail.                                                                                                       |
| 10  | Edge-type toggles (show/hide per type)         | **P1** | New; filters visible links.                                                                                          |
| 11  | Color mode: type ⇄ health                      | **P1** | Port `colorMode`; restyle legend.                                                                                    |
| 12  | Reverse queries shown visually                 | **P1** | who-renders / who-calls / find-references via `/indexer/api`; paint results (§D.2).                                  |
| 13  | Blast radius + cycle viz                       | **P1** | Port `analysis.ts` (blastRadius/findCycles) **or** call backend blast-radius/cycles endpoints; add shock-ring.       |
| 14  | In-panel source preview                        | **P1** | react-markdown + rehype-highlight (already deps); fetch per-node source from backend.                                |
| 15  | AI summary + chat (in panel)                   | **P1** | Merge `ChatPanel` into detail panel as a tab; port `postKnowledge`.                                                  |
| 16  | Semantic zoom / LOD + clustering               | **P1** | Cluster siblings past a count; label-only at distance (see [arxiv semantic zoom](https://arxiv.org/pdf/1906.05996)). |
| 17  | Minimap                                        | **P1** | 2D top-down projection of current focus set.                                                                         |
| 18  | Settings persistence                           | **P1** | localStorage: colorMode, 2D/3D, filters, onboarded.                                                                  |
| 19  | Accessibility: kbd nav + SR graph alternative  | **P1** | Tab/arrow node traversal; a `<nav>` tree mirror of the graph for screen readers.                                     |
| 20  | Export (PNG / SVG / JSON)                      | **P2** | PNG from canvas, JSON from snapshot, SVG from a 2D render.                                                           |
| 21  | Light theme                                    | **P2** | Toolkit already has a paper surface; derive a light token set.                                                       |

### E.2 Novel standout features (the "wow")

1. **Path-trace between two nodes** _(P1–P2)._ Pick a source node, ⌘K → "Trace to…", pick a target. The shortest dependency path lights up sequentially (GSAP timeline: each hop's edge draws + a signal-teal packet runs it, 120ms/hop — reuse the toolkit's `Packet` curve-runner from `ProtocolFlow3D.tsx` almost verbatim), the rest dims. Answers "how does A reach B?" — the question grep can't. _Justification:_ turns the graph from a picture into a query tool; the packet motion is already in the toolkit's vocabulary.

2. **Impact-preview on hover** _(P1)._ Hovering a node for >400ms ghosts its blast radius (faint red halo on dependents) _without_ committing the full overlay. A pre-commit glance at "what would I break." _Justification:_ makes the most valuable query (blast radius) ambient and zero-click; respects reduced-motion by skipping the delay-reveal.

3. **Snapshot time-travel** _(P2)._ The backend emits a patch on every save. Buffer the last N snapshots client-side; a scrubber (bottom edge, glass) lets you rewind the graph's last edits — nodes that appeared/changed pulse as you scrub. _Justification:_ "what did my last 10 saves do to the structure?" — the live data is already flowing; we just need to retain it.

4. **Diff mode** _(P2)._ Compare two snapshots (e.g. pre/post refactor, or two git states if backend exposes them): added nodes glow ok-green, removed ghost red, changed pulse warn-amber, edges likewise. _Justification:_ the single most-requested code-viz use case (githubnext's repo-viz was built around seeing structural change over time — [githubnext](https://githubnext.com/projects/repo-visualization/)).

5. **Guided tour** _(P1)._ First visit: a 4-beat GSAP-choreographed flythrough — _here's your repo → drill into the app → this component renders these → here's its blast radius_ — camera moves + coachmark callouts, skippable, never auto-repeats. _Justification:_ the graph is unfamiliar; a 20-second cinematic teaches the interaction model better than a tooltip.

6. **Presenter mode** _(P2)._ Full-screen, chrome hidden, larger labels, a saved sequence of focus+query "scenes" you step through with ←/→ (camera tweens between them). For demos, PR walkthroughs, onboarding a teammate. _Justification:_ a published toolkit will be _shown_; make the explorer demo-ready out of the box.

---

## F. Component inventory & file plan

### F.1 PORT vs REBUILD (the recommendation)

| Concern                                                                                   | Decision             | Why                                                                                                                                                     |
| ----------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Force-graph renderer** (`GraphCanvas`, force config, hover-trace, bloom/fog, particles) | **PORT**             | It's proven, tuned, and non-trivial (d3-force-3d config, UnrealBloom, fit logic). Re-skin colors only. Add a sibling 2D renderer behind the same props. |
| **Graph model / analysis** (`graph-model.ts`, `analysis.ts`)                              | **PORT**             | Pure, tested logic (buildIndex, visibleGraph, blastRadius, findCycles, pathToRoot).                                                                     |
| **API/WS client** (`api/client.ts`, `api/ws.ts`)                                          | **PORT + repoint**   | Change base to `/indexer/api` + `/indexer/ws`; add query + source endpoints.                                                                            |
| **Store** (`graphStore.ts`)                                                               | **REBUILD (extend)** | Keep the shape; add filters, query-result, 2D/3D, URL-sync, snapshot buffer.                                                                            |
| **Shell** (`App.tsx` header, layout)                                                      | **REBUILD**          | New routed shell + left rail; toolkit chrome.                                                                                                           |
| **DetailPanel / Chat / palette / toolbar**                                                | **REBUILD**          | Re-skin to toolkit tokens + Framer Motion; merge chat into panel; palette → command surface.                                                            |
| **Color tokens** (`graph-style.ts`, code-graph `index.css`)                               | **REBUILD**          | Retune to toolkit palette (§B).                                                                                                                         |

### F.2 File tree — `mcp-toolkit/client/src/explorer/**`

```
explorer/
  ExplorerShell.tsx              Routed root: top bar + rail + canvas + panels; owns layout grid
  routes.tsx                     /explorer/* route table; URL ⇄ store sync
  ExplorerTopBar.tsx             Slim glass bar: wordmark · breadcrumb · live pill · ⌘K trigger
  graph/
    GraphCanvas.tsx              PORTED 3D renderer (react-force-graph-3d), retuned colors
    GraphCanvas2D.tsx            2D renderer (react-force-graph-2d), same props interface
    GraphView.tsx                Picks 2D/3D by store + viewport; mounts the right canvas
    useCameraDirector.ts         GSAP camera tweens (dolly/fit/scene); wraps fgRef
    useGraphFx.ts                Bloom + fog + rim lights setup (PORTED from GraphCanvas effects)
    useHoverTrace.ts             neighbours map + isHighlit/linkHot (PORTED)
    Minimap.tsx                  2D top-down projection of focus set                    [P1]
  panel/
    DetailPanel.tsx              REBUILT: header + tabs (Info · Source · AI)
    NodeMeta.tsx                 type/path/loc/exports rows
    QueryActions.tsx             who-renders / who-calls / find-references / blast / cycles rows
    SourcePreview.tsx            react-markdown + rehype-highlight fenced source            [P1]
    KnowledgeTab.tsx             AI summary + inline chat (merges old ChatPanel)            [P1]
    StatusBadges.tsx             PORTED
  rail/
    FilterRail.tsx               Collapsible left rail container
    TypeFilter.tsx               node-type checkboxes + legend swatches
    HealthFilter.tsx             health checkboxes
    PathFilter.tsx               path glob/substring filter
    EdgeToggles.tsx              per-edge-type show/hide
    ViewModeToggle.tsx           2D⇄3D + color-mode (type|health)
  overlays/
    Breadcrumbs.tsx              PORTED (drill path)
    ViewControls.tsx             PORTED + fit/2D-3D/help
    CommandPalette.tsx           REBUILT command surface (search + actions + queries)
    LiveStatus.tsx               PORTED live pill (+ disconnect state)
    OnboardingHint.tsx           PORTED first-run tips
    GuidedTour.tsx               GSAP 4-beat intro flythrough                              [P1]
    PresenterMode.tsx            scene-stepping full-screen mode                            [P2]
    TimeScrubber.tsx             snapshot time-travel scrubber                             [P2]
    ExportMenu.tsx               PNG / SVG / JSON                                          [P2]
    SrGraphTree.tsx              screen-reader <nav> tree mirror of the graph
  lib/
    graph-tokens.ts             TYPE/HEALTH/EDGE colors + nodeSize (RETUNED graph-style)
    graph-model.ts              PORTED (buildIndex, visibleGraph, pathToRoot, labels)
    analysis.ts                 PORTED (blastRadius, findCycles)
    cluster.ts                  semantic-zoom clustering (sibling collapse past N)         [P1]
    motion.ts                   spring/ease/dur tokens (§D.1)
    url-state.ts                serialize/parse focus·selection·query·view to URL
  api/
    client.ts                   PORTED+repointed REST (graph, node, source, knowledge, queries)
    ws.ts                       PORTED+repointed WS (GraphPatch stream)
    schemas.ts                  Zod at the edge for every response (REQUIRED)
  store/
    explorerStore.ts            Zustand (shape below)
  explorer.css                  .explorer-glass / .explorer-vignette (§B.3)
```

### F.3 Zustand store shape

```ts
type ExplorerStore = {
  // data
  snapshot: GraphSnapshot | null;
  index: GraphIndex | null;
  state: 'idle' | 'indexing' | 'ready' | 'error';
  error: string | null;
  repo: string | null;

  // navigation
  focusId: string | null; // drill-down root
  selectedId: string | null;
  breadcrumb: GraphNode[]; // derived from pathToRoot, cached

  // view
  renderMode: '2d' | '3d';
  colorMode: 'type' | 'health';
  filters: { types: Set<NodeType>; health: Set<HealthLevel>; path: string };
  edgeVisibility: Record<EdgeType, boolean>;

  // queries / analysis (the visual answers)
  activeQuery: null | {
    kind:
      | 'who-renders'
      | 'who-calls'
      | 'find-references'
      | 'blast-radius'
      | 'cycles'
      | 'path-trace';
    sourceId: string;
    targetId?: string;
    resultIds: Set<string>;
    pathEdgeIds?: string[];
  };
  hoverImpact: Set<string> | null; // impact-preview on hover (novel #2)

  // live
  wsStatus: 'connecting' | 'live' | 'paused';
  lastUpdatedAt: number | null;
  snapshots: GraphSnapshot[]; // ring buffer for time-travel (novel #3)

  // ui
  railCollapsed: boolean;
  panelTab: 'info' | 'source' | 'ai';
  showOnboarding: boolean;
  cameraSignal: number; // bump → director re-fits

  // actions: load, indexRepo, drillInto, drillTo, select, focusOn,
  //   setRenderMode, setColorMode, toggleType/Health/Edge, setPathFilter,
  //   runQuery(kind, ids), clearQuery, previewImpact(id), applyPatch,
  //   generateKnowledge, ask(chat), recenter, goHome, syncFromUrl, toUrl
};
```

> Keep the proven `applyPatch` in-place mutation (`graphStore.ts` 122–138) — it preserves force positions across live edits. Wrap derived values (`breadcrumb`, query result membership) so components don't recompute per frame.

### F.4 API / WS surface (`/indexer`)

```ts
// api/client.ts — all responses Zod-parsed (api/schemas.ts)
GET  /indexer/api/graph                         → GraphSnapshot            // PORTED fetchGraph
GET  /indexer/api/graph?projection=lean&depth=2 → token-safe projection    // for huge repos
GET  /indexer/api/node/:id/source               → { lang, code }           // SourcePreview
POST /indexer/api/node/:id/knowledge            → AISummary                // PORTED postKnowledge
POST /indexer/api/node/:id/chat  { message }    → { reply, citations[] }   // KnowledgeTab
GET  /indexer/api/query/who-renders/:id         → { ids[] }
GET  /indexer/api/query/who-calls/:id           → { ids[] }
GET  /indexer/api/query/find-references/:id     → { ids[] }
GET  /indexer/api/query/blast-radius/:id        → { ids[] }                 // or client analysis.ts
GET  /indexer/api/query/cycles                  → { cycles: string[][] }
POST /indexer/api/reindex { root }              → 202                       // repo picker

WS   /indexer/ws  → GraphPatch  { upsertNodes, removeIds, ... }            // PORTED connectWs
```

Vite dev proxy: `/indexer/api` + `/indexer/ws` → the indexer server (`127.0.0.1:3002`). Mirror the old viewer's `/api`+`/ws` proxy, namespaced under `/indexer` so it can't collide with the toolkit's own API.

---

## G. Phased build plan

Each task names its files for disjoint parallel work.

### Phase P0 — PoC + parity (the explorer _works_, ported, minimally re-skinned)

- [ ] **Routing:** add `react-router-dom`; `routes.tsx`, `ExplorerShell.tsx`; "Explorer" link in `NavBar.tsx`. _(files: routes.tsx, ExplorerShell.tsx, NavBar.tsx)_
- [ ] **Port engine:** `graph/GraphCanvas.tsx`, `graph/useHoverTrace.ts`, `graph/useGraphFx.ts`, `lib/graph-model.ts`, `lib/analysis.ts`. _(disjoint)_
- [ ] **Port data:** `api/client.ts`, `api/ws.ts`, `api/schemas.ts`; Vite proxy → `/indexer`. _(disjoint)_
- [ ] **Store v1:** `store/explorerStore.ts` (load, drill, select, applyPatch, ws). _(1 file)_
- [ ] **Retune tokens:** `lib/graph-tokens.ts`, `explorer.css` (glass + vignette). _(disjoint)_
- [ ] **Minimal chrome:** `ExplorerTopBar.tsx`, `overlays/Breadcrumbs.tsx`, `overlays/LiveStatus.tsx`, `overlays/ViewControls.tsx`, `overlays/OnboardingHint.tsx` (ported, re-skinned). _(disjoint)_
- [ ] **States:** repo picker + indexing/empty/error/loading (in `ExplorerShell`).
- [ ] **Gate:** `tsc -b` clean, Zod at every boundary, deep-link round-trips.

### Phase P1 — redesign + core features

- [ ] **Detail panel rebuild:** `panel/*` (DetailPanel, NodeMeta, QueryActions, SourcePreview, KnowledgeTab, StatusBadges). Merge chat in. _(disjoint within panel/)_
- [ ] **Command surface:** `overlays/CommandPalette.tsx` — search + actions + run-query. _(1 file)_
- [ ] **Filter rail:** `rail/*` (FilterRail, Type/Health/Path filters, EdgeToggles, ViewModeToggle). _(disjoint within rail/)_
- [ ] **2D renderer + toggle:** `graph/GraphCanvas2D.tsx`, `graph/GraphView.tsx`; add `react-force-graph-2d`.
- [ ] **Camera director + motion:** `graph/useCameraDirector.ts`, `lib/motion.ts`; add GSAP.
- [ ] **Visual queries:** wire `QueryActions` → store `runQuery` → canvas paints results (§D.2).
- [ ] **Clustering/LOD:** `lib/cluster.ts` + canvas integration. _(1 file + canvas hook)_
- [ ] **Minimap:** `graph/Minimap.tsx`.
- [ ] **Novel #2 impact-preview** (`store.previewImpact` + canvas) and **#5 guided tour** (`overlays/GuidedTour.tsx`).
- [ ] **A11y:** `overlays/SrGraphTree.tsx` + keyboard node traversal; **settings persistence** (localStorage in store).
- [ ] **URL state:** `lib/url-state.ts` full coverage (focus·selection·query·view).

### Phase P2 — novel + polish

- [ ] **Path-trace** (`runQuery: 'path-trace'`, packet-runner ported from `ProtocolFlow3D`).
- [ ] **Time-travel** (`overlays/TimeScrubber.tsx` + `snapshots` buffer).
- [ ] **Diff mode** (snapshot compare painter).
- [ ] **Presenter mode** (`overlays/PresenterMode.tsx`).
- [ ] **Export** (`overlays/ExportMenu.tsx`: PNG/SVG/JSON).
- [ ] **Light theme** (derive from toolkit paper tokens).
- [ ] **Reduced-motion full pass**, perf budget on 5k-node fixture, polish.

---

## H. Risks & open questions

**Technical risks**

- **Large-graph perf.** Force layout hairballs past ~200 nodes ([Obsidian](https://codeculture.store/blogs/developer-culture/obsidian-graph-view-useful)); WebGL strains >100k nodes ([rfg #202](https://github.com/vasturiano/react-force-graph/issues/202)). _Mitigation:_ drill-down already bounds the visible set to one level's children (`visibleGraph`); add `lib/cluster.ts` + the backend's `projection=lean&depth` to cap payload. **Must test on a 5k-node fixture before P1 sign-off.**
- **WS payload churn.** A save can fan out to importers; large patches could thrash. _Mitigation:_ keep in-place `applyPatch`; debounce flash effects; if `removeIds`/`upsertNodes` > threshold, soft-reload instead of animating each.
- **2D/3D parity.** Two renderers, one props interface — drift risk (hover-trace, sizing, click-to-drill must match). _Mitigation:_ `GraphView` owns the shared prop contract; `useHoverTrace` is renderer-agnostic; one fixture, both renderers in a visual test.
- **Mobile 3D.** WebGL + bloom is rough on phones. _Mitigation:_ `<768px` forces 2D; port `useFPSGuard` to auto-demote; bloom off under threshold.
- **GSAP + React reconciliation.** Imperative camera tweens vs React re-renders. _Mitigation:_ confine GSAP to `useCameraDirector` operating on `fgRef`; never let GSAP touch DOM React owns.
- **New deps.** `react-router-dom`, `gsap` (motion already has framer-motion), `react-force-graph-2d`. Small, justified; confirm bundle budget.

**Human-decision items (need a call before/at P1)**

1. **Blast-radius/cycles: client or server?** `analysis.ts` already computes both client-side from `crossEdges`. Backend also exposes endpoints. _Recommend:_ client for instant feedback on the loaded set; server only for projections that exceed the client's loaded graph.
2. **GSAP license.** Confirm GSAP's license is acceptable for a published client, or swap camera tweens to a small custom lerp/spring (the toolkit already lerps the camera in `ProtocolFlow3D`). _Recommend:_ start with the existing lerp pattern; adopt GSAP only if timeline sequencing (tour/presenter/path-trace) proves it's worth the dep.
3. **Light theme priority.** Real ask, or P2-and-maybe? The toolkit's paper surface gives us a head start but it's scoped to the article.
4. **Repo picker scope.** Single repo at a time, or multi-repo switcher? Affects URL shape (`/explorer/:repo`) and recents UX.
5. **Auth/exposure.** Indexer binds `127.0.0.1` only (unauthenticated, mutating + LLM endpoints). If the toolkit client is _published_, the explorer must degrade to a read-only/local-only mode when the indexer isn't reachable — confirm the deployment story (local-companion vs hosted).
6. **Time-travel retention.** How many snapshots to buffer client-side before memory matters on big graphs?

---

## Sources

- Sourcegraph — new UI (chrome recedes, focus on code): https://sourcegraph.com/blog/introducing-sourcegraphs-new-ui
- Obsidian graph critique (hairball past ~200 nodes): https://codeculture.store/blogs/developer-culture/obsidian-graph-view-useful
- Semantic zoom / multi-level graph viz (arxiv): https://arxiv.org/pdf/1906.05996
- githubnext repo-visualization (structure-at-a-glance, change over time): https://githubnext.com/projects/repo-visualization/
- Emil Kowalski — design-engineering / spring guidance (≤0.3–0.4s, subtle bounce): https://www.ui-skills.com/skills/emilkowalski/emil-design-eng/
- Physics of spring animations (velocity preserved on interrupt): https://blog.maximeheckel.com/posts/the-physics-behind-spring-animations/
- react-force-graph (2D/3D one interface) + large-data issue #202: https://github.com/vasturiano/react-force-graph · https://github.com/vasturiano/react-force-graph/issues/202
- Command palette as the keyboard spine (Linear/Vercel/Raycast): https://www.techinterview.org/post/3233475212/build-command-palette-cmd-k/
- Reagraph (WebGL clustering reference / alt renderer): https://reagraph.dev/
