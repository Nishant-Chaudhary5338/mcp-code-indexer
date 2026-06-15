import { IndexerSession } from 'code-indexer-mcp/engine';
import { writeSnapshot } from 'code-indexer-mcp/cache';
import { readNodeSource, describeNode } from 'code-indexer-mcp/knowledge';
import {
  embedSnapshot,
  semanticSearch,
  type EmbedResult,
  type SemanticSearchResult,
  type SemanticSearchOptions,
} from 'code-indexer-mcp/semantic';
import {
  nodePath,
  type GraphSnapshot,
  type GraphNode,
  type GraphPatch,
  type NodeKnowledge,
} from '@repo/code-graph-core';
import { askClaude } from './claude-cli.js';
import { summaryPrompt, chatPrompt } from './prompts.js';
import { Semaphore } from './semaphore.js';

export type ChatResult = { answer: string; citations: string[]; usedLlm: boolean };

const RETRIEVABLE = new Set(['file', 'component', 'function']);
const MAX_CONTEXT_NODES = 6;
const CONTEXT_CHARS = 1500;
/** Cap on simultaneous Claude CLI subprocesses spawned by chat requests. */
const MAX_CONCURRENT_LLM = 2;

export type PatchListener = (patch: GraphPatch) => void;

const emptyPatch = (): GraphPatch => ({
  upsertNodes: [],
  removeNodeIds: [],
  upsertEdges: [],
  removeEdgeIds: [],
  meta: {},
});

export class GraphService {
  private readonly session: IndexerSession;
  private snapshot: GraphSnapshot | null = null;
  private readonly listeners = new Set<PatchListener>();
  /**
   * Serialization queue. Every operation that mutates shared session state
   * (the live ts-morph project + the in-memory snapshot) is chained onto this
   * promise so that reindex, watcher reparse/enrichment, and progressive status
   * enrichment can never interleave. Without this, a reindex could run while the
   * watcher is mid-reparse, producing torn reads of `snapshot` over /api/graph.
   */
  private queue: Promise<unknown> = Promise.resolve();
  /** Bounds the number of concurrent Claude CLI subprocesses. */
  private readonly llmSlots = new Semaphore(MAX_CONCURRENT_LLM);

  constructor(root: string) {
    this.session = new IndexerSession(root);
  }

