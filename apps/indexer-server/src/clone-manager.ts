import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, statSync, type Dirent } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** A validated public GitHub repository reference. */
export interface RepoRef {
  owner: string;
  repo: string;
  /** Stable, filesystem- and URL-safe id, e.g. `gh_facebook_react`. */
  id: string;
  /** Human label, e.g. `facebook/react`. */
  label: string;
  /** Canonical clone URL. */
  cloneUrl: string;
}

export interface CloneResult {
  ref: RepoRef;
  /** Absolute path of the cloned working tree (caller owns cleanup). */
  dir: string;
}

/** Guards against runaway clones on a public, unauthenticated endpoint. */
const CLONE_TIMEOUT_MS = 90_000;
/** Reject repos with more TS/TSX source than the indexer should chew through. */
const MAX_SOURCE_FILES = 4000;
/**
 * Hard disk budget for a single clone's working tree, polled DURING the clone so
 * a multi-GB binary/media repo is killed before it fills the host disk (the
 * source-file count only runs after the clone lands, which is too late on its own).
 */
const MAX_CLONE_BYTES = 600 * 1024 * 1024;
/** How often the disk-size guard samples the growing clone. */
const SIZE_POLL_MS = 3000;
/**
 * Owner/repo segment. GitHub's allowed set, but must START with an alphanumeric
 * — this rejects leading-hyphen names like `-foo` that can never be a real repo
 * and that read like CLI options, so a clone arg can never look like a flag.
 */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Parse and validate a user-supplied GitHub URL. Only `github.com` https/ssh
 * forms for a concrete `owner/repo` are accepted — anything else (other hosts,
 * gists, query strings, path traversal) is rejected so the endpoint can't be
 * pointed at arbitrary git remotes.
 */
export const parseGithubUrl = (raw: string): RepoRef | null => {
  const trimmed = raw.trim();
  // Accept: https://github.com/owner/repo(.git), github.com/owner/repo,
  // git@github.com:owner/repo(.git), owner/repo.
  const patterns = [
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i,
    /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?\/?$/i,
    /^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/,
  ];
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (!match) continue;
    const owner = match[1];
    const repo = match[2];
    if (!SEGMENT.test(owner) || !SEGMENT.test(repo)) return null;
    return {
      owner,
      repo,
      id: `gh_${owner}_${repo}`.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
      label: `${owner}/${repo}`,
      cloneUrl: `https://github.com/${owner}/${repo}.git`,
    };
  }
  return null;
};

/** Total bytes under `dir`, short-circuiting as soon as `cap` is exceeded. */
const dirSizeOver = (dir: string, cap: number): boolean => {
  let total = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    let entries: Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        try {
          total += statSync(full).size;
        } catch {
          /* file vanished mid-clone — ignore */
        }
        if (total > cap) return true;
      }
    }
  }
  return false;
};

/** Count TS/TSX source files, bailing out as soon as the cap is exceeded. */
const countSourceFiles = (dir: string, cap: number): number => {
  let count = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    let entries: Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        stack.push(path.join(current, entry.name));
      } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
        count += 1;
        if (count > cap) return count;
      }
    }
  }
  return count;
};

/**
 * Shallow-clone a public GitHub repo into a fresh temp dir. The clone is depth-1,
 * single-branch, and killed if it overruns {@link CLONE_TIMEOUT_MS}. After it
 * lands, repos with more than {@link MAX_SOURCE_FILES} TS/TSX files are rejected
 * (and cleaned up) so a giant monorepo can't pin the indexer for minutes.
 *
 * The temp dir is created OUTSIDE any workspace so the engine's upward
 * workspace-root discovery can't climb into an unrelated project.
 */
export const cloneRepo = async (ref: RepoRef): Promise<CloneResult> => {
  const dir = mkdtempSync(path.join(os.tmpdir(), `codeatlas-${ref.id}-`));

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      'git',
      [
        'clone',
        '--depth',
        '1',
        '--single-branch',
        '--no-tags',
        ref.cloneUrl,
        dir,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );

    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length < 4096) stderr += chunk;
    });

    let settled = false;
    const fail = (message: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(sizeGuard);
      child.kill('SIGKILL');
      reject(new Error(message));
    };

    const timer = setTimeout(
      () => fail('Clone timed out — repository is too large or slow.'),
      CLONE_TIMEOUT_MS,
    );
    // Poll the working tree as it grows; kill before it can fill the disk.
    const sizeGuard = setInterval(() => {
      if (dirSizeOver(dir, MAX_CLONE_BYTES)) {
        fail('Repository exceeds the size limit for the live demo.');
      }
    }, SIZE_POLL_MS);
    sizeGuard.unref?.();

    child.on('error', (err) => fail(`git clone failed: ${err.message}`));
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(sizeGuard);
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `git clone exited with code ${code}`));
    });
  }).catch((err: unknown) => {
    cleanupClone(dir);
    throw err;
  });

  if (countSourceFiles(dir, MAX_SOURCE_FILES) > MAX_SOURCE_FILES) {
    cleanupClone(dir);
    throw new Error(
      `Repository has more than ${MAX_SOURCE_FILES} source files — too large for the live demo.`,
    );
  }

  return { ref, dir };
};

/** Best-effort removal of a clone's working tree. */
export const cleanupClone = (dir: string): void => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* already gone */
  }
};
