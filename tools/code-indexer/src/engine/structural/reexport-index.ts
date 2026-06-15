import * as path from 'path';
import { type SourceFile } from 'ts-morph';
import { nameFromFile } from './symbol-nodes.js';
import type { SymbolRef } from './semantic-edges.js';

/**
 * A re-export barrel entry. `fromRel` is the (root-relative, forward-slashed)
 * file the name re-exports from; `originalName` is the export name *in that
 * file* (for `export { A as B } from './x'`, B's `originalName` is `A`; for
 * `export { default as B }`, it is the file's filename-derived default name).
 */
type NamedReexport = { fromRel: string; originalName: string };

/**
 * Per-file view of its re-exports with a module specifier:
 *   - `named`:  exportName (as seen by an importer) -> where it actually lives.
 *   - `stars`:  the `fromRel`s of every `export * from './x'` (chased in order).
 */
export type ReexportEntry = {
  named: Map<string, NamedReexport>;
  stars: string[];
};

/** Project-wide map: barrel file relPath -> its re-export entry. */
export type ReexportIndex = Map<string, ReexportEntry>;

// Mirror of semantic-edges' / import-edges' toRel: drop node_modules + out-of-root,
// normalize separators so keys match the SymbolIndex's relPaths.
const toRel = (root: string, target: SourceFile): string | null => {
  const abs = target.getFilePath();
  if (abs.includes('node_modules')) return null;
  const rel = path.relative(root, abs);
  if (rel.startsWith('..')) return null;
  return rel.replace(/\\/g, '/');
};

/**
 * Scan every source file's `export ... from` declarations into a project-wide
 * re-export index, so a name imported from a barrel can later be chased to the
 * file that actually declares it. Mirrors import-edges' handling of
 * `export {x} from` / `export {x as y} from` / `export {default as y} from` /
 * `export * from`. Local re-exports (no module specifier) are ignored here —
 * those resolve through the importing file's own symbol table.
 */
export const buildReexportIndex = (
  sourceFiles: SourceFile[],
  root: string,
): ReexportIndex => {
  const index: ReexportIndex = new Map();

  for (const source of sourceFiles) {
    const fileRel = toRel(root, source);
    if (!fileRel) continue;

    for (const decl of source.getExportDeclarations()) {
      if (!decl.getModuleSpecifier()) continue; // local re-export, no specifier
      const target = decl.getModuleSpecifierSourceFile();
      if (!target) continue;
      const fromRel = toRel(root, target);
      if (!fromRel) continue;

      let entry = index.get(fileRel);
      if (!entry) {
        entry = { named: new Map(), stars: [] };
        index.set(fileRel, entry);
      }

      const namespaceExport = decl.getNamespaceExport();
      const namedExports = decl.getNamedExports();

      if (namedExports.length === 0 && !namespaceExport) {
        // Bare `export * from './x'`.
        entry.stars.push(fromRel);
        continue;
      }

      // `export * as ns from './x'` aggregates a namespace, not a single name we
      // can resolve to one symbol — skip (conservative; no edge beats a wrong one).

      for (const spec of namedExports) {
        const exportedAs = spec.getAliasNode()?.getText() ?? spec.getName();
        const sourceName = spec.getName();
        // `export { default as X } from './y'` resolves to y's default symbol,
        // which symbol-nodes names from the filename.
        const originalName =
          sourceName === 'default' ? nameFromFile(fromRel) : sourceName;
        // First declaration of a re-exported name wins (matches SymbolIndex).
        if (!entry.named.has(exportedAs)) {
          entry.named.set(exportedAs, { fromRel, originalName });
        }
      }
    }
  }

  return index;
};

/** SymbolIndex-style lookup: (fileRel, name) -> the symbol node, or null. */
type Lookup = (rel: string, name: string) => SymbolRef | null;

/**
 * Chase a re-export barrel to the symbol it ultimately exposes. Given a barrel
 * `fileRel` and the `exportName` an importer asked for:
 *   1. follow a named re-export (recursing with its `originalName` into `fromRel`),
 *   2. else try each `export *` target in declaration order,
 * stopping as soon as `lookup(rel, name)` hits a real indexed node. The `seen`
 * set keys on `fileRel#exportName` so mutually-recursive barrels terminate
 * instead of looping. Returns null when nothing resolves (conservative).
 */
export const resolveExport = (
  index: ReexportIndex,
  fileRel: string,
  exportName: string,
  lookup: Lookup,
  seen: Set<string> = new Set(),
): SymbolRef | null => {
  const key = `${fileRel}#${exportName}`;
  if (seen.has(key)) return null;
  seen.add(key);

  const entry = index.get(fileRel);
  if (!entry) return null;

  const named = entry.named.get(exportName);
  if (named) {
    // Direct hit in the re-export target's own symbol table…
    const direct = lookup(named.fromRel, named.originalName);
    if (direct) return direct;
    // …otherwise the target is itself a barrel: recurse with the original name.
    const chased = resolveExport(
      index,
      named.fromRel,
      named.originalName,
      lookup,
      seen,
    );
    if (chased) return chased;
  }

  // Fall through to `export *` targets, in declaration order.
  for (const starRel of entry.stars) {
    const direct = lookup(starRel, exportName);
    if (direct) return direct;
    const chased = resolveExport(index, starRel, exportName, lookup, seen);
    if (chased) return chased;
  }

  return null;
};
