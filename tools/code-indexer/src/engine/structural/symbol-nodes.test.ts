import { describe, it, expect } from 'vitest';
import { Project } from 'ts-morph';
import { extractSymbolNodes } from './symbol-nodes.js';
import type { GraphNode } from '@repo/code-graph-core';

const project = new Project({
  useInMemoryFileSystem: true,
  compilerOptions: { jsx: 4 /* ReactJSX */ },
});

const extract = (rel: string, code: string): GraphNode[] => {
  const sf = project.createSourceFile(rel, code, { overwrite: true });
  return extractSymbolNodes(sf, rel).nodes;
};

const byName = (nodes: GraphNode[], name: string): GraphNode | undefined =>
  nodes.find((n) => n.name === name);

describe('extractSymbolNodes — modern React component forms', () => {
  it('detects forwardRef components', () => {
    const nodes = extract(
      'src/Field.tsx',
      `import { forwardRef } from 'react';
       export const Field = forwardRef((props, ref) => <input ref={ref} />);`,
    );
    expect(byName(nodes, 'Field')?.type).toBe('component');
  });

  it('detects memo components', () => {
    const nodes = extract(
      'src/Row.tsx',
      `import { memo } from 'react';
       export const Row = memo(() => <tr><td>x</td></tr>);`,
    );
    expect(byName(nodes, 'Row')?.type).toBe('component');
  });

  it('detects React.forwardRef / React.memo namespaced calls', () => {
    const nodes = extract(
      'src/Box.tsx',
      `import React from 'react';
       export const Box = React.forwardRef((p, ref) => <div ref={ref} />);`,
    );
    expect(byName(nodes, 'Box')?.type).toBe('component');
  });

  it('detects HOC-wrapped components', () => {
    const nodes = extract(
      'src/Page.tsx',
      `export const Page = withAuth(() => <main>secret</main>);`,
    );
    expect(byName(nodes, 'Page')?.type).toBe('component');
  });

  it('detects class components extending React.Component', () => {
    const nodes = extract(
      'src/Legacy.tsx',
      `import React from 'react';
       export class Legacy extends React.Component {
         render() { return <div/>; }
       }`,
    );
    expect(byName(nodes, 'Legacy')?.type).toBe('component');
  });

  it('detects PureComponent class components', () => {
    const nodes = extract(
      'src/Pure.tsx',
      `import { PureComponent } from 'react';
       export class Pure extends PureComponent {
         render() { return <span/>; }
       }`,
    );
    expect(byName(nodes, 'Pure')?.type).toBe('component');
  });

  it('names anonymous default arrow exports from the filename', () => {
    const nodes = extract(
      'src/dashboard/page.tsx',
      `export default () => <section>dash</section>;`,
    );
    const comp = byName(nodes, 'Page');
    expect(comp?.type).toBe('component');
  });

  it('names anonymous default function exports from the filename', () => {
    const nodes = extract(
      'src/user-card.tsx',
      `export default function () { return <article/>; }`,
    );
    expect(byName(nodes, 'UserCard')?.type).toBe('component');
  });

  it('uses the directory name for index files', () => {
    const nodes = extract(
      'src/settings/index.tsx',
      `export default () => <div>settings</div>;`,
    );
    expect(byName(nodes, 'Settings')?.type).toBe('component');
  });

  it('still classifies a plain exported helper as a function', () => {
    const nodes = extract(
      'src/util.ts',
      `export const add = (a: number, b: number) => a + b;`,
    );
    expect(byName(nodes, 'add')?.type).toBe('function');
  });

  it('classifies a PascalCase non-JSX export in a .ts file as a function', () => {
    const nodes = extract(
      'src/Factory.ts',
      `export const Factory = () => ({ build: () => 1 });`,
    );
    expect(byName(nodes, 'Factory')?.type).toBe('function');
  });

  it('gives same-named symbols stable, line-independent occurrence ids', () => {
    const nodes = extract(
      'src/dupe.ts',
      `export function parse() { return 1; }\nfunction parse() { return 2; }`,
    );
    // Only the exported one is emitted; its id has no line number.
    const parse = byName(nodes, 'parse');
    expect(parse?.id).toBe('fn:src/dupe.ts#parse');
  });
});

describe('extractSymbolNodes — signatures', () => {
  const sig = (rel: string, code: string, name: string): string | null => {
    const node = byName(extract(rel, code), name);
    return node && 'signature' in node ? node.signature : null;
  };

  it('captures a function signature from written param + return types', () => {
    expect(
      sig('src/svc.ts', `export function make(client: HttpClient): Service { return client as any; }`, 'make'),
    ).toBe('(client: HttpClient) => Service');
  });

  it('captures an arrow function assigned to a const', () => {
    expect(
      sig('src/util.ts', `export const toWire = (d: Draft): Wire => ({} as Wire);`, 'toWire'),
    ).toBe('(d: Draft) => Wire');
  });

  it('marks optional params and omits an absent return type', () => {
    expect(
      sig('src/fmt.ts', `export const fmt = (n: number, opts?: Opts) => String(n);`, 'fmt'),
    ).toBe('(n: number, opts?: Opts)');
  });

  it("captures a component's props type as its signature", () => {
    const s = sig(
      'src/Card.tsx',
      `export const Card = (props: CardProps) => <div>{props.title}</div>;`,
      'Card',
    );
    expect(s).toBe('(props: CardProps)');
  });

  it('is null for a non-function symbol', () => {
    expect(sig('src/c.ts', `export const config = { a: 1 };`, 'config')).toBeNull();
  });
});
