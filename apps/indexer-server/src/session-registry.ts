import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { GraphSnapshot } from '@repo/code-graph-core';
import { GraphService } from './graph-service.js';
import { Semaphore } from './semaphore.js';
import { cloneRepo, parseGithubUrl, cleanupClone, type RepoRef } from './clone-manager.js';

export type RepoStatus = 'cloning' | 'indexing' | 'ready' | 'error';

export interface RepoEntry {
  id: string;
  label: string;
  origin: 'live' | 'curated' | 'github';
  status: RepoStatus;
  graph: GraphService | null;
  /** Working-tree dir for cloned repos (owned here; cleaned on eviction). */
  dir: string | null;
  nodeCount: number | null;
  edgeCount: number | null;
  error: string | null;
  lastAccess: number;
  /** In-flight build, so concurrent requests for the same repo share one. */
  building: Promise<void> | null;
  /** Pinned repos (curated showcase) are never evicted out from under the demo. */
  pinned: boolean;
}

/** Public-facing view of an entry (no GraphService / filesystem details). */
export interface RepoSummary {
  id: string;
  label: string;
  origin: RepoEntry['origin'];
  status: RepoStatus;
  nodeCount: number | null;
  edgeCount: number | null;
  error: string | null;
}

/**
 * Cap on simultaneous worker-process indexes. Each worker is a separate Node
 * process, so on a small (512MB) instance set this to 1 via env so two workers
 * can't together exceed the container's memory.
 */
const MAX_CONCURRENT_BUILDS = Number(process.env.MAX_CONCURRENT_BUILDS ?? 2);
/** Cap on resident cloned github repos; least-recently-used are evicted. */
const MAX_GITHUB_REPOS = 6;
/** Wall-clock budget for one worker index before it's killed. */
const INDEX_TIMEOUT_MS = 180_000;
/**
 * Grace period before an evicted clone's working tree is deleted, so a request
 * that resolved the graph just before eviction can finish reading source off
 * disk. The entry is removed from the map immediately (no new request can reach
 * it); only the rm is deferred.
 */
const EVICT_CLEANUP_GRACE_MS = 30_000;
/** Worker heap cap (MB) — lower it via env on small (512MB-1GB) instances. */
const WORKER_HEAP_MB = Number(process.env.INDEX_WORKER_HEAP_MB ?? 4096);
/** Reject a worker snapshot larger than this before reading it into memory. */
const MAX_SNAPSHOT_BYTES = 512 * 1024 * 1024;

const WORKER_PATH = fileURLToPath(new URL('./index-worker.ts', import.meta.url));

const message = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

const toSummary = (entry: RepoEntry): RepoSummary => ({
  id: entry.id,
  label: entry.label,
  origin: entry.origin,
  status: entry.status,
  nodeCount: entry.nodeCount,
  edgeCount: entry.edgeCount,
  error: entry.error,
});

/**
 * Multi-repo session registry. Holds one always-live default repo (registered by
 * the app, fully featured: watcher + reindex), any number of read-only curated
 * showcase repos, and on-demand github clones. Cloned repos are indexed in an
 * isolated worker process and served read-only; the least-recently-used clones
 * are evicted past {@link MAX_GITHUB_REPOS} to bound memory and disk on a public
 * host.
 */
export class SessionRegistry {
  private readonly entries = new Map<string, RepoEntry>();
  private readonly buildSlots = new Semaphore(MAX_CONCURRENT_BUILDS);
  private defaultRepoId: string | null = null;

  /** Register the pre-built, always-on default repo (local dev / boot repo). */
  registerLive(id: string, label: string, graph: GraphService): RepoEntry {
    const snapshot = graph.getSnapshot();
    const entry: RepoEntry = {
      id,
      label,
      origin: 'live',
      status: snapshot ? 'ready' : 'indexing',
      graph,
      dir: null,
      nodeCount: snapshot?.meta.nodeCount ?? null,
      edgeCount: snapshot?.meta.edgeCount ?? null,
      error: null,
      lastAccess: Date.now(),
      building: null,
      pinned: true,
    };
    this.entries.set(id, entry);
    this.defaultRepoId = id;
    return entry;
  }

  /** Reflect the default repo's snapshot counts once its boot index completes. */
  markLiveReady(id: string): void {
    const entry = this.entries.get(id);
    const snapshot = entry?.graph?.getSnapshot();
    if (!entry || !snapshot) return;
    entry.status = 'ready';
    entry.nodeCount = snapshot.meta.nodeCount;
    entry.edgeCount = snapshot.meta.edgeCount;
  }

  defaultId(): string | null {
    return this.defaultRepoId;
  }

  /** Queue a read-only curated showcase repo from a local path (idempotent). */
  ensureCurated(id: string, label: string, root: string): RepoEntry {
    const existing = this.entries.get(id);
    if (existing) return existing;
    const entry: RepoEntry = {
      id,
      label,
      origin: 'curated',
      status: 'indexing',
      graph: null,
      dir: root,
      nodeCount: null,
      edgeCount: null,
      error: null,
      lastAccess: Date.now(),
      building: null,
      pinned: true,
    };
    this.entries.set(id, entry);
    entry.building = this.buildSlots
      .run(() => this.buildReadOnly(entry, root))
      .catch((err: unknown) => {
        entry.status = 'error';
        entry.error = message(err);
      })
      .finally(() => {
        entry.building = null;
      });
    return entry;
  }

