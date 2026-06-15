#!/usr/bin/env tsx
/**
 * prove-any-repo — a "prove any repo" harness.
 *
 * Indexes a corpus of diverse, real public TS/React repositories with the very
 * same engine entry point the CLI and MCP server use (`runFullIndex(createConfig(root))`),
 * and emits a results table so we can see, at a glance, that the indexer produces
 * a non-trivial code graph on shapes it has never seen: plain Vite SPAs, barrel-
 * heavy component libraries, turbo/Nx monorepos, Next.js apps, and large apps.
 *
 * Usage (run via tsx from the mcp-indexer repo root):
 *   tsx tools/code-indexer/scripts/prove-any-repo.ts                 # whole corpus (clones)
 *   tsx tools/code-indexer/scripts/prove-any-repo.ts --only <name>   # one corpus entry
 *   tsx tools/code-indexer/scripts/prove-any-repo.ts --root <path>   # an already-local dir (no clone)
 *   tsx tools/code-indexer/scripts/prove-any-repo.ts --root ../app --only the-plan-beyond-app
 *   tsx tools/code-indexer/scripts/prove-any-repo.ts __index <root>  # worker: index ONE root, print JSON
 *
 * Network note: cloning the real corpus is slow and network-bound; the harness is
 * idempotent (a clone is skipped when its cache dir already exists) but a full
 * corpus run is meant to be a separate, gated step. The `--root` flag indexes a
 * local directory with no network at all, which is how we validate the harness
 * end-to-end against the sibling app.
 *
 * Process isolation: the orchestrator never indexes in its own process. Each repo
 * is indexed in a fresh child Node process (`__index <root>`, heap bumped to 8 GB)
 * via spawnSync with a wall-clock timeout. A child that OOMs (SIGABRT/SIGKILL),
 * times out, or throws is recorded as a FAILED row with an honest reason — it can
 * never abort the whole run. This is what lets the corpus include giant monorepos
 * (cal.com, excalidraw) without one heap exhaustion wiping out every other result.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runFullIndex } from '../src/engine/index.js';
import { createConfig } from '../src/config.js';
import type { GraphSnapshot } from '@repo/code-graph-core';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
// tools/code-indexer/scripts -> tools/code-indexer
const PACKAGE_DIR = path.resolve(SCRIPT_DIR, '..');
// tools/code-indexer -> repo root (mcp-indexer)
const REPO_ROOT = path.resolve(PACKAGE_DIR, '..', '..');

const CORPUS_PATH = path.join(SCRIPT_DIR, 'corpus.json');
const CACHE_DIR = path.join(PACKAGE_DIR, '.proof-cache');

// Clones live under `.proof-cache/`, which is INSIDE the mcp-indexer turborepo.
// The engine's workspace discovery walks UP from the index root to the nearest
// `turbo.json`/`pnpm-workspace.yaml`, so a clone that has no recognized workspace
// marker of its own would climb past `.proof-cache` and re-index mcp-indexer
// ITSELF. We sidestep this purely from the harness (no engine change) by indexing
// each clone through a symlink under a neutral OS-temp "jail" dir — the upward
// walk then terminates at the temp boundary instead of escaping into this repo.
const JAIL_DIR = path.join(os.tmpdir(), 'prove-any-repo-roots');
const RESULTS_MD = path.join(SCRIPT_DIR, 'PROOF_RESULTS.md');
const RESULTS_JSON = path.join(SCRIPT_DIR, 'PROOF_RESULTS.json');

// ---------------------------------------------------------------------------
// Child-process isolation knobs
// ---------------------------------------------------------------------------

const WORKER_FLAG = '__index';
// Each worker gets an 8 GB heap; giants still OOM, but the smaller repos now have
// the headroom to finish cleanly instead of dying from a too-small default heap.
const WORKER_HEAP_MB = 8192;
// Wall-clock budget per repo. A repo that has not produced its JSON line by this
// point is recorded as a `timeout` FAILED row and the next repo proceeds.
const WORKER_TIMEOUT_MS = 180_000;
// The child prints exactly one JSON line; cap its captured stdout generously.
const WORKER_MAX_BUFFER = 64 * 1024 * 1024;

// Marker the worker wraps its single JSON line in, so we can recover it even if
// the engine logs noise to stdout before it.
const RESULT_PREFIX = '@@PROOF_RESULT@@';

// The one line a worker prints on success.
type WorkerPayload = {
  nodes: number;
  edges: number;
  nodesByType: Record<NodeTypeKey, number>;
  edgesByType: Record<EdgeTypeKey, number>;
  durationMs: number;
};

// ---------------------------------------------------------------------------
// Corpus schema (kept local; the harness owns nothing in the engine's contract)
// ---------------------------------------------------------------------------

type CorpusEntry = {
  name: string;
  gitUrl: string;
  ref: string;
  subdir?: string;
  kind: string;
  comment?: string;
};

const NODE_TYPES = [
  'repo',
  'app',
  'package',
  'folder',
  'file',
  'component',
  'function',
] as const;
type NodeTypeKey = (typeof NODE_TYPES)[number];

const EDGE_TYPES = [
  'contains',
  'imports',
  'calls',
  'depends-on',
  'renders',
  'references',
] as const;
type EdgeTypeKey = (typeof EDGE_TYPES)[number];

type RepoResult = {
  name: string;
  kind: string;
  source: string; // gitUrl#ref, "local:<path>", or the resolved root for local runs
  ok: boolean;
  nodesTotal: number;
  edgesTotal: number;
  nodesByType: Record<NodeTypeKey, number>;
  edgesByType: Record<EdgeTypeKey, number>;
  durationMs: number;
  error: string | null;
};

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

type ParsedArgs = { only: string | null; root: string | null };

const parseArgs = (argv: string[]): ParsedArgs => {
  let only: string | null = null;
  let root: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--only') {
      only = argv[i + 1] ?? null;
      i += 1;
    } else if (flag === '--root') {
      root = argv[i + 1] ?? null;
      i += 1;
    }
  }
  return { only, root };
};

// ---------------------------------------------------------------------------
// Counting
// ---------------------------------------------------------------------------

const zeroNodeCounts = (): Record<NodeTypeKey, number> =>
  NODE_TYPES.reduce(
    (acc, t) => {
      acc[t] = 0;
      return acc;
    },
    {} as Record<NodeTypeKey, number>,
  );

const zeroEdgeCounts = (): Record<EdgeTypeKey, number> =>
  EDGE_TYPES.reduce(
    (acc, t) => {
      acc[t] = 0;
      return acc;
    },
    {} as Record<EdgeTypeKey, number>,
  );

const isNodeType = (t: string): t is NodeTypeKey =>
  (NODE_TYPES as readonly string[]).includes(t);
const isEdgeType = (t: string): t is EdgeTypeKey =>
  (EDGE_TYPES as readonly string[]).includes(t);

const countSnapshot = (
  snapshot: GraphSnapshot,
): { nodesByType: Record<NodeTypeKey, number>; edgesByType: Record<EdgeTypeKey, number> } => {
  const nodesByType = zeroNodeCounts();
  for (const node of snapshot.nodes) {
    if (isNodeType(node.type)) nodesByType[node.type] += 1;
  }
  const edgesByType = zeroEdgeCounts();
  for (const edge of snapshot.edges) {
    if (isEdgeType(edge.type)) edgesByType[edge.type] += 1;
  }
  return { nodesByType, edgesByType };
};

// ---------------------------------------------------------------------------
// Clone (idempotent / cached) + root resolution
// ---------------------------------------------------------------------------

/**
 * Shallow-clone an entry into `.proof-cache/<name>` only if that dir does not
 * already exist. Returns the absolute clone dir on success, or an Error message
 * string on failure (the caller records it and continues to the next entry).
 */
