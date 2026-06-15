import { describe, it, expect } from 'vitest';
import { Project } from 'ts-morph';
import type { GraphEdge, GraphNode } from '@repo/code-graph-core';
import { extractSymbolNodes } from './symbol-nodes.js';
import { buildSymbolIndex, extractSemanticEdges } from './semantic-edges.js';
import { buildReexportIndex } from './reexport-index.js';

// Build an in-memory project from the given files, extract symbols for all of
// them, then resolve renders/calls edges for `entry` against the full index +
// a project-wide re-export (barrel) index.
const semanticFor = (
  files: Record<string, string>,
  entry: string,
): GraphEdge[] => {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { jsx: 4 /* ReactJSX */ },
  });
  const allNodes: GraphNode[] = [];
  const symbolsByFile: Record<string, ReturnType<typeof extractSymbolNodes>['symbols']> =
    {};
  for (const [name, content] of Object.entries(files)) {
    const sf = project.createSourceFile(`/repo/${name}`, content, {
      overwrite: true,
    });
    const r = extractSymbolNodes(sf, name);
    allNodes.push(...r.nodes);
    symbolsByFile[name] = r.symbols;
  }
  const index = buildSymbolIndex(allNodes);
  const reexports = buildReexportIndex(
    project.getSourceFiles().filter((s) => !s.getFilePath().includes('node_modules')),
    '/repo',
  );
  const sf = project.getSourceFileOrThrow(`/repo/${entry}`);
  return extractSemanticEdges(
    sf,
    entry,
    symbolsByFile[entry] ?? [],
    '/repo',
    index,
    reexports,
  );
};

const renders = (edges: GraphEdge[]): GraphEdge[] =>
  edges.filter((e) => e.type === 'renders');
const calls = (edges: GraphEdge[]): GraphEdge[] =>
  edges.filter((e) => e.type === 'calls');

describe('extractSemanticEdges — renders', () => {
  it('emits a renders edge to an imported component', () => {
    const edges = semanticFor(
      {
        'App.tsx': `import { Header } from './Header';
          export const App = () => <div><Header/></div>;`,
        'Header.tsx': `export const Header = () => <header/>;`,
      },
      'App.tsx',
    );
    const r = renders(edges);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      source: 'cmp:App.tsx#App',
      target: 'cmp:Header.tsx#Header',
    });
  });

  it('resolves a default-imported component via its filename-derived name', () => {
    const edges = semanticFor(
      {
        'App.tsx': `import Sidebar from './Sidebar';
          export const App = () => <Sidebar/>;`,
        // anonymous default -> named "Sidebar" from the filename
        'Sidebar.tsx': `export default () => <aside/>;`,
      },
      'App.tsx',
    );
    expect(renders(edges)[0]?.target).toBe('cmp:Sidebar.tsx#Sidebar');
  });

  it('resolves an aliased named import', () => {
    const edges = semanticFor(
      {
        'App.tsx': `import { Header as Top } from './Header';
          export const App = () => <Top/>;`,
        'Header.tsx': `export const Header = () => <header/>;`,
      },
      'App.tsx',
    );
    expect(renders(edges)[0]?.target).toBe('cmp:Header.tsx#Header');
  });

  it('resolves a namespace member tag (<Icons.Home/>)', () => {
    const edges = semanticFor(
      {
        'App.tsx': `import * as Icons from './icons';
          export const App = () => <Icons.Home/>;`,
        'icons.tsx': `export const Home = () => <svg/>;`,
      },
      'App.tsx',
    );
    expect(renders(edges)[0]?.target).toBe('cmp:icons.tsx#Home');
  });

  it('renders a component defined in the same file', () => {
    const edges = semanticFor(
      {
        'App.tsx': `export const Inner = () => <span/>;
          export const Outer = () => <Inner/>;`,
      },
      'App.tsx',
    );
    expect(renders(edges)).toContainEqual(
      expect.objectContaining({
        source: 'cmp:App.tsx#Outer',
        target: 'cmp:App.tsx#Inner',
      }),
    );
  });

  it('accumulates weight when a component is rendered repeatedly', () => {
    const edges = semanticFor(
      {
        'App.tsx': `import { Row } from './Row';
          export const App = () => <table><Row/><Row/><Row/></table>;`,
        'Row.tsx': `export const Row = () => <tr/>;`,
      },
      'App.tsx',
    );
    expect(renders(edges)[0]?.weight).toBe(3);
  });

  it('ignores intrinsic elements and unresolved (library) components', () => {
    const edges = semanticFor(
      {
        'App.tsx': `import { motion } from 'framer-motion';
          export const App = () => <div><motion.div/><span/></div>;`,
      },
      'App.tsx',
    );
    // <div>/<span> are intrinsic; <motion.div> is from an unindexed package.
    expect(renders(edges)).toHaveLength(0);
  });

  it('does not emit a self-render edge for recursion', () => {
    const edges = semanticFor(
      {
        'Tree.tsx': `export const Tree = ({ leaf }: { leaf: boolean }) =>
          leaf ? <span/> : <Tree leaf />;`,
      },
      'Tree.tsx',
    );
    expect(renders(edges)).toHaveLength(0);
  });
});

