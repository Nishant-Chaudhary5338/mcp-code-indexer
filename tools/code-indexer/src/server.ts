import * as path from 'path';
import { McpServerBase } from '../../_shared/index.js';
import type { ToolResult } from '../../_shared/index.js';
import { createConfig } from './config.js';
import { runFullIndex } from './engine/index.js';
import { writeSnapshot } from './engine/incremental/cache.js';
import {
  queryWhoRenders,
  queryWhoCalls,
  queryFindReferences,
  queryBlastRadius,
  queryFindCycles,
  queryFindOrphans,
  queryGraph,
  querySearchNodes,
  queryContextPack,
  queryEmbedRepo,
  querySemanticSearch,
  type GraphQueryOptions,
} from './query.js';
import type { NodeType } from '@repo/code-graph-core';
import { readSnapshot } from './engine/incremental/cache.js';

type IndexArgs = { root?: string };
type NodeArgs = { root?: string; id?: string };
type RefArgs = { root?: string; id?: string; types?: string[] };
type SearchArgs = { root?: string; query?: string; type?: string[]; limit?: number };
type ContextArgs = { root?: string; id?: string; maxRefs?: number };
type SemanticArgs = { root?: string; query?: string; type?: string[]; limit?: number };
type GraphArgs = {
  root?: string;
  summary?: boolean;
  full?: boolean;
  lean?: boolean;
  depth?: number;
  type?: string[];
  fields?: string[];
};

const resolveRoot = (root?: string): string =>
  root ? path.resolve(root) : process.cwd();

const rootProp = {
  root: { type: 'string', description: 'Repo root (defaults to cwd)' },
} as const;

export class CodeIndexerServer extends McpServerBase {
  constructor() {
    super({ name: 'code-indexer', version: '0.1.0' });
  }

