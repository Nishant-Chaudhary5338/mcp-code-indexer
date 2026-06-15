import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { IndexerSession } from '../session.js';
import {
  writeSnapshot,
  readHashIndex,
  readSnapshot,
} from './cache.js';
import {
  buildReusableSubgraph,
  indexStructure,
} from '../structural/micro-symbols.js';
import { discoverWorkspace } from '../discovery/discover-workspace.js';
import { createConfig } from '../../config.js';

let root: string;

const write = (rel: string, content: string): void => {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-incr-'));
  // Standalone single-package repo.
  write(
    'package.json',
    JSON.stringify({ name: 'demo', version: '1.0.0' }, null, 2),
  );
  write(
    'tsconfig.json',
    JSON.stringify(
      {
        compilerOptions: { jsx: 'react-jsx', strict: true },
        include: ['src'],
      },
      null,
      2,
    ),
  );
  write('src/a.ts', `export const add = (x: number, y: number) => x + y;\n`);
  write('src/b.ts', `export const mul = (x: number, y: number) => x * y;\n`);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('incremental reindex', () => {
  it('persists a per-file content-hash sidecar', () => {
    const session = new IndexerSession(root);
    const snapshot = session.indexFull();
    writeSnapshot(root, snapshot);

    const hashes = readHashIndex(root);
    expect(hashes).toBeTruthy();
    expect(hashes?.['src/a.ts']).toBeTruthy();
    expect(hashes?.['src/b.ts']).toBeTruthy();
  });

  it('reuses unchanged files and only reparses the edited one', () => {
    const session = new IndexerSession(root);
    const first = session.indexFull();
    writeSnapshot(root, first);

    // Edit only b.ts (add a blank line above to prove ids stay stable too).
    write('src/b.ts', `\nexport const mul = (x: number, y: number) => x * y;\n`);

    const hashes = readHashIndex(root)!;
    const prior = buildReusableSubgraph(first, hashes);
    // Re-run structure with the prior cache via a fresh session hydrated to it.
    const session2 = new IndexerSession(root);
    session2.hydrate(first);
    const second = session2.reindexIncremental();

    // The graph is correct: still has both files, no duplicates, no orphans.
    const fileNodes = second.nodes.filter((n) => n.type === 'file');
    const paths = fileNodes.map((n) => (n.type === 'file' ? n.path : '')).sort();
    expect(paths).toEqual(['src/a.ts', 'src/b.ts']);

    // a.ts content hash is unchanged; b.ts changed.
    const aHash = prior.hashes['src/a.ts'];
    const aNode = fileNodes.find((n) => n.type === 'file' && n.path === 'src/a.ts');
    expect(aNode?.contentHash).toBe(aHash);

    // The function id for mul is line-independent and unchanged after the edit.
    const mul = second.nodes.find((n) => n.name === 'mul');
    expect(mul?.id).toBe('fn:src/b.ts#mul');
  });

  it('skips re-extraction for unchanged files (reuse > 0, reparse minimal)', () => {
    const config = createConfig(root);
    const workspace = discoverWorkspace(root);
    const first = indexStructure(config, workspace);
    expect(first.reparsedFiles).toBe(2);
    expect(first.reusedFiles).toBe(0);

    // Edit only b.ts.
    write('src/b.ts', `export const mul = (x: number, y: number) => x * y + 1;\n`);

    const snapshot = {
      nodes: first.nodes,
      edges: first.edges,
    };
    const hashes: Record<string, string> = {};
    for (const n of first.nodes) {
      if (n.type === 'file' && n.contentHash) hashes[n.path] = n.contentHash;
    }
    const prior = buildReusableSubgraph(snapshot, hashes);
    const second = indexStructure(config, workspace, prior);

    // a.ts reused, b.ts reparsed — the whole repo is NOT re-parsed.
    expect(second.reusedFiles).toBe(1);
    expect(second.reparsedFiles).toBe(1);
  });

  it('removes nodes for files that disappear', () => {
    const session = new IndexerSession(root);
    const first = session.indexFull();
    writeSnapshot(root, first);

    fs.rmSync(path.join(root, 'src/b.ts'));

    const session2 = new IndexerSession(root);
    session2.hydrate(first);
    const second = session2.reindexIncremental();

    const paths = second.nodes
      .filter((n) => n.type === 'file')
      .map((n) => (n.type === 'file' ? n.path : ''));
    expect(paths).toContain('src/a.ts');
    expect(paths).not.toContain('src/b.ts');
    // No orphan symbol node for the removed file.
    expect(second.nodes.some((n) => n.id === 'fn:src/b.ts#mul')).toBe(false);
  });

  it('round-trips through the persisted snapshot schema', () => {
    const session = new IndexerSession(root);
    const snapshot = session.indexFull();
    writeSnapshot(root, snapshot);
    // readSnapshot validates against the discriminated-union schema.
    expect(() => readSnapshot(root)).not.toThrow();
  });
});

describe('reparseFiles (live edit)', () => {
  it('refreshes structural nodes/spans for an edited file and returns a patch', () => {
    const session = new IndexerSession(root);
    session.indexFull();

    // Add a new exported component to b.ts (structural change, not just status).
    write(
      'src/b.tsx',
      `export const Widget = () => <div>hi</div>;\n`,
    );
    const patch = session.reparseFiles([path.join(root, 'src/b.tsx')]);

    const widget = patch.upsertNodes.find((n) => n.name === 'Widget');
    expect(widget?.type).toBe('component');
    // The session snapshot now contains the new component node.
    const snap = session.getSnapshot()!;
    expect(snap.nodes.some((n) => n.id === 'cmp:src/b.tsx#Widget')).toBe(true);
  });

  it('removes nodes when a file is deleted on disk', () => {
    const session = new IndexerSession(root);
    session.indexFull();
    const abs = path.join(root, 'src/b.ts');
    fs.rmSync(abs);

    const patch = session.reparseFiles([abs]);
    expect(patch.removeNodeIds).toContain('file:src/b.ts');
    expect(patch.upsertNodes.some((n) => n.id === 'fn:src/b.ts#mul')).toBe(false);
    const snap = session.getSnapshot()!;
    expect(snap.nodes.some((n) => n.id === 'fn:src/b.ts#mul')).toBe(false);
  });

  it('reflects a removed symbol after an edit without leaving orphans', () => {
    const session = new IndexerSession(root);
    session.indexFull();
    // Remove the `mul` export entirely.
    write('src/b.ts', `export const div = (x: number, y: number) => x / y;\n`);
    const patch = session.reparseFiles([path.join(root, 'src/b.ts')]);

    expect(patch.removeNodeIds).toContain('fn:src/b.ts#mul');
    const snap = session.getSnapshot()!;
    expect(snap.nodes.some((n) => n.id === 'fn:src/b.ts#mul')).toBe(false);
    expect(snap.nodes.some((n) => n.id === 'fn:src/b.ts#div')).toBe(true);
  });

  it('re-resolves importers so symbol edges into a changed file never dangle', () => {
    // Header exports two components; App imports and renders both.
    write(
      'src/Header.tsx',
      `export const Header = () => <h1/>;\nexport const Footer = () => <footer/>;\n`,
    );
    write(
      'src/App.tsx',
      `import { Header, Footer } from './Header';\n` +
        `export const App = () => <div><Header/><Footer/></div>;\n`,
    );
    const session = new IndexerSession(root);
    session.indexFull();

    const appRenderTargets = (): string[] =>
      session
        .getSnapshot()!
        .edges.filter(
          (e) => e.type === 'renders' && e.source === 'cmp:src/App.tsx#App',
        )
        .map((e) => e.target)
        .sort();

    // Both renders edges resolve cross-file on the full index.
    expect(appRenderTargets()).toEqual([
      'cmp:src/Header.tsx#Footer',
      'cmp:src/Header.tsx#Header',
    ]);

    // Remove the Header export (keep Footer), then reparse ONLY Header.tsx.
    write('src/Header.tsx', `export const Footer = () => <footer/>;\n`);
    session.reparseFiles([path.join(root, 'src/Header.tsx')]);
    const snap = session.getSnapshot()!;

    // App was re-resolved as an importer: its edge to the now-gone Header
    // component is dropped rather than left pointing at a removed node.
    const ids = new Set(snap.nodes.map((n) => n.id));
    const dangling = snap.edges.filter(
      (e) => !ids.has(e.source) || !ids.has(e.target),
    );
    expect(dangling).toEqual([]);
    expect(snap.nodes.some((n) => n.id === 'cmp:src/Header.tsx#Header')).toBe(
      false,
    );
    expect(appRenderTargets()).toEqual(['cmp:src/Header.tsx#Footer']);
  });
});