  /**
   * Run `fn` exclusively with respect to all other serialized operations. The
   * queue chains regardless of whether prior tasks resolved or rejected, so one
   * failing mutation never wedges the queue.
   */
  serialize<T>(fn: () => T | Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    // Keep the chain alive even if `fn` throws; swallow here, surface to caller.
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** Full, from-scratch index. Serialized against all other mutations. */
  indexFull(): Promise<GraphSnapshot> {
    return this.serialize(() => {
      const snapshot = this.session.indexFull();
      // Atomic swap: only publish the fully-built snapshot once the engine has
      // finished constructing it, so concurrent /api/graph reads never observe a
      // half-populated graph.
      this.snapshot = snapshot;
      writeSnapshot(snapshot.meta.root, snapshot);
      return snapshot;
    });
  }

  getSnapshot(): GraphSnapshot | null {
    return this.snapshot;
  }

  getNode(id: string): GraphNode | null {
    return this.snapshot?.nodes.find((n) => n.id === id) ?? null;
  }

  /**
   * Read the on-disk source for a node (file body, or symbol span for
   * components/functions). Returns null when the node is missing or has no
   * path. The result is bounded (~400 lines / ~20KB) so a huge file can't blow
   * up the detail panel; a truncation note is appended when clipped.
   */
  getNodeSource(id: string): { code: string; lang: string } | null {
    const node = this.getNode(id);
    if (!node) return null;
    const rel = nodePath(node);
    if (!rel) return null;

    const root = this.session.getWorkspaceRoot();
    const raw = readNodeSource(root, node);

    const MAX_LINES = 400;
    const MAX_BYTES = 20_000;
    let code = raw;
    let truncated = false;

    const lines = code.split('\n');
    if (lines.length > MAX_LINES) {
      code = lines.slice(0, MAX_LINES).join('\n');
      truncated = true;
    }
    if (code.length > MAX_BYTES) {
      code = code.slice(0, MAX_BYTES);
      truncated = true;
    }
    if (truncated) code += '\n\n… (truncated)';

    const ext = rel.slice(rel.lastIndexOf('.') + 1).toLowerCase();
    const lang =
      ext === 'tsx'
        ? 'tsx'
        : ext === 'ts'
          ? 'ts'
          : ext === 'jsx'
            ? 'jsx'
            : ext === 'js'
              ? 'js'
              : 'text';

    return { code, lang };
  }

  getSession(): IndexerSession {
    return this.session;
  }

  onPatch(listener: PatchListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emitPatch(patch: GraphPatch): void {
    for (const listener of this.listeners) listener(patch);
  }

  private upsertPatch(nodes: GraphNode[]): GraphPatch {
    return { ...emptyPatch(), upsertNodes: nodes };
  }

  async enrichStatusProgressive(): Promise<void> {
    // Enrichment walks packages and yields between each, so it must be
    // serialized as a single unit to avoid interleaving with a reparse/reindex
    // that would mutate the same snapshot mid-walk.
    await this.serialize(async () => {
      for (const pkg of this.session.getPackages()) {
        const changed = this.session.enrichPackageStatus(pkg);
        if (changed.length > 0) this.emitPatch(this.upsertPatch(changed));
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      // Keep the service pointer aligned with the session's (mutated) snapshot.
      this.snapshot = this.session.getSnapshot();
      if (this.snapshot) writeSnapshot(this.snapshot.meta.root, this.snapshot);
    });
  }

  /**
   * Live-edit path: rebuild structural nodes/edges for the touched files via the
   * engine, then run status enrichment for the affected packages. Returns the
   * structural GraphPatch so the caller can broadcast it. Serialized so the
   * reparse + snapshot swap are atomic against reindex/enrichment/reads.
   */
  async reparseAndEnrich(absPaths: string[]): Promise<GraphPatch> {
    return this.serialize(() => {
      const patch = this.session.reparseFiles(absPaths);
      // reparseFiles mutates the session's snapshot in place; re-point ours to
      // the same (now-updated) object so getSnapshot() reflects the new graph.
      this.snapshot = this.session.getSnapshot();
      if (this.snapshot) writeSnapshot(this.snapshot.meta.root, this.snapshot);
      return patch;
    });
  }

  /**
   * Compute/refresh embeddings for the live snapshot (enables semantic search).
   * Serialized — it mutates the snapshot's `knowledge.embeddingId` and rewrites
   * the sidecar, so it must not interleave with reindex/reparse.
   */
  buildEmbeddings(): Promise<EmbedResult> {
    return this.serialize(async () => {
      if (!this.snapshot) {
        return { available: false, embedded: 0, skipped: 0, total: 0, model: '' };
      }
      return embedSnapshot(this.session.getWorkspaceRoot(), this.snapshot);
    });
  }

  /** "Find by meaning" over the live snapshot (read-only; lexical fallback). */
  async semanticSearch(
    query: string,
    opts: SemanticSearchOptions = {},
  ): Promise<SemanticSearchResult> {
    if (!this.snapshot) {
      return { query, usedEmbeddings: false, count: 0, results: [], hint: 'Graph not indexed yet.' };
    }
    return semanticSearch(this.session.getWorkspaceRoot(), this.snapshot, query, opts);
  }

  async generateKnowledge(nodeId: string): Promise<GraphNode | null> {
    const node = this.getNode(nodeId);
    if (!node) return null;
    const root = this.session.getWorkspaceRoot();
    const source = readNodeSource(root, node);

    const llm = source
      ? await this.llmSlots.run(() =>
          askClaude(summaryPrompt(node, source), { model: 'haiku' }),
        )
      : null;
    const summary = llm ?? describeNode(node, source);

    const knowledge: NodeKnowledge = {
      summary,
      tags: [],
      embeddingId: null,
      generatedAt: Date.now(),
      model: llm ? 'claude (local cli)' : 'heuristic',
    };
    node.knowledge = knowledge;
    this.emitPatch(this.upsertPatch([node]));
    return node;
  }

  async askCodebase(question: string): Promise<ChatResult> {
    const snapshot = this.snapshot;
    if (!snapshot) return { answer: 'Graph not ready.', citations: [], usedLlm: false };

    const terms = question
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length > 2);
    const root = this.session.getWorkspaceRoot();

    const ranked = snapshot.nodes
      .filter((n) => RETRIEVABLE.has(n.type))
      .map((n) => {
        const name = n.name.toLowerCase();
        const filePath = (nodePath(n) ?? '').toLowerCase();
        const score = terms.reduce(
          (acc, t) =>
            acc + (name.includes(t) ? 2 : 0) + (filePath.includes(t) ? 1 : 0),
          0,
        );
        return { node: n, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_CONTEXT_NODES);

    if (ranked.length === 0) {
      return { answer: 'No matching code found for that question.', citations: [], usedLlm: false };
    }

    const context = ranked.map(({ node }) => ({
      path: nodePath(node) ?? node.name,
      source: readNodeSource(root, node).slice(0, CONTEXT_CHARS),
    }));
    const citations = ranked.map(({ node }) => node.id);

    // Bound concurrent subprocesses: N parallel chat requests must not spawn N
    // Claude CLIs at once.
    const llm = await this.llmSlots.run(() =>
      askClaude(chatPrompt(question, context), {
        model: 'haiku',
        timeoutMs: 90000,
      }),
    );
    if (llm) return { answer: llm, citations, usedLlm: true };

    const fallback = ranked
      .map(({ node }) => `- ${nodePath(node) ?? node.name} (${node.type} ${node.name})`)
      .join('\n');
    return {
      answer: `Closest matches in the codebase:\n${fallback}`,
      citations,
      usedLlm: false,
    };
  }

  /**
   * Status-only enrichment for a set of changed files (used as a follow-up after
   * structural reparse). Serialized against other mutations.
   */
  async enrichFiles(relPaths: string[]): Promise<GraphNode[]> {
    return this.serialize(() => {
      const packages = new Map<
        string,
        ReturnType<typeof this.session.findPackageForFile>
      >();
      for (const rel of relPaths) {
        const pkg = this.session.findPackageForFile(rel);
        if (pkg) packages.set(pkg.name, pkg);
      }
      const changed: GraphNode[] = [];
      for (const pkg of packages.values()) {
        if (pkg) changed.push(...this.session.enrichPackageStatus(pkg));
      }
      this.snapshot = this.session.getSnapshot();
      if (changed.length > 0) this.emitPatch(this.upsertPatch(changed));
      return changed;
    });
  }
}