describe('extractSemanticEdges — calls', () => {
  it('emits a calls edge to an imported function', () => {
    const edges = semanticFor(
      {
        'a.ts': `import { helper } from './b';
          export const run = () => helper();`,
        'b.ts': `export const helper = () => 1;`,
      },
      'a.ts',
    );
    expect(calls(edges)[0]).toMatchObject({
      source: 'fn:a.ts#run',
      target: 'fn:b.ts#helper',
    });
  });

  it('resolves a namespace-member call (utils.format())', () => {
    const edges = semanticFor(
      {
        'a.ts': `import * as utils from './utils';
          export const run = () => utils.format();`,
        'utils.ts': `export const format = () => 'x';`,
      },
      'a.ts',
    );
    expect(calls(edges)[0]?.target).toBe('fn:utils.ts#format');
  });

  it('does not emit calls to unindexed (library) functions', () => {
    const edges = semanticFor(
      {
        'a.ts': `import { useEffect } from 'react';
          export const run = () => { useEffect(() => {}, []); };`,
      },
      'a.ts',
    );
    expect(calls(edges)).toHaveLength(0);
  });
});

describe('extractSemanticEdges — re-export barrels', () => {
  it('resolves a render through a single-hop barrel (export { Button } from)', () => {
    const edges = semanticFor(
      {
        'App.tsx': `import { Button } from './ui';
          export const App = () => <Button/>;`,
        'ui.ts': `export { Button } from './Button';`,
        'Button.tsx': `export const Button = () => <button/>;`,
      },
      'App.tsx',
    );
    expect(renders(edges)[0]?.target).toBe('cmp:Button.tsx#Button');
  });

  it('resolves a render through an aliased single-hop barrel', () => {
    const edges = semanticFor(
      {
        'App.tsx': `import { Btn } from './ui';
          export const App = () => <Btn/>;`,
        'ui.ts': `export { Button as Btn } from './Button';`,
        'Button.tsx': `export const Button = () => <button/>;`,
      },
      'App.tsx',
    );
    expect(renders(edges)[0]?.target).toBe('cmp:Button.tsx#Button');
  });

  it('resolves a render through a two-hop barrel (index → sub-barrel)', () => {
    const edges = semanticFor(
      {
        'App.tsx': `import { Button } from './index';
          export const App = () => <Button/>;`,
        'index.ts': `export { Button } from './ui';`,
        'ui.ts': `export { Button } from './Button';`,
        'Button.tsx': `export const Button = () => <button/>;`,
      },
      'App.tsx',
    );
    expect(renders(edges)[0]?.target).toBe('cmp:Button.tsx#Button');
  });

  it('resolves a default re-export (export { default as X } from)', () => {
    const edges = semanticFor(
      {
        'App.tsx': `import { Sidebar } from './ui';
          export const App = () => <Sidebar/>;`,
        'ui.ts': `export { default as Sidebar } from './Sidebar';`,
        // anonymous default -> named "Sidebar" from the filename
        'Sidebar.tsx': `export default () => <aside/>;`,
      },
      'App.tsx',
    );
    expect(renders(edges)[0]?.target).toBe('cmp:Sidebar.tsx#Sidebar');
  });

  it('resolves a render through a star re-export (export * from)', () => {
    const edges = semanticFor(
      {
        'App.tsx': `import { Card } from './ui';
          export const App = () => <Card/>;`,
        'ui.ts': `export * from './Card';`,
        'Card.tsx': `export const Card = () => <article/>;`,
      },
      'App.tsx',
    );
    expect(renders(edges)[0]?.target).toBe('cmp:Card.tsx#Card');
  });

  it('terminates on a re-export cycle without looping or throwing', () => {
    const edges = semanticFor(
      {
        'App.tsx': `import { Ghost } from './a';
          export const App = () => <Ghost/>;`,
        // a and b re-export from each other; Ghost is declared nowhere.
        'a.ts': `export * from './b';`,
        'b.ts': `export * from './a';`,
      },
      'App.tsx',
    );
    // No real Ghost node exists, so nothing resolves — and crucially no hang.
    expect(renders(edges)).toHaveLength(0);
  });
});

describe('extractSemanticEdges — this.method() calls', () => {
  it('emits a calls edge for this.method() to a same-file symbol', () => {
    const edges = semanticFor(
      {
        'Widget.tsx': `import { Component } from 'react';
          export function compute() { return 1; }
          export class Widget extends Component {
            render() { return <div>{this.compute()}</div>; }
          }`,
      },
      'Widget.tsx',
    );
    expect(calls(edges)).toContainEqual(
      expect.objectContaining({
        source: 'cmp:Widget.tsx#Widget',
        target: 'fn:Widget.tsx#compute',
      }),
    );
  });

  it('does not emit a calls edge for this.method() with no indexed same-file symbol', () => {
    const edges = semanticFor(
      {
        'Widget.tsx': `import { Component } from 'react';
          export class Widget extends Component {
            // private() is a class method, not an indexed top-level symbol.
            render() { return <div>{this.private()}</div>; }
          }`,
      },
      'Widget.tsx',
    );
    expect(calls(edges)).toHaveLength(0);
  });

  it('emits nothing for an unresolvable obj.method() on a local variable', () => {
    const edges = semanticFor(
      {
        'a.ts': `export const run = () => {
            const svc = makeService();
            svc.fetch();
          };`,
      },
      'a.ts',
    );
    // `svc` is a local non-indexed value; no cross-file inference in v1.
    expect(calls(edges)).toHaveLength(0);
  });
});

describe('buildSymbolIndex', () => {
  it('maps each file/exportName to its symbol node id and type', () => {
    const project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: { jsx: 4 },
    });
    const sf = project.createSourceFile(
      'm.tsx',
      `export const Widget = () => <div/>;\nexport const compute = () => 1;`,
    );
    const index = buildSymbolIndex(extractSymbolNodes(sf, 'm.tsx').nodes);
    expect(index.get('m.tsx')?.get('Widget')).toEqual({
      id: 'cmp:m.tsx#Widget',
      type: 'component',
    });
    expect(index.get('m.tsx')?.get('compute')).toEqual({
      id: 'fn:m.tsx#compute',
      type: 'function',
    });
  });
});
