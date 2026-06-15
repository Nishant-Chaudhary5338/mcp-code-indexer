import { describe, it, expect } from 'vitest';
import { Project } from 'ts-morph';
import { isPascalCase, returnsJsx } from './detect-components.js';

describe('isPascalCase', () => {
  it('accepts PascalCase identifiers', () => {
    expect(isPascalCase('Button')).toBe(true);
    expect(isPascalCase('UserCard')).toBe(true);
  });

  it('rejects camelCase and helpers', () => {
    expect(isPascalCase('useStore')).toBe(false);
    expect(isPascalCase('parseInput')).toBe(false);
    expect(isPascalCase('_private')).toBe(false);
  });
});

describe('returnsJsx', () => {
  const project = new Project({ useInMemoryFileSystem: true });

  it('detects a function returning JSX', () => {
    const sf = project.createSourceFile(
      'a.tsx',
      'export const Card = () => <div>hi</div>;',
    );
    const decl = sf.getVariableDeclarationOrThrow('Card');
    const init = decl.getInitializerOrThrow();
    expect(returnsJsx(init)).toBe(true);
  });

  it('returns false for a plain helper', () => {
    const sf = project.createSourceFile(
      'b.ts',
      'export const add = (a: number, b: number) => a + b;',
    );
    const decl = sf.getVariableDeclarationOrThrow('add');
    const init = decl.getInitializerOrThrow();
    expect(returnsJsx(init)).toBe(false);
  });

  it('does NOT classify a factory whose nested callback contains JSX', () => {
    // The outer function returns a function; only the inner callback renders
    // JSX. returnsJsx must look at the OUTER return value, not any descendant.
    const sf = project.createSourceFile(
      'factory.tsx',
      'export const makeRenderer = () => (items: number[]) => items.map((i) => <li>{i}</li>);',
    );
    const init = sf.getVariableDeclarationOrThrow('makeRenderer').getInitializerOrThrow();
    expect(returnsJsx(init)).toBe(false);
  });

  it('detects JSX returned from a block body with an early return', () => {
    const sf = project.createSourceFile(
      'guard.tsx',
      'export const Card = (ok: boolean) => { if (!ok) return null; return <div/>; };',
    );
    const init = sf.getVariableDeclarationOrThrow('Card').getInitializerOrThrow();
    expect(returnsJsx(init)).toBe(true);
  });

  it('detects JSX returned via a conditional expression', () => {
    const sf = project.createSourceFile(
      'cond.tsx',
      'export const Card = (ok: boolean) => ok ? <a/> : <b/>;',
    );
    const init = sf.getVariableDeclarationOrThrow('Card').getInitializerOrThrow();
    expect(returnsJsx(init)).toBe(true);
  });

  it('detects JSX returned via logical && short-circuit', () => {
    const sf = project.createSourceFile(
      'logical.tsx',
      'export const Card = (ok: boolean) => ok && <a/>;',
    );
    const init = sf.getVariableDeclarationOrThrow('Card').getInitializerOrThrow();
    expect(returnsJsx(init)).toBe(true);
  });
});
