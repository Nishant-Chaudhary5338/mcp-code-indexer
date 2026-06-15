import * as path from 'path';
import {
  Node,
  type SourceFile,
  type VariableDeclaration,
  type FunctionDeclaration,
  type ClassDeclaration,
  type CallExpression,
} from 'ts-morph';
import type {
  GraphNode,
  GraphEdge,
  ComponentNode,
  FunctionNode,
} from '@repo/code-graph-core';
import {
  componentId,
  functionId,
  fileId,
  edgeId,
  emptyStatus,
} from '@repo/code-graph-core';
import { classifySymbol, isPascalCase, returnsJsx } from './detect-components.js';

/**
 * A symbol node paired with the AST node that spans its body, retained so the
 * semantic pass ({@link extractSemanticEdges}) can attribute the JSX/calls
 * inside that body back to this symbol without re-deriving spans.
 */
export type EmittedSymbol = {
  id: string;
  name: string;
  type: 'component' | 'function';
  spanNode: Node;
};

type SymbolResult = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  symbols: EmittedSymbol[];
};

const containsEdge = (parent: string, child: string): GraphEdge => ({
  id: edgeId(parent, child, 'contains'),
  source: parent,
  target: child,
  type: 'contains',
  weight: 1,
});

/**
 * Build a symbol node. `forceComponent` lets callers that already know the
 * symbol is a component (forwardRef/memo/class) short-circuit JSX heuristics.
 * `occurrence` disambiguates same-named function symbols without embedding a
 * line number (which would churn on whitespace edits).
 */
const MAX_SIGNATURE = 200;

/** The function-like node behind a symbol, unwrapping `const x = () => …`. */
const functionLike = (node: Node) => {
  if (
    Node.isFunctionDeclaration(node) ||
    Node.isArrowFunction(node) ||
    Node.isFunctionExpression(node) ||
    Node.isMethodDeclaration(node)
  ) {
    return node;
  }
  if (Node.isVariableDeclaration(node)) {
    const init = node.getInitializer();
    if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
      return init;
    }
  }
  return undefined;
};

/**
 * A concise signature built from the WRITTEN type annotations — `(a: T, b?: U)
 * => R`, or a component's `(props: Props)`. Never the fully-expanded inferred
 * type (which can be enormous); bounded to {@link MAX_SIGNATURE}. Returns null
 * for non-function symbols (a const object, a class, …).
 */
const extractSignature = (node: Node): string | null => {
  const fn = functionLike(node);
  if (!fn) return null;
  const params = fn.getParameters().map((p) => {
    const name = p.getNameNode().getText();
    const typeText = p.getTypeNode()?.getText();
    const opt = p.hasQuestionToken() ? '?' : '';
    return typeText ? `${name}${opt}: ${typeText}` : `${name}${opt}`;
  });
  const ret = fn.getReturnTypeNode()?.getText();
  const sig = `(${params.join(', ')})${ret ? ` => ${ret}` : ''}`;
  return sig.length > MAX_SIGNATURE ? `${sig.slice(0, MAX_SIGNATURE)}…` : sig;
};

const makeSymbolNode = (
  relPath: string,
  fileNodeId: string,
  name: string,
  span: { node: Node; startLine: number; endLine: number },
  isTsx: boolean,
  forceComponent: boolean,
  occurrence: number,
): { node: GraphNode; edge: GraphEdge } => {
  const { startLine, endLine } = span;
  const signature = extractSignature(span.node);
  const kind = forceComponent
    ? 'component'
    : classifySymbol(name, span.node, isTsx);

  if (kind === 'component') {
    const id = componentId(relPath, name);
    const node: ComponentNode = {
      id,
      type: 'component',
      name,
      path: relPath,
      parentId: fileNodeId,
      span: { startLine, endLine },
      contentHash: null,
      status: emptyStatus(),
      knowledge: null,
      git: null,
      bundleBytes: null,
      metrics: { loc: endLine - startLine + 1, exportsCount: 0 },
      signature,
    };
    return { node, edge: containsEdge(fileNodeId, id) };
  }

  const id = functionId(relPath, name, occurrence);
  const node: FunctionNode = {
    id,
    type: 'function',
    name,
    path: relPath,
    parentId: fileNodeId,
    span: { startLine, endLine },
    contentHash: null,
    status: emptyStatus(),
    knowledge: null,
    git: null,
    bundleBytes: null,
    metrics: { loc: endLine - startLine + 1, exportsCount: 0 },
    signature,
  };
  return { node, edge: containsEdge(fileNodeId, id) };
};

const isExported = (
  decl: FunctionDeclaration | VariableDeclaration | ClassDeclaration,
): boolean => {
  if (Node.isFunctionDeclaration(decl) || Node.isClassDeclaration(decl)) {
    return decl.isExported();
  }
  const statement = decl.getVariableStatement();
  return statement?.isExported() ?? false;
};

// React component-factory call names we unwrap to find the wrapped render fn.
const COMPONENT_WRAPPERS = new Set(['forwardRef', 'memo']);

const calleeName = (call: CallExpression): string | null => {
  const expr = call.getExpression();
  if (Node.isIdentifier(expr)) return expr.getText();
  // `React.forwardRef`, `React.memo`.
  if (Node.isPropertyAccessExpression(expr)) return expr.getName();
  return null;
};

/**
 * If an initializer is a React component factory (`forwardRef(fn)`, `memo(fn)`,
 * `React.forwardRef(fn)`) or a generic HOC (`withX(Inner)`), return the inner
 * function node whose body actually renders JSX (or the wrapped component
 * reference). Returns null when the call clearly is not a component factory.
 */
