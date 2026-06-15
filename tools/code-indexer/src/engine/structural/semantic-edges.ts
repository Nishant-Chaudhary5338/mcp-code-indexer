import * as path from 'path';
import { Node, SyntaxKind, type SourceFile } from 'ts-morph';
import type { GraphNode, GraphEdge, EdgeType } from '@repo/code-graph-core';
import { edgeId } from '@repo/code-graph-core';
import { nameFromFile, type EmittedSymbol } from './symbol-nodes.js';
import { resolveExport, type ReexportIndex } from './reexport-index.js';

/**
 * Symbol-level resolution table: `fileRelPath -> exportName -> { id, type }`.
 * Built from the full node set after structural extraction so the semantic pass
 * can map a name used in one file to the *node* it refers to in another. This is
 * also the foundation for "find references" — every render/call edge is a
 * resolved pointer between two symbol nodes.
 */
export type SymbolRef = { id: string; type: 'component' | 'function' };
export type SymbolIndex = Map<string, Map<string, SymbolRef>>;

export const buildSymbolIndex = (nodes: GraphNode[]): SymbolIndex => {
  const index: SymbolIndex = new Map();
  for (const node of nodes) {
    if (node.type !== 'component' && node.type !== 'function') continue;
    let byName = index.get(node.path);
    if (!byName) {
      byName = new Map();
      index.set(node.path, byName);
    }
    // First declaration of a name wins (matches the `occurrence` id scheme,
    // whose 0th occurrence keeps the bare `#name` id).
    if (!byName.has(node.name)) {
      byName.set(node.name, { id: node.id, type: node.type });
    }
  }
  return index;
};

const toRel = (root: string, target: SourceFile): string | null => {
  const abs = target.getFilePath();
  if (abs.includes('node_modules')) return null;
  const rel = path.relative(root, abs);
  if (rel.startsWith('..')) return null;
  return rel.replace(/\\/g, '/');
};

// How a local name in this file is bound to something exported elsewhere.
type Binding =
  | { kind: 'named'; targetRel: string; exportName: string }
  | { kind: 'default'; targetRel: string }
  | { kind: 'namespace'; targetRel: string };

/**
 * Map every imported local name in `source` to the module + export it binds to,
 * resolving the module specifier through ts-morph (so `@/*` aliases and relative
 * paths both resolve, driven by the package's real tsconfig).
 */
const buildBindings = (
  source: SourceFile,
  root: string,
): Map<string, Binding> => {
  const bindings = new Map<string, Binding>();
  for (const decl of source.getImportDeclarations()) {
    const target = decl.getModuleSpecifierSourceFile();
    if (!target) continue;
    const targetRel = toRel(root, target);
    if (!targetRel) continue;

    const def = decl.getDefaultImport();
    if (def) bindings.set(def.getText(), { kind: 'default', targetRel });

    const ns = decl.getNamespaceImport();
    if (ns) bindings.set(ns.getText(), { kind: 'namespace', targetRel });

    for (const spec of decl.getNamedImports()) {
      const local = spec.getAliasNode()?.getText() ?? spec.getName();
      bindings.set(local, {
        kind: 'named',
        targetRel,
        exportName: spec.getName(),
      });
    }
  }
  return bindings;
};

type Resolver = (name: string, member?: string) => SymbolRef | null;

/**
 * Resolve a name (optionally a `Namespace.member`) used in this file to a symbol
 * node. Resolution order:
 *   - an imported binding (named / aliased / default / `* as ns`), or
 *   - a symbol declared in this same file.
 * Returns null when it can't be resolved to an *indexed* node — so an
 * unresolved name (a library component, a built-in) yields no edge rather than a
 * wrong one.
 */
