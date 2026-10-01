import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { GraphNode } from '@repo/code-graph-core';
import { IndexerSession } from '../session.js';
import { readNodeSource } from './read-source.js';

let sandbox: string;
let root: string;
let secret: string;

const write = (rel: string, content: string): void => {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
};

const fileNode = (nodes: GraphNode[], rel: string): GraphNode => {
  const node = nodes.find((n) => n.id === `file:${rel}`);
  if (!node) throw new Error(`no file node for ${rel}`);
  return node;
};

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-readsrc-'));
  root = path.join(sandbox, 'repo');
  secret = path.join(sandbox, 'secret.env');
  fs.writeFileSync(secret, 'API_KEY=must-not-leak\n', 'utf-8');
  write('package.json', JSON.stringify({ name: 'demo', version: '1.0.0' }));
  write(
    'tsconfig.json',
    JSON.stringify({ compilerOptions: { strict: true }, include: ['src'] }),
  );
  write('src/a.ts', 'export const a = 1;\n');
  write('src/real.ts', 'export const real = 2;\n');
});

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe('readNodeSource', () => {
  it('reads a file inside the repo', () => {
    const { nodes } = new IndexerSession(root).indexFull();
    expect(readNodeSource(root, fileNode(nodes, 'src/a.ts'))).toBe('export const a = 1;\n');
  });

  it('refuses a symlink that points outside the repo', () => {
    fs.symlinkSync(secret, path.join(root, 'src/env.ts'));
    const { nodes } = new IndexerSession(root).indexFull();
    expect(readNodeSource(root, fileNode(nodes, 'src/env.ts'))).toBe('');
  });

  it('still reads a symlink that stays inside the repo', () => {
    fs.symlinkSync(path.join(root, 'src/real.ts'), path.join(root, 'src/alias.ts'));
    const { nodes } = new IndexerSession(root).indexFull();
    expect(readNodeSource(root, fileNode(nodes, 'src/alias.ts'))).toBe(
      'export const real = 2;\n',
    );
  });

  it('refuses a node path that climbs out of the root', () => {
    const { nodes } = new IndexerSession(root).indexFull();
    const node = { ...fileNode(nodes, 'src/a.ts'), path: '../secret.env' } as GraphNode;
    expect(readNodeSource(root, node)).toBe('');
  });

  it('returns empty for a file that no longer exists', () => {
    const { nodes } = new IndexerSession(root).indexFull();
    fs.rmSync(path.join(root, 'src/a.ts'));
    expect(readNodeSource(root, fileNode(nodes, 'src/a.ts'))).toBe('');
  });
});
