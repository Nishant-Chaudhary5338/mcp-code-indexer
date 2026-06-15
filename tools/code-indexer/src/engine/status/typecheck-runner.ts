import * as fs from 'fs';
import * as path from 'path';
import { Project, ts } from 'ts-morph';

export type FileTypeStatus = { typeErrors: number; firstMessage: string | null };

// Cross-package module-resolution noise (unbuilt workspace deps). Excluded so a
// package isn't marked broken just because a sibling's dist is missing.
const IGNORED_CODES = new Set<number>([2307]);

const TSCONFIG_CANDIDATES = ['tsconfig.app.json', 'tsconfig.json'];

const findTsconfig = (pkgAbsPath: string): string | null => {
  for (const candidate of TSCONFIG_CANDIDATES) {
    const full = path.join(pkgAbsPath, candidate);
    if (fs.existsSync(full)) return full;
  }
  return null;
};

export const runTypecheck = (
  pkgAbsPath: string,
  root: string,
): Map<string, FileTypeStatus> => {
  const result = new Map<string, FileTypeStatus>();
  const tsConfigFilePath = findTsconfig(pkgAbsPath);
  if (!tsConfigFilePath) return result;

  const project = new Project({
    tsConfigFilePath,
    skipAddingFilesFromTsConfig: false,
    compilerOptions: { noEmit: true, incremental: false },
  });

  for (const diagnostic of project.getPreEmitDiagnostics()) {
    if (IGNORED_CODES.has(diagnostic.getCode())) continue;
    if (diagnostic.getCategory() !== ts.DiagnosticCategory.Error) continue;
    const sourceFile = diagnostic.getSourceFile();
    if (!sourceFile) continue;
    const abs = sourceFile.getFilePath();
    if (abs.includes('node_modules')) continue;
    if (!abs.startsWith(pkgAbsPath + path.sep)) continue;

    const rel = path.relative(root, abs);
    const existing = result.get(rel) ?? { typeErrors: 0, firstMessage: null };
    const message = ts.flattenDiagnosticMessageText(
      diagnostic.compilerObject.messageText,
      '\n',
    );
    result.set(rel, {
      typeErrors: existing.typeErrors + 1,
      firstMessage: existing.firstMessage ?? message,
    });
  }

  return result;
};