  /**
   * Resolve a github URL to an entry, starting clone+index if it's new. Returns
   * the entry immediately (likely `cloning`/`indexing`); callers poll status.
   */
  loadGithub(
    url: string,
    opts: { pinned?: boolean } = {},
  ): { entry: RepoEntry } | { error: string } {
    const ref = parseGithubUrl(url);
    if (!ref) return { error: 'Not a valid public GitHub repository URL.' };

    const existing = this.entries.get(ref.id);
    if (existing) {
      existing.lastAccess = Date.now();
      if (opts.pinned) existing.pinned = true;
      // Retry a previously-failed clone, but only when no build is in flight —
      // guards against two concurrent retries spawning duplicate clones.
      if (existing.status === 'error' && existing.building === null) {
        this.startGithubBuild(existing, ref);
      }
      return { entry: existing };
    }

    const entry: RepoEntry = {
      id: ref.id,
      label: ref.label,
      origin: 'github',
      status: 'cloning',
      graph: null,
      dir: null,
      nodeCount: null,
      edgeCount: null,
      error: null,
      lastAccess: Date.now(),
      building: null,
      pinned: opts.pinned ?? false,
    };
    this.entries.set(ref.id, entry);
    this.startGithubBuild(entry, ref);
    return { entry };
  }

  get(id: string): RepoEntry | null {
    return this.entries.get(id) ?? null;
  }

  /** The ready GraphService for `id`, touching its LRU timestamp; else null. */
  resolveGraph(id: string): GraphService | null {
    const entry = this.entries.get(id);
    if (!entry || entry.status !== 'ready' || !entry.graph) return null;
    entry.lastAccess = Date.now();
    return entry.graph;
  }

  list(): RepoSummary[] {
    return [...this.entries.values()].map(toSummary);
  }

  private startGithubBuild(entry: RepoEntry, ref: RepoRef): void {
    entry.status = 'cloning';
    entry.error = null;
    // One slot covers BOTH clone and index, so concurrent distinct URLs can't
    // spawn unbounded `git clone` + worker processes. `building` is reset on
    // settle so loadGithub's retry guard can tell a build is no longer in flight.
    entry.building = this.buildSlots
      .run(async () => {
        try {
          const { dir } = await cloneRepo(ref);
          entry.dir = dir;
          await this.buildReadOnly(entry, dir);
          this.evictExcessGithub();
        } catch (err) {
          entry.status = 'error';
          entry.error = message(err);
          if (entry.dir) {
            cleanupClone(entry.dir);
            entry.dir = null;
          }
        }
      })
      .finally(() => {
        entry.building = null;
      });
  }

  /** Index `root` in a worker and attach a read-only GraphService to `entry`. */
  private async buildReadOnly(entry: RepoEntry, root: string): Promise<void> {
    entry.status = 'indexing';
    const snapshot = await indexInWorker(root);
    entry.graph = new GraphService(root, { snapshot });
    entry.nodeCount = snapshot.meta.nodeCount;
    entry.edgeCount = snapshot.meta.edgeCount;
    entry.status = 'ready';
    entry.lastAccess = Date.now();
  }

  /**
   * Evict least-recently-used ready github clones beyond the resident cap.
   * Pinned (curated showcase) repos are never evicted. The working-tree rm is
   * deferred so a request that just resolved the graph can finish reading it.
   */
  private evictExcessGithub(): void {
    const evictable = [...this.entries.values()]
      .filter((e) => e.origin === 'github' && e.status === 'ready' && !e.pinned)
      .sort((a, b) => a.lastAccess - b.lastAccess);
    while (evictable.length > MAX_GITHUB_REPOS) {
      const victim = evictable.shift();
      if (!victim) break;
      this.entries.delete(victim.id);
      victim.graph?.dispose();
      const dir = victim.dir;
      if (dir) {
        setTimeout(() => cleanupClone(dir), EVICT_CLEANUP_GRACE_MS).unref?.();
      }
    }
  }
}

/**
 * Run the index worker for `root` in a child process with a bounded heap and a
 * wall-clock timeout, returning the parsed snapshot. The snapshot is written to a
 * temp file by the worker (avoids piping a multi-MB graph through stdout).
 */
const indexInWorker = (root: string): Promise<GraphSnapshot> =>
  new Promise((resolve, reject) => {
    const outPath = path.join(
      mkdtempSync(path.join(os.tmpdir(), 'codeatlas-out-')),
      'snapshot.json',
    );
    const child = spawn(
      process.execPath,
      [
        `--max-old-space-size=${WORKER_HEAP_MB}`,
        '--import',
        'tsx',
        WORKER_PATH,
        root,
        outPath,
      ],
      { stdio: ['ignore', 'inherit', 'inherit'] },
    );

    let settled = false;
    // Always remove the temp out dir, on every exit path (success, error, and
    // timeout) so a killed worker can't leak its mkdtemp dir.
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rmSync(path.dirname(outPath), { recursive: true, force: true });
      fn();
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(() => reject(new Error('Indexing timed out.')));
    }, INDEX_TIMEOUT_MS);

    child.on('error', (err) => finish(() => reject(err)));
    child.on('close', (code) => {
      // Read the snapshot BEFORE finish() deletes the temp dir.
      if (code !== 0) {
        finish(() => reject(new Error(`Indexer exited with code ${code}.`)));
        return;
      }
      let result: GraphSnapshot | null = null;
      let readErr: unknown = null;
      try {
        // Guard against a pathologically large snapshot before reading it in.
        if (statSync(outPath).size > MAX_SNAPSHOT_BYTES) {
          throw new Error('Index output exceeds the size limit.');
        }
        result = JSON.parse(readFileSync(outPath, 'utf8')) as GraphSnapshot;
      } catch (err) {
        readErr = err;
      }
      finish(() => {
        if (result) resolve(result);
        else reject(new Error(`Failed to read index output: ${message(readErr)}`));
      });
    });
  });