const ensureClone = (entry: CorpusEntry): { dir: string } | { error: string } => {
  const dir = path.join(CACHE_DIR, entry.name);
  if (fs.existsSync(dir)) {
    return { dir }; // cached — idempotent, no network.
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const args = [
    'clone',
    '--depth',
    '1',
    '--branch',
    entry.ref,
    '--single-branch',
    entry.gitUrl,
    dir,
  ];
  const result = spawnSync('git', args, {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) {
    return { error: `git clone failed to spawn: ${result.error.message}` };
  }
  if (result.status !== 0) {
    const stderr = (result.stderr ?? '').trim();
    // A failed clone can leave a partial dir behind; clean it so a re-run retries.
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
    return {
      error: `git clone exited ${result.status ?? 'null'}: ${stderr.slice(0, 300)}`,
    };
  }
  return { dir };
};

const resolveRoot = (cloneDir: string, subdir?: string): string =>
  subdir ? path.join(cloneDir, subdir) : cloneDir;

/**
 * Index path for a corpus clone, jailed outside the mcp-indexer tree.
 *
 * Symlinks the clone ROOT (`.proof-cache/<name>`) to `JAIL_DIR/<name>` and returns
 * `JAIL_DIR/<name>[/subdir]`. Because the engine's `findMonorepoRoot` walk is
 * lexical (`path.dirname`), walking up from the jailed path stops at the OS-temp
 * boundary and never reaches mcp-indexer's `turbo.json`. The symlink target still
 * resolves to the real clone for file reads, so the clone's OWN workspace markers
 * (cal.com's / vite's) are still honored. Returns `{ error }` if the symlink can't
 * be created (the caller records it and moves on).
 */
const jailedIndexRoot = (
  name: string,
  cloneDir: string,
  subdir?: string,
): { root: string } | { error: string } => {
  const link = path.join(JAIL_DIR, name);
  try {
    fs.mkdirSync(JAIL_DIR, { recursive: true });
    // Refresh the link idempotently: drop any stale one, then point at the clone.
    try {
      fs.rmSync(link, { force: true });
    } catch {
      /* best-effort */
    }
    fs.symlinkSync(cloneDir, link, 'dir');
  } catch (err) {
    return {
      error: `jail symlink failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  return { root: subdir ? path.join(link, subdir) : link };
};

// ---------------------------------------------------------------------------
// Worker mode — index ONE root in-process and print a single JSON line.
//
// This is the body that used to run in the orchestrator's own process. It now
// runs only inside a spawned child (`__index <root>`), so an OOM here aborts the
// CHILD, not the run. On success it prints `RESULT_PREFIX{json}` to stdout and
// exits 0; on a thrown error it prints the message to stderr and exits 1. An OOM
// never reaches this catch — it kills the child with SIGABRT, which the
// orchestrator detects from the child's signal/exit code.
// ---------------------------------------------------------------------------

const runWorker = (root: string): never => {
  if (!fs.existsSync(root)) {
    process.stderr.write(`index root does not exist: ${root}\n`);
    process.exit(1);
  }
  try {
    // Mirror the CLI exactly: runFullIndex(createConfig(root)).
    const { snapshot, durationMs } = runFullIndex(createConfig(root));
    const { nodesByType, edgesByType } = countSnapshot(snapshot);
    const payload: WorkerPayload = {
      nodes: snapshot.nodes.length,
      edges: snapshot.edges.length,
      nodesByType,
      edgesByType,
      durationMs,
    };
    process.stdout.write(`${RESULT_PREFIX}${JSON.stringify(payload)}\n`);
    process.exit(0);
  } catch (err) {
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
};

// ---------------------------------------------------------------------------
// Orchestrator — index one root in an ISOLATED child process.
//
// spawnSync a fresh Node (8 GB heap) running this same script in `__index` mode.
// Any failure mode — non-zero exit, OOM signal, or timeout — becomes a FAILED
// RepoResult with an honest one-line reason, and the caller moves on. The
// orchestrator process itself does no engine work and so cannot be OOM-killed by
// a single huge repo.
// ---------------------------------------------------------------------------

/**
 * Resolve how to launch this script in a child Node with TS support. Preferred:
 * `node --import tsx <script>` (works on Node ≥18.19 / 20.6). Falls back to the
 * resolved tsx CLI (`node <tsx/cli> <script>`) if `--import tsx` is unavailable.
 */
const workerLauncher = (): { heapArg: string; loaderArgs: string[] } => {
  const heapArg = `--max-old-space-size=${WORKER_HEAP_MB}`;
  try {
    const require = createRequire(SCRIPT_PATH);
    require.resolve('tsx'); // throws if tsx isn't installed at all.
    return { heapArg, loaderArgs: ['--import', 'tsx'] };
  } catch {
    // Last-ditch: resolve the tsx CLI entry and run it as the script.
    const require = createRequire(SCRIPT_PATH);
    const tsxCli = require.resolve('tsx/cli');
    return { heapArg, loaderArgs: [tsxCli] };
  }
};

/** Map a finished child process into a short, honest failure reason. */
const childFailureReason = (
  status: number | null,
  signal: NodeJS.Signals | null,
  spawnErr: Error | undefined,
  stderr: string,
  timedOut: boolean,
): string => {
  if (timedOut) return `timeout ${Math.round(WORKER_TIMEOUT_MS / 1000)}s`;
  if (spawnErr) return `worker spawn failed: ${spawnErr.message}`;
  // OOM typically arrives as SIGABRT (V8 abort) or SIGKILL (OS killer).
  if (signal === 'SIGABRT' || signal === 'SIGKILL') return `OOM (heap)`;
  if (signal) return `killed by ${signal}`;
  const firstLine = stderr.split('\n').find((l) => l.trim().length > 0) ?? '';
  // V8's heap-exhaustion message can also surface on stderr before the abort.
  if (/heap out of memory|allocation failed|Reached heap limit/i.test(stderr)) {
    return 'OOM (heap)';
  }
  const tail = firstLine.slice(0, 140);
  return `worker exited ${status ?? 'null'}${tail ? `: ${tail}` : ''}`;
};

const indexRoot = (
  meta: { name: string; kind: string; source: string },
  root: string,
): RepoResult => {
  const base = {
    name: meta.name,
    kind: meta.kind,
    source: meta.source,
    nodesByType: zeroNodeCounts(),
    edgesByType: zeroEdgeCounts(),
  };

  if (!fs.existsSync(root)) {
    return {
      ...base,
      ok: false,
      nodesTotal: 0,
      edgesTotal: 0,
      durationMs: 0,
      error: `index root does not exist: ${root}`,
    };
  }

  const { heapArg, loaderArgs } = workerLauncher();
  const args = [heapArg, ...loaderArgs, SCRIPT_PATH, WORKER_FLAG, root];
  const startedAt = Date.now();
  const child = spawnSync(process.execPath, args, {
    encoding: 'utf-8',
    timeout: WORKER_TIMEOUT_MS,
    maxBuffer: WORKER_MAX_BUFFER,
    stdio: ['ignore', 'pipe', 'pipe'],
    // Belt-and-braces: also set the heap via env in case a launcher swallows the
    // execArgv (NODE_OPTIONS is honored by the child Node before user code runs).
    env: { ...process.env, NODE_OPTIONS: heapArg },
  });
  const wallMs = Date.now() - startedAt;

  const stdout = child.stdout ?? '';
  const stderr = (child.stderr ?? '').trim();
  const timedOut = child.signal === 'SIGTERM' && wallMs >= WORKER_TIMEOUT_MS - 1000;

  // Success path: find our marker line and parse the payload.
  const marker = stdout
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith(RESULT_PREFIX));

  if (child.status === 0 && marker) {
    try {
      const payload = JSON.parse(marker.slice(RESULT_PREFIX.length)) as WorkerPayload;
      return {
        ...base,
        ok: true,
        nodesTotal: payload.nodes,
        edgesTotal: payload.edges,
        nodesByType: payload.nodesByType,
        edgesByType: payload.edgesByType,
        durationMs: payload.durationMs,
        error: null,
      };
    } catch (err) {
      return {
        ...base,
        ok: false,
        nodesTotal: 0,
        edgesTotal: 0,
        durationMs: wallMs,
        error: `worker produced unparseable JSON: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
  }

  return {
    ...base,
    ok: false,
    nodesTotal: 0,
    edgesTotal: 0,
    durationMs: wallMs,
    error: childFailureReason(
      child.status,
      child.signal,
      child.error,
      stderr,
      timedOut,
    ),
  };
};

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const oneLineError = (error: string | null): string =>
  error ? error.split('\n')[0]?.slice(0, 120) ?? '' : '';

const mdRow = (r: RepoResult): string => {
  const status = r.ok ? 'ok' : `FAILED — ${oneLineError(r.error)}`;
  const cells = [
    r.name,
    r.kind,
    String(r.nodesTotal),
    String(r.edgesTotal),
    String(r.nodesByType.component),
    String(r.nodesByType.function),
    String(r.edgesByType.renders),
    String(r.edgesByType.calls),
    `${r.durationMs}ms`,
    status,
  ];
  return `| ${cells.join(' | ')} |`;
};

const renderMarkdown = (results: RepoResult[]): string => {
  const header = `# Prove-any-repo results

Generated by \`tools/code-indexer/scripts/prove-any-repo.ts\` on ${new Date().toISOString()}.

This harness indexes a corpus of **diverse, real public TS/React repositories**
with the exact engine entry the CLI and MCP server use —
\`runFullIndex(createConfig(root))\` — to demonstrate that the indexer emits a
non-trivial code graph (files, components, functions, and the
\`imports/references/renders/calls/contains/depends-on\` edges between them) on
shapes it has never seen before: a plain Vite + React SPA, a barrel-heavy
component library, turbo/monorepo apps, a Next.js app, and large real-world
applications. The corpus is described in
[\`corpus.json\`](./corpus.json).

> **These numbers are a floor, not a ceiling.** Symbol-level edges
> (\`renders\`/\`calls\`) are emitted **conservatively** — only when a target
> resolves to a real indexed node — so recall improves as the recall-gap work
> lands. Treat the table as a regression baseline that should trend **up** over
> time, never down.

| Repo | Kind | Nodes | Edges | Components | Functions | renders | calls | Time | Status |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |`;

  const rows = results.map(mdRow).join('\n');

  const okCount = results.filter((r) => r.ok).length;
  const footer = `

## Per-edge-type totals

| Repo | contains | imports | references | renders | calls | depends-on |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
${results
  .map(
    (r) =>
      `| ${r.name} | ${r.edgesByType.contains} | ${r.edgesByType.imports} | ${r.edgesByType.references} | ${r.edgesByType.renders} | ${r.edgesByType.calls} | ${r.edgesByType['depends-on']} |`,
  )
  .join('\n')}

**${okCount}/${results.length}** repositories indexed successfully. Raw data:
[\`PROOF_RESULTS.json\`](./PROOF_RESULTS.json).
`;

  return `${header}\n${rows}\n${footer}`;
};

const printConsoleSummary = (results: RepoResult[]): void => {
  console.log('');
  console.log('Prove-any-repo summary');
  console.log('----------------------');
  for (const r of results) {
    const status = r.ok ? 'ok' : `FAILED (${oneLineError(r.error)})`;
    console.log(
      `${r.name.padEnd(28)} ${String(r.nodesTotal).padStart(6)} nodes  ` +
        `${String(r.edgesTotal).padStart(6)} edges  ` +
        `${String(r.durationMs).padStart(7)}ms  ${status}`,
    );
  }
  console.log('');
};

// ---------------------------------------------------------------------------
// Corpus loading
// ---------------------------------------------------------------------------

const loadCorpus = (): CorpusEntry[] => {
  const raw = fs.readFileSync(CORPUS_PATH, 'utf-8');
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('corpus.json must be a JSON array');
  }
  return parsed.map((item, idx) => {
    if (typeof item !== 'object' || item === null) {
      throw new Error(`corpus.json entry ${idx} is not an object`);
    }
    const e = item as Record<string, unknown>;
    const { name, gitUrl, ref, kind } = e;
    if (
      typeof name !== 'string' ||
      typeof gitUrl !== 'string' ||
      typeof ref !== 'string' ||
      typeof kind !== 'string'
    ) {
      throw new Error(
        `corpus.json entry ${idx} is missing required string fields (name, gitUrl, ref, kind)`,
      );
    }
    const entry: CorpusEntry = { name, gitUrl, ref, kind };
    if (typeof e.subdir === 'string') entry.subdir = e.subdir;
    if (typeof e.comment === 'string') entry.comment = e.comment;
    return entry;
  });
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = (): void => {
  const argv = process.argv.slice(2);

  // Worker mode: `__index <root>`. Index that single root in THIS process and
  // print one JSON line, then exit. The orchestrator spawns us this way.
  if (argv[0] === WORKER_FLAG) {
    const workerRoot = argv[1];
    if (!workerRoot) {
      process.stderr.write(`${WORKER_FLAG} requires a <root> argument\n`);
      process.exit(2);
    }
    runWorker(workerRoot); // never returns
  }

  const { only, root } = parseArgs(argv);
  const results: RepoResult[] = [];

  if (root) {
    // Local mode: index an already-on-disk directory, no clone, no network.
    // `--root` is resolved relative to the repo root (so `../app` means the
    // sibling app), matching how the CLI's `--root` is documented.
    const resolved = path.isAbsolute(root) ? root : path.resolve(REPO_ROOT, root);
    const name = only ?? path.basename(resolved);
    console.log(`Indexing local root: ${resolved} (as "${name}")`);
    results.push(
      indexRoot(
        { name, kind: 'local', source: `local:${resolved}` },
        resolved,
      ),
    );
  } else {
    // Corpus mode: clone (cached) + index each selected entry.
    const corpus = loadCorpus();
    const selected = only ? corpus.filter((e) => e.name === only) : corpus;
    if (only && selected.length === 0) {
      console.error(
        `No corpus entry named "${only}". Known: ${corpus.map((e) => e.name).join(', ')}`,
      );
      process.exit(1);
    }

    for (const entry of selected) {
      console.log(`\n=== ${entry.name} (${entry.kind}) ===`);
      const source = `${entry.gitUrl}#${entry.ref}`;
      const meta = { name: entry.name, kind: entry.kind, source };

      const clone = ensureClone(entry);
      if ('error' in clone) {
        console.error(`  clone failed: ${clone.error}`);
        results.push({
          name: entry.name,
          kind: entry.kind,
          source,
          ok: false,
          nodesTotal: 0,
          edgesTotal: 0,
          nodesByType: zeroNodeCounts(),
          edgesByType: zeroEdgeCounts(),
          durationMs: 0,
          error: clone.error,
        });
        continue;
      }

      // A configured `subdir` can drift out from under us as upstream repos are
      // restructured (e.g. shadcn moved apps/www -> apps/v4). Rather than fail the
      // row on a stale path, fall back to indexing the clone root — for a turbo /
      // pnpm workspace that still discovers the whole monorepo, which is the point.
      let effectiveSubdir = entry.subdir;
      if (effectiveSubdir && !fs.existsSync(path.join(clone.dir, effectiveSubdir))) {
        console.error(
          `  subdir "${effectiveSubdir}" not found — falling back to clone root`,
        );
        effectiveSubdir = undefined;
      }

      // Jail the clone outside the mcp-indexer tree so workspace discovery can't
      // climb up into this repo (see jailedIndexRoot). Falls back to the raw clone
      // path if symlinking is unavailable — a degraded but non-fatal mode.
      const jailed = jailedIndexRoot(entry.name, clone.dir, effectiveSubdir);
      const indexRootPath =
        'root' in jailed ? jailed.root : resolveRoot(clone.dir, effectiveSubdir);
      if ('error' in jailed) {
        console.error(`  jail warning: ${jailed.error} — indexing clone in place`);
      }
      console.log(`  indexing root: ${indexRootPath}`);
      const result = indexRoot(meta, indexRootPath);
      if (result.ok) {
        console.log(
          `  ok: ${result.nodesTotal} nodes, ${result.edgesTotal} edges in ${result.durationMs}ms`,
        );
      } else {
        console.error(`  FAILED: ${oneLineError(result.error)}`);
      }
      results.push(result);
    }
  }

  // Emit artifacts.
  fs.writeFileSync(RESULTS_JSON, `${JSON.stringify(results, null, 2)}\n`, 'utf-8');
  fs.writeFileSync(RESULTS_MD, renderMarkdown(results), 'utf-8');

  printConsoleSummary(results);
  console.log(`Wrote ${path.relative(REPO_ROOT, RESULTS_MD)}`);
  console.log(`Wrote ${path.relative(REPO_ROOT, RESULTS_JSON)}`);

  // Non-zero exit if every run failed, so CI can gate on it; a partial corpus
  // failure (some repos unreachable) still exits 0 as long as one indexed.
  if (results.length > 0 && results.every((r) => !r.ok)) {
    process.exit(1);
  }
};

main();
