// ============================================================================
// PATH UTILITIES - Path resolution and discovery
// ============================================================================

import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

/**
 * Get the directory name of the current module (ES module compatible)
 */
export function getDirname(importMetaUrl: string): string {
  const __filename = fileURLToPath(importMetaUrl);
  return path.dirname(__filename);
}

/**
 * Find a file by walking up the directory tree
 * @param startDir - Directory to start searching from
 * @param fileName - Name of the file to find
 * @returns Absolute path to the file, or null if not found
 */
export function findUp(startDir: string, fileName: string): string | null {
  let current = path.resolve(startDir);

  while (true) {
    const candidate = path.join(current, fileName);
    if (fs.existsSync(candidate)) {
      return candidate;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      // Reached filesystem root
      return null;
    }
    current = parent;
  }
}

/**
 * Find the monorepo root by looking for pnpm-workspace.yaml or package.json with workspaces
 */
export function findWorkspaceRoot(startDir?: string): string {
  const start = startDir || process.cwd();

  const workspaceFile = findUp(start, 'pnpm-workspace.yaml');
  if (workspaceFile) {
    return path.dirname(workspaceFile);
  }

  // Fallback: look for package.json with workspaces field
  let current = path.resolve(start);
  while (true) {
    const pkgPath = path.join(current, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { workspaces?: unknown };
        if (pkg.workspaces) {
          return current;
        }
      } catch {
        // Invalid JSON, continue searching
      }
    }

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  // Default to current directory
  return start;
}

/**
 * Get the tools directory path
 */
export function getToolsDir(startDir?: string): string {
  const root = findWorkspaceRoot(startDir);
  return path.join(root, 'tools');
}

/**
 * Resolve a path relative to the workspace root
 */
export function resolveFromRoot(relativePath: string, startDir?: string): string {
  const root = findWorkspaceRoot(startDir);
  return path.resolve(root, relativePath);
}

/**
 * Resolve a path relative to the tools directory
 */
export function resolveFromToolsDir(relativePath: string, startDir?: string): string {
  const toolsDir = getToolsDir(startDir);
  return path.resolve(toolsDir, relativePath);
}

/**
 * Get all tool directories in the tools/ folder
 */
export function getToolDirectories(startDir?: string): string[] {
  const toolsDir = getToolsDir(startDir);

  if (!fs.existsSync(toolsDir)) {
    return [];
  }

  return fs.readdirSync(toolsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('_') && !entry.name.startsWith('.'))
    .map(entry => path.join(toolsDir, entry.name));
}

/**
 * Check if a path is inside the tools directory
 */
export function isInsideToolsDir(targetPath: string, startDir?: string): boolean {
  const toolsDir = getToolsDir(startDir);
  const resolved = path.resolve(targetPath);
  return resolved.startsWith(toolsDir);
}

/**
 * Get relative path from workspace root
 */
export function getRelativeFromRoot(targetPath: string, startDir?: string): string {
  const root = findWorkspaceRoot(startDir);
  return path.relative(root, path.resolve(targetPath));
}