const makeResolver = (
  rel: string,
  bindings: Map<string, Binding>,
  index: SymbolIndex,
  reexports: ReexportIndex,
): Resolver => {
  const lookup = (r: string, n: string): SymbolRef | null =>
    index.get(r)?.get(n) ?? null;
  // When a direct lookup into the imported module misses, the module is likely a
  // barrel that re-exports the name from elsewhere — chase it to the true origin.
  const lookupOrBarrel = (r: string, n: string): SymbolRef | null =>
    lookup(r, n) ?? resolveExport(reexports, r, n, lookup);

  return (name, member) => {
    const b = bindings.get(name);
    if (b) {
      if (b.kind === 'namespace') {
        // Only `ns.Member` is resolvable; a bare namespace identifier is not.
        return member ? lookupOrBarrel(b.targetRel, member) : null;
      }
      // `Default.x` / `Named.x` member access is not a top-level symbol we track.
      if (member) return null;
      if (b.kind === 'default')
        return lookupOrBarrel(b.targetRel, nameFromFile(b.targetRel));
      return lookupOrBarrel(b.targetRel, b.exportName);
    }
    // Not imported: a symbol declared in this same file (member access on a
    // local value is not a tracked symbol, so require no member).
    if (member) return null;
    return lookup(rel, name);
  };
};

const tagIdentifier = (
  tagNode: Node,
): { name: string; member?: string } | null => {
  if (Node.isIdentifier(tagNode)) return { name: tagNode.getText() };
  if (Node.isPropertyAccessExpression(tagNode)) {
    const obj = tagNode.getExpression();
    if (Node.isIdentifier(obj)) {
      return { name: obj.getText(), member: tagNode.getName() };
    }
  }
  return null;
};

/**
 * Emit `renders` (component → component) and `calls` (symbol → symbol) edges for
 * one file. Every JSX element and call expression inside a symbol's body is
 * attributed to that symbol and resolved to its target node via {@link
 * makeResolver}. Weights accumulate per (source, target, type), mirroring
 * import-edges, so a component rendered three times yields one edge of weight 3.
 */
export const extractSemanticEdges = (
  source: SourceFile,
  rel: string,
  symbols: EmittedSymbol[],
  root: string,
  index: SymbolIndex,
  reexports: ReexportIndex,
): GraphEdge[] => {
  if (symbols.length === 0) return [];

  const bindings = buildBindings(source, root);
  const resolve = makeResolver(rel, bindings, index, reexports);

  const weights = new Map<
    string,
    { source: string; target: string; type: EdgeType; weight: number }
  >();
  const add = (sourceId: string, targetId: string, type: EdgeType): void => {
    if (sourceId === targetId) return; // ignore self-edges (recursion)
    const key = `${sourceId}->${targetId}:${type}`;
    const existing = weights.get(key);
    if (existing) existing.weight += 1;
    else weights.set(key, { source: sourceId, target: targetId, type, weight: 1 });
  };

  for (const sym of symbols) {
    sym.spanNode.forEachDescendant((d) => {
      const kind = d.getKind();

      const jsx =
        d.asKind(SyntaxKind.JsxOpeningElement) ??
        d.asKind(SyntaxKind.JsxSelfClosingElement);
      if (jsx) {
        const tag = tagIdentifier(jsx.getTagNameNode());
        if (!tag) return;
        // Lowercase bare tag = intrinsic element (`<div>`), never a component.
        if (!tag.member && /^[a-z]/.test(tag.name)) return;
        const ref = resolve(tag.name, tag.member);
        if (ref && ref.type === 'component') add(sym.id, ref.id, 'renders');
        return;
      }

      if (kind === SyntaxKind.CallExpression) {
        const call = d.asKind(SyntaxKind.CallExpression);
        if (!call) return;
        const expr = call.getExpression();
        let ref: SymbolRef | null = null;
        if (Node.isIdentifier(expr)) {
          ref = resolve(expr.getText());
        } else if (Node.isPropertyAccessExpression(expr)) {
          const obj = expr.getExpression();
          if (Node.isIdentifier(obj)) {
            ref = resolve(obj.getText(), expr.getName());
          } else if (Node.isThisExpression(obj)) {
            // `this.foo()` — resolve `foo` to a same-file symbol only. We do not
            // attempt cross-file `obj.method()` inference; an un-indexed method
            // yields nothing rather than a wrong edge.
            ref = index.get(rel)?.get(expr.getName()) ?? null;
          }
        }
        if (ref) add(sym.id, ref.id, 'calls');
      }
    });
  }

  return [...weights.values()].map(({ source: s, target, type, weight }) => ({
    id: edgeId(s, target, type),
    source: s,
    target,
    type,
    weight,
  }));
};