  protected registerTools(): void {
    this.addTool(
      'index_repo',
      'Index a TS/React repo (monorepo or standalone) into a code graph and persist it to .code-graph/graph.json',
      { type: 'object', properties: { ...rootProp } },
      this.handleIndexRepo.bind(this),
    );

    this.addTool(
      'get_graph',
      'Read the code graph. Defaults to a compact summary on large repos (pass full:true for everything). Narrow with type/depth/lean/fields to keep output small.',
      {
        type: 'object',
        properties: {
          ...rootProp,
          summary: { type: 'boolean', description: 'Return only counts + top-level structure + cycle count' },
          full: { type: 'boolean', description: 'Force the entire graph even when large' },
          lean: { type: 'boolean', description: 'Drop status/knowledge/git/span from nodes' },
          depth: { type: 'number', description: 'Keep only N levels from the repo root (contains tree)' },
          type: { type: 'array', items: { type: 'string' }, description: 'Keep only nodes of these types (e.g. component, function)' },
          fields: { type: 'array', items: { type: 'string' }, description: 'Whitelist of node fields to return' },
        },
      },
      this.handleGetGraph.bind(this),
    );

    this.addTool(
      'get_node',
      'Read a single node from the persisted code graph by id',
      {
        type: 'object',
        properties: { ...rootProp, id: { type: 'string', description: 'Canonical node id' } },
        required: ['id'],
      },
      this.handleGetNode.bind(this),
    );

    this.addTool(
      'who_renders',
      'Reverse lookup: which components render the given component id (incoming renders edges)',
      {
        type: 'object',
        properties: { ...rootProp, id: { type: 'string', description: 'Component node id (e.g. cmp:src/Foo.tsx#Foo)' } },
        required: ['id'],
      },
      this.handleWhoRenders.bind(this),
    );

    this.addTool(
      'who_calls',
      'Reverse lookup: which symbols call the given function/component id (incoming calls edges)',
      {
        type: 'object',
        properties: { ...rootProp, id: { type: 'string', description: 'Symbol node id (e.g. fn:src/util.ts#helper)' } },
        required: ['id'],
      },
      this.handleWhoCalls.bind(this),
    );

    this.addTool(
      'find_references',
      'All references into a node (incoming edges), optionally filtered by edge type',
      {
        type: 'object',
        properties: {
          ...rootProp,
          id: { type: 'string', description: 'Target node id' },
          types: { type: 'array', items: { type: 'string' }, description: 'Edge types to include (renders, calls, imports, references, depends-on)' },
        },
        required: ['id'],
      },
      this.handleFindReferences.bind(this),
    );

    this.addTool(
      'blast_radius',
      'Everything that transitively depends on a node — the impact if it changes or breaks',
      {
        type: 'object',
        properties: { ...rootProp, id: { type: 'string', description: 'Target node id' } },
        required: ['id'],
      },
      this.handleBlastRadius.bind(this),
    );

    this.addTool(
      'find_cycles',
      'Find dependency cycles in the graph (import/render/call cycles)',
      { type: 'object', properties: { ...rootProp } },
      this.handleFindCycles.bind(this),
    );

    this.addTool(
      'find_orphans',
      'Dead-code candidates: exported files/components/functions that nothing imports, renders, or calls. Excludes entry points (index/main/App/config) unless includeEntryPoints is set. Heuristic — review, do not auto-delete.',
      {
        type: 'object',
        properties: {
          ...rootProp,
          includeEntryPoints: { type: 'boolean', description: 'Also include index/main/App/config files (default false)' },
        },
      },
      this.handleFindOrphans.bind(this),
    );

    this.addTool(
      'search_nodes',
      'Fuzzy-find nodes by name or path (e.g. "useAuth", "Header") — resolve a rough name to canonical node ids without grepping or guessing ids',
      {
        type: 'object',
        properties: {
          ...rootProp,
          query: { type: 'string', description: 'Free-text name/path to match' },
          type: { type: 'array', items: { type: 'string' }, description: 'Restrict to node types (component, function, file, …)' },
          limit: { type: 'number', description: 'Max results (default 20)' },
        },
        required: ['query'],
      },
      this.handleSearchNodes.bind(this),
    );

    this.addTool(
      'get_context_pack',
      'One dense bundle for safely editing a node: its source + what it depends on + what depends on it + blast-radius size. Use instead of get_node + source + who_calls + blast_radius.',
      {
        type: 'object',
        properties: {
          ...rootProp,
          id: { type: 'string', description: 'Target node id' },
          maxRefs: { type: 'number', description: 'Cap on each dependency/dependent list (default 50)' },
        },
        required: ['id'],
      },
      this.handleGetContextPack.bind(this),
    );

    this.addTool(
      'build_embeddings',
      'Compute local vector embeddings for the indexed nodes (enables semantic_search). Idempotent + incremental — only changed nodes are re-embedded. No-op if the local model is unavailable.',
      { type: 'object', properties: { ...rootProp } },
      this.handleBuildEmbeddings.bind(this),
    );

    this.addTool(
      'semantic_search',
      'Find code by MEANING, not just name (e.g. "logic that decides trustee access"). Ranks nodes by embedding similarity; falls back to lexical search (with a hint) if embeddings aren\'t built.',
      {
        type: 'object',
        properties: {
          ...rootProp,
          query: { type: 'string', description: 'Natural-language description of what you are looking for' },
          type: { type: 'array', items: { type: 'string' }, description: 'Restrict to node types (component, function, file)' },
          limit: { type: 'number', description: 'Max results (default 20)' },
        },
        required: ['query'],
      },
      this.handleSemanticSearch.bind(this),
    );
  }

  private async handleIndexRepo(args: unknown): Promise<ToolResult> {
    const root = resolveRoot((args as IndexArgs).root);
    const { snapshot, durationMs } = runFullIndex(createConfig(root));
    writeSnapshot(snapshot.meta.root, snapshot);
    return this.success({
      root: snapshot.meta.root,
      nodeCount: snapshot.meta.nodeCount,
      edgeCount: snapshot.meta.edgeCount,
      durationMs,
    });
  }

