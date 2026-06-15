import { Node, SyntaxKind } from 'ts-morph';

export const isPascalCase = (name: string): boolean =>
  /^[A-Z][A-Za-z0-9]*$/.test(name);

const JSX_KINDS = new Set<SyntaxKind>([
  SyntaxKind.JsxElement,
  SyntaxKind.JsxSelfClosingElement,
  SyntaxKind.JsxFragment,
]);

const isJsx = (node: Node): boolean => JSX_KINDS.has(node.getKind());

/**
 * Does this node *evaluate to* JSX? We deliberately do NOT walk every
 * descendant — a factory like `() => useMemo(() => <div/>, [])` has JSX deep in
 * a nested callback but is not itself a component. We only follow the actual
 * value paths: a concise arrow body, every `return` statement that belongs to
 * THIS function (not to a nested function), and the branches of conditional /
 * logical expressions in those positions.
 */
const evaluatesToJsx = (node: Node): boolean => {
  // Concise-body arrow: `() => <div/>` or `() => cond ? <a/> : <b/>`.
  if (Node.isArrowFunction(node)) {
    const body = node.getBody();
    if (!Node.isBlock(body)) return expressionYieldsJsx(body);
    return blockReturnsJsx(node);
  }
  if (Node.isFunctionDeclaration(node) || Node.isFunctionExpression(node)) {
    return blockReturnsJsx(node);
  }
  // A method (class component render) body.
  if (Node.isMethodDeclaration(node)) return blockReturnsJsx(node);
  return false;
};

const expressionYieldsJsx = (expr: Node | undefined): boolean => {
  if (!expr) return false;
  if (isJsx(expr)) return true;
  if (Node.isParenthesizedExpression(expr)) {
    return expressionYieldsJsx(expr.getExpression());
  }
  if (Node.isConditionalExpression(expr)) {
    return (
      expressionYieldsJsx(expr.getWhenTrue()) ||
      expressionYieldsJsx(expr.getWhenFalse())
    );
  }
  if (Node.isBinaryExpression(expr)) {
    // `cond && <div/>` or `a ?? <div/>`.
    return (
      expressionYieldsJsx(expr.getLeft()) ||
      expressionYieldsJsx(expr.getRight())
    );
  }
  if (Node.isAsExpression(expr) || Node.isSatisfiesExpression(expr)) {
    return expressionYieldsJsx(expr.getExpression());
  }
  return false;
};

/**
 * Walk the function body but stop descending into nested function scopes, so a
 * `return` belonging to an inner callback is not attributed to the outer fn.
 */
const blockReturnsJsx = (fn: Node): boolean => {
  let found = false;
  fn.forEachDescendant((descendant, traversal) => {
    const kind = descendant.getKind();
    // Do not cross into a nested function scope.
    if (
      descendant !== fn &&
      (Node.isArrowFunction(descendant) ||
        Node.isFunctionExpression(descendant) ||
        Node.isFunctionDeclaration(descendant) ||
        Node.isMethodDeclaration(descendant))
    ) {
      traversal.skip();
      return;
    }
    if (kind === SyntaxKind.ReturnStatement) {
      const ret = descendant.asKind(SyntaxKind.ReturnStatement);
      if (ret && expressionYieldsJsx(ret.getExpression())) {
        found = true;
        traversal.stop();
      }
    }
  });
  return found;
};

/**
 * Exported for tests and back-compat: true when the given function/expression
 * node renders JSX as its return value (not merely contains JSX somewhere).
 */
export const returnsJsx = (node: Node): boolean => evaluatesToJsx(node);

/**
 * Classify a named symbol as a React `component` or a plain `function`.
 * A symbol is a component when its name is PascalCase, the file is a `.tsx`,
 * and the function actually returns JSX.
 */
export const classifySymbol = (
  name: string,
  body: Node,
  isTsx: boolean,
): 'component' | 'function' => {
  if (isPascalCase(name) && isTsx && returnsJsx(body)) return 'component';
  return 'function';
};
