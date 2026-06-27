---
title: Code Graph
emoji: 🔭
colorFrom: red
colorTo: gray
sdk: docker
app_port: 7860
pinned: false
short_description: Explore any TypeScript repo as a living 3D code graph
---

# Code Graph — live demo

Explore any public TypeScript/React repo as an interactive **3D code graph**:
resolved imports, renders, and calls (via `ts-morph`, not grep). Drill in, trace
a change's blast radius, find cycles, and ask the codebase questions.

Paste a GitHub URL on the landing screen, or open one of the pre-indexed
showcase repos. Built from the [`mcp-code-indexer`](https://github.com/Nishant-Chaudhary5338/mcp-code-indexer)
engine (also on npm as [`code-graph-indexer`](https://www.npmjs.com/package/code-graph-indexer)).

> This Space runs the bundled demo server (Express + WebSocket) which clones and
> indexes repos on demand in an isolated worker process, then serves the React +
> Three.js viewer from the same origin. Chat uses keyword retrieval, or a
> per-request bring-your-own Anthropic key (never stored server-side).