  private async handleGetGraph(args: unknown): Promise<ToolResult> {
    const a = args as GraphArgs;
    const opts: GraphQueryOptions = {
      summary: a.summary,
      full: a.full,
      lean: a.lean,
      depth: a.depth,
      type: a.type as GraphQueryOptions['type'],
      fields: a.fields,
    };
    try {
      return this.success({ graph: queryGraph(resolveRoot(a.root), opts) });
    } catch (err) {
      return this.error(err);
    }
  }

  private async handleGetNode(args: unknown): Promise<ToolResult> {
    const { root, id } = args as NodeArgs;
    if (!id) return this.error(new Error('id is required'));
    const snapshot = readSnapshot(resolveRoot(root));
    if (!snapshot) return this.error(new Error('No graph found. Run index_repo first.'));
    const node = snapshot.nodes.find((n) => n.id === id);
    if (!node) return this.error(new Error(`Node not found: ${id}`));
    return this.success({ node });
  }

  private requireId(args: unknown): { root?: string; id: string } {
    const { root, id } = args as NodeArgs;
    if (!id) throw new Error('id is required');
    return { root, id };
  }

  private async handleWhoRenders(args: unknown): Promise<ToolResult> {
    try {
      const { root, id } = this.requireId(args);
      return this.success({ ...queryWhoRenders(resolveRoot(root), id) });
    } catch (err) {
      return this.error(err);
    }
  }

  private async handleWhoCalls(args: unknown): Promise<ToolResult> {
    try {
      const { root, id } = this.requireId(args);
      return this.success({ ...queryWhoCalls(resolveRoot(root), id) });
    } catch (err) {
      return this.error(err);
    }
  }

  private async handleFindReferences(args: unknown): Promise<ToolResult> {
    try {
      const { root, id, types } = args as RefArgs;
      if (!id) throw new Error('id is required');
      return this.success({ ...queryFindReferences(resolveRoot(root), id, types) });
    } catch (err) {
      return this.error(err);
    }
  }

  private async handleBlastRadius(args: unknown): Promise<ToolResult> {
    try {
      const { root, id } = this.requireId(args);
      return this.success({ ...queryBlastRadius(resolveRoot(root), id) });
    } catch (err) {
      return this.error(err);
    }
  }

  private async handleFindCycles(args: unknown): Promise<ToolResult> {
    try {
      const root = resolveRoot((args as IndexArgs).root);
      return this.success({ ...queryFindCycles(root) });
    } catch (err) {
      return this.error(err);
    }
  }

  private async handleFindOrphans(args: unknown): Promise<ToolResult> {
    try {
      const { root, includeEntryPoints } = args as { root?: string; includeEntryPoints?: boolean };
      return this.success({ ...queryFindOrphans(resolveRoot(root), includeEntryPoints) });
    } catch (err) {
      return this.error(err);
    }
  }

  private async handleSearchNodes(args: unknown): Promise<ToolResult> {
    try {
      const { root, query, type, limit } = args as SearchArgs;
      if (!query) throw new Error('query is required');
      return this.success({
        ...querySearchNodes(resolveRoot(root), query, {
          type: type as NodeType[] | undefined,
          limit,
        }),
      });
    } catch (err) {
      return this.error(err);
    }
  }

  private async handleGetContextPack(args: unknown): Promise<ToolResult> {
    try {
      const { root, id, maxRefs } = args as ContextArgs;
      if (!id) throw new Error('id is required');
      return this.success({ ...queryContextPack(resolveRoot(root), id, { maxRefs }) });
    } catch (err) {
      return this.error(err);
    }
  }

  private async handleBuildEmbeddings(args: unknown): Promise<ToolResult> {
    try {
      const root = resolveRoot((args as IndexArgs).root);
      return this.success({ ...(await queryEmbedRepo(root)) });
    } catch (err) {
      return this.error(err);
    }
  }

  private async handleSemanticSearch(args: unknown): Promise<ToolResult> {
    try {
      const { root, query, type, limit } = args as SemanticArgs;
      if (!query) throw new Error('query is required');
      return this.success({
        ...(await querySemanticSearch(resolveRoot(root), query, {
          type: type as NodeType[] | undefined,
          limit,
        })),
      });
    } catch (err) {
      return this.error(err);
    }
  }
}