const unwrapComponentFactory = (
  init: Node,
): { fn: Node; certain: boolean } | null => {
  if (!Node.isCallExpression(init)) return null;
  const name = calleeName(init);
  if (!name) return null;

  const fnArg = init
    .getArguments()
    .find(
      (a) =>
        Node.isArrowFunction(a) ||
        Node.isFunctionExpression(a) ||
        Node.isCallExpression(a),
    );

  if (COMPONENT_WRAPPERS.has(name)) {
    // forwardRef/memo: the first function arg is the render function.
    const renderFn = init
      .getArguments()
      .find((a) => Node.isArrowFunction(a) || Node.isFunctionExpression(a));
    if (renderFn) return { fn: renderFn, certain: true };
    // memo(SomeComponent) — wraps an existing component reference; treat the
    // call itself as the component (no body to span beyond the call).
    return { fn: init, certain: true };
  }

  // Generic HOC heuristic: `withFoo(...)` / `createFoo(...)` wrapping a function.
  const looksLikeHoc = /^(with|create)[A-Z]/.test(name);
  if (looksLikeHoc && fnArg) {
    if (
      (Node.isArrowFunction(fnArg) || Node.isFunctionExpression(fnArg)) &&
      returnsJsx(fnArg)
    ) {
      return { fn: fnArg, certain: true };
    }
    return { fn: init, certain: false };
  }

  return null;
};

const spanOf = (node: Node): { node: Node; startLine: number; endLine: number } => ({
  node,
  startLine: node.getStartLineNumber(),
  endLine: node.getEndLineNumber(),
});

// Turn `page.tsx` -> `Page`, `user-card.tsx` -> `UserCard` for naming anonymous
// default exports. Exported so the semantic pass can reconstruct the node name a
// default import resolves to (default exports are named from their filename).
export const nameFromFile = (relPath: string): string => {
  const base = path.basename(relPath).replace(/\.(tsx|ts|jsx|js)$/, '');
  const cleaned = base === 'index' ? path.basename(path.dirname(relPath)) : base;
  return cleaned
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('') || 'Default';
};

const isClassComponent = (cls: ClassDeclaration): boolean => {
  const ext = cls.getExtends();
  if (!ext) return false;
  const text = ext.getText();
  return /(^|\.)(Component|PureComponent)\b/.test(text);
};

export const extractSymbolNodes = (
  source: SourceFile,
  relPath: string,
): SymbolResult => {
  const fileNodeId = fileId(relPath);
  const isTsx = relPath.endsWith('.tsx');
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const symbols: EmittedSymbol[] = [];

  // Track how many times each name has been emitted so duplicate/overloaded
  // names get a stable occurrence index instead of a line number.
  const occurrences = new Map<string, number>();
  const nextOccurrence = (name: string): number => {
    const n = occurrences.get(name) ?? 0;
    occurrences.set(name, n + 1);
    return n;
  };
  const emit = (
    name: string,
    span: { node: Node; startLine: number; endLine: number },
    forceComponent: boolean,
  ): void => {
    const { node, edge } = makeSymbolNode(
      relPath,
      fileNodeId,
      name,
      span,
      isTsx,
      forceComponent,
      forceComponent ? 0 : nextOccurrence(name),
    );
    nodes.push(node);
    edges.push(edge);
    if (node.type === 'component' || node.type === 'function') {
      symbols.push({ id: node.id, name, type: node.type, spanNode: span.node });
    }
  };

  // 1. Exported function declarations.
  for (const fn of source.getFunctions()) {
    const name = fn.getName();
    if (!name || !isExported(fn)) continue;
    emit(name, spanOf(fn), false);
  }

  // 2. Exported variable declarations: arrow/function expressions and React
  //    component factories (forwardRef/memo/HOC).
  for (const decl of source.getVariableDeclarations()) {
    if (!isExported(decl)) continue;
    const init = decl.getInitializer();
    if (!init) continue;
    const name = decl.getName();

    if (Node.isArrowFunction(init) || Node.isFunctionExpression(init)) {
      emit(name, spanOf(init), false);
      continue;
    }

    const wrapped = unwrapComponentFactory(init);
    if (wrapped) {
      // forwardRef/memo/HOC results are components when the name is PascalCase.
      const forceComponent = isPascalCase(name) && isTsx;
      emit(name, spanOf(init), forceComponent);
    }
  }

  // 3. Class components (`class X extends React.Component`).
  for (const cls of source.getClasses()) {
    const name = cls.getName();
    if (!name || !isExported(cls)) continue;
    if (isTsx && isClassComponent(cls)) {
      emit(name, spanOf(cls), true);
    }
  }

  // 4. Anonymous default exports — named from the filename.
  const defaultExport = source.getDefaultExportSymbol();
  const defaultDecl = source
    .getExportAssignments()
    .find((a) => !a.isExportEquals());
  if (defaultExport && defaultDecl) {
    const expr = defaultDecl.getExpression();
    if (Node.isArrowFunction(expr) || Node.isFunctionExpression(expr)) {
      const name = nameFromFile(relPath);
      const force = isTsx && isPascalCase(name) && returnsJsx(expr);
      emit(name, spanOf(expr), force);
    } else {
      const wrapped = unwrapComponentFactory(expr);
      if (wrapped) {
        const name = nameFromFile(relPath);
        emit(name, spanOf(expr), isTsx && isPascalCase(name));
      }
    }
  }
  // `export default function () {}` shows up as an unnamed FunctionDeclaration.
  for (const fn of source.getFunctions()) {
    if (fn.getName()) continue;
    if (!fn.isDefaultExport()) continue;
    const name = nameFromFile(relPath);
    const force = isTsx && isPascalCase(name) && returnsJsx(fn);
    emit(name, spanOf(fn), force);
  }

  return { nodes, edges, symbols };
};
