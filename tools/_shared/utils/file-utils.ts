// ============================================================================
// FILE UTILITIES - Common file operations
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * Stable content hash (sha256, hex) of a string. Used by the code-graph engine
 * to decide whether a file's structure can be reused on an incremental reindex.
 * Newline-normalized so a pure CRLF<->LF change does not invalidate the cache.
 */
export function hashContent(content: string): string {
  const normalized = content.replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(normalized, 'utf-8').digest('hex');
}

/**
 * Content hash of a file on disk, or null if it cannot be read.
 */
export function hashFile(filePath: string): string | null {
  try {
    return hashContent(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Ensure a directory exists, creating it if necessary
 */
export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Check if a path exists
 */
export function pathExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

/**
 * Check if a path is a directory
 */
export function isDirectory(dirPath: string): boolean {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Check if a path is a file
 */
export function isFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/**
 * Read a file as UTF-8 string
 */
export function readFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf-8');
}

/**
 * Write content to a file
 */
export function writeFile(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  ensureDir(dir);
  fs.writeFileSync(filePath, content, 'utf-8');
}

/**
 * Read and parse JSON file
 */
export function readJsonFile<T = unknown>(filePath: string): T {
  const content = readFile(filePath);
  return JSON.parse(content) as T;
}

/**
 * Write object to JSON file
 */
export function writeJsonFile(filePath: string, data: unknown, pretty = true): void {
  const content = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
  writeFile(filePath, content);
}

/**
 * List files in a directory
 */
export function listFiles(dirPath: string, filter?: (name: string) => boolean): string[] {
  if (!fs.existsSync(dirPath)) return [];
  const entries = fs.readdirSync(dirPath);
  return filter ? entries.filter(filter) : entries;
}

/**
 * List directories in a directory
 */
export function listDirs(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name);
}

/**
 * Find files matching a pattern recursively
 */
export function findFiles(dirPath: string, pattern: RegExp): string[] {
  const results: string[] = [];

  if (!fs.existsSync(dirPath)) return results;

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      results.push(...findFiles(fullPath, pattern));
    } else if (pattern.test(entry.name)) {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * Copy a file
 */
export function copyFile(src: string, dest: string): void {
  const dir = path.dirname(dest);
  ensureDir(dir);
  fs.copyFileSync(src, dest);
}

/**
 * Delete a file
 */
export function deleteFile(filePath: string): void {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

/**
 * Delete a directory recursively
 */
export function deleteDir(dirPath: string): void {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}

/**
 * Get file extension
 */
export function getExtension(filePath: string): string {
  return path.extname(filePath).slice(1);
}

/**
 * Get file name without extension
 */
export function getBaseName(filePath: string): string {
  return path.basename(filePath, path.extname(filePath));
}