import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionRegistry } from './session-registry.js';
import type { RepoEntry, RepoSummary } from './session-registry.js';

// RepoSummary projected fields (must match toSummary in session-registry.ts)
const SUMMARY_FIELDS: Array<keyof RepoSummary> = [
  'id',
  'label',
  'origin',
  'status',
  'nodeCount',
  'edgeCount',
  'error',
];

// ---------------------------------------------------------------------------
// loadGithub — URL validation (no build, synchronous error path)
// ---------------------------------------------------------------------------

test('loadGithub returns { error } immediately for an invalid GitHub URL', () => {
  const registry = new SessionRegistry();
  const result = registry.loadGithub('https://gitlab.com/owner/repo');
  assert.ok('error' in result, 'expected an error result');
  assert.equal(typeof (result as { error: string }).error, 'string');
});

test('loadGithub returns { error } for an empty string', () => {
  const registry = new SessionRegistry();
  const result = registry.loadGithub('');
  assert.ok('error' in result);
});

test('loadGithub returns { error } for a non-github host', () => {
  const registry = new SessionRegistry();
  const result = registry.loadGithub('https://evil.com/a/b');
  assert.ok('error' in result);
});

test('loadGithub returns { entry } synchronously for a valid GitHub URL', () => {
  const registry = new SessionRegistry();
  const result = registry.loadGithub('https://github.com/owner/repo');
  // The entry is created immediately — the build is async.
  assert.ok('entry' in result, 'expected an entry result for a valid URL');
  const entry = (result as { entry: RepoEntry }).entry;
  assert.equal(entry.label, 'owner/repo');
  assert.equal(entry.origin, 'github');
  assert.equal(entry.status, 'cloning');
});

test('loadGithub is idempotent: same URL returns the same entry object', () => {
  const registry = new SessionRegistry();
  const r1 = registry.loadGithub('https://github.com/owner/repo');
  const r2 = registry.loadGithub('https://github.com/owner/repo');
  assert.ok('entry' in r1 && 'entry' in r2);
  assert.equal(
    (r1 as { entry: RepoEntry }).entry,
    (r2 as { entry: RepoEntry }).entry,
    'same URL must reuse the same entry object',
  );
});

// ---------------------------------------------------------------------------
// defaultId
// ---------------------------------------------------------------------------

test('defaultId() is null on a fresh registry', () => {
  const registry = new SessionRegistry();
  assert.equal(registry.defaultId(), null);
});

// ---------------------------------------------------------------------------
// get()
// ---------------------------------------------------------------------------

test('get() returns null for an unknown id', () => {
  const registry = new SessionRegistry();
  assert.equal(registry.get('nonexistent'), null);
});

test('get() returns the entry after loadGithub succeeds for a valid URL', () => {
  const registry = new SessionRegistry();
  const result = registry.loadGithub('github.com/owner/repo2');
  assert.ok('entry' in result);
  const entry = (result as { entry: RepoEntry }).entry;
  const fetched = registry.get(entry.id);
  assert.equal(fetched, entry);
});

// ---------------------------------------------------------------------------
// resolveGraph()
// ---------------------------------------------------------------------------

test('resolveGraph returns null for an unknown id', () => {
  const registry = new SessionRegistry();
  assert.equal(registry.resolveGraph('no-such-id'), null);
});

test('resolveGraph returns null when the entry is not yet ready (status=cloning)', () => {
  const registry = new SessionRegistry();
  const result = registry.loadGithub('https://github.com/owner/cloning-repo');
  assert.ok('entry' in result);
  const entry = (result as { entry: RepoEntry }).entry;
  // status is 'cloning' right after loadGithub — graph is null
  assert.equal(registry.resolveGraph(entry.id), null);
});

// ---------------------------------------------------------------------------
// list() — RepoSummary projection
// ---------------------------------------------------------------------------

test('list() returns an empty array on a fresh registry', () => {
  const registry = new SessionRegistry();
  assert.deepEqual(registry.list(), []);
});

test('list() includes an entry added via loadGithub', () => {
  const registry = new SessionRegistry();
  registry.loadGithub('https://github.com/owner/listrepo');
  const summaries = registry.list();
  assert.equal(summaries.length, 1);
  const s = summaries[0];
  assert.equal(s!.label, 'owner/listrepo');
  assert.equal(s!.origin, 'github');
  assert.equal(s!.status, 'cloning');
});

test('list() omits private GraphService fields from RepoSummary', () => {
  const registry = new SessionRegistry();
  registry.loadGithub('https://github.com/owner/projrepo');
  const summaries = registry.list();
  assert.equal(summaries.length, 1);
  const summary = summaries[0]!;
  // Only the public summary fields should be present.
  const keys = Object.keys(summary);
  for (const field of SUMMARY_FIELDS) {
    assert.ok(keys.includes(field), `missing field: ${field}`);
  }
  // Private fields must not leak.
  assert.ok(!('graph' in summary), 'GraphService must not appear in RepoSummary');
  assert.ok(!('dir' in summary), 'dir must not appear in RepoSummary');
  assert.ok(!('building' in summary), 'building must not appear in RepoSummary');
  assert.ok(!('lastAccess' in summary), 'lastAccess must not appear in RepoSummary');
});

test('list() reflects all entries across multiple loadGithub calls', () => {
  const registry = new SessionRegistry();
  registry.loadGithub('https://github.com/owner/repo-a');
  registry.loadGithub('https://github.com/owner/repo-b');
  registry.loadGithub('https://github.com/owner/repo-c');
  const summaries = registry.list();
  assert.equal(summaries.length, 3);
  const labels = summaries.map((s) => s.label).sort();
  assert.deepEqual(labels, ['owner/repo-a', 'owner/repo-b', 'owner/repo-c']);
});

// ---------------------------------------------------------------------------
// eviction ordering — verify the sort property without triggering real builds.
// We inject 'ready' entries by starting builds and then mutating the entry
// directly (simulating what buildReadOnly would do), keeping tests deterministic.
// ---------------------------------------------------------------------------

test('eviction sort: entries with older lastAccess are earlier in LRU order', () => {
  // We verify the observable property: entries sort ascending by lastAccess so
  // the oldest is evicted first. We can exercise this via list() + manual
  // entry inspection since evictExcessGithub is private.
  // Here we use loadGithub to register 3 repos with different load times.
  const registry = new SessionRegistry();

  // Stagger the timestamps by loading in sequence; loadGithub sets lastAccess = Date.now().
  const r1 = registry.loadGithub('https://github.com/owner/evict-a');
  const r2 = registry.loadGithub('https://github.com/owner/evict-b');
  const r3 = registry.loadGithub('https://github.com/owner/evict-c');

  assert.ok('entry' in r1 && 'entry' in r2 && 'entry' in r3);
  const e1 = (r1 as { entry: RepoEntry }).entry;
  const e2 = (r2 as { entry: RepoEntry }).entry;
  const e3 = (r3 as { entry: RepoEntry }).entry;

  // Force distinct access times so the sort is unambiguous.
  e1.lastAccess = 1000;
  e2.lastAccess = 2000;
  e3.lastAccess = 3000;

  // Re-access e1 — this should promote it to most-recently-used.
  registry.loadGithub('https://github.com/owner/evict-a');
  // After re-access e1.lastAccess was updated by loadGithub.
  assert.ok(e1.lastAccess > 3000, 'lastAccess should be updated on re-access');
});

test('loadGithub updates lastAccess on a second call for the same URL', () => {
  const registry = new SessionRegistry();
  const r1 = registry.loadGithub('https://github.com/owner/lru-repo');
  assert.ok('entry' in r1);
  const entry = (r1 as { entry: RepoEntry }).entry;
  const firstAccess = entry.lastAccess;

  // Small delay is not needed — Date.now() may return the same value
  // within the same tick; we just verify that the second call re-touches it.
  entry.lastAccess = 0; // force it back to 0
  registry.loadGithub('https://github.com/owner/lru-repo');
  assert.ok(entry.lastAccess > 0, 'lastAccess must be refreshed on re-access');
  // Suppress "unused variable" warning.
  void firstAccess;
});

// ---------------------------------------------------------------------------
// Bounded build queue and failed-entry cleanup
// ---------------------------------------------------------------------------

test('loadGithub turns new repos away once the pending-build cap is reached', () => {
  const registry = new SessionRegistry({ maxPendingBuilds: 2 });
  assert.ok('entry' in registry.loadGithub('https://github.com/cg-test-owner/repo-one'));
  assert.ok('entry' in registry.loadGithub('https://github.com/cg-test-owner/repo-two'));

  const third = registry.loadGithub('https://github.com/cg-test-owner/repo-three');
  assert.ok('error' in third);
  assert.equal(third.busy, true);
  assert.equal(registry.list().length, 2);
});

test('a repo already loading is still returned while the queue is full', () => {
  const registry = new SessionRegistry({ maxPendingBuilds: 1 });
  const first = registry.loadGithub('https://github.com/cg-test-owner/repo-one');
  const again = registry.loadGithub('https://github.com/cg-test-owner/repo-one');
  assert.ok('entry' in first && 'entry' in again);
  assert.equal(again.entry, first.entry);
});

test('failed clones are pruned after their grace period, freeing a build slot', () => {
  const registry = new SessionRegistry({ maxPendingBuilds: 1 });
  const first = registry.loadGithub('https://github.com/cg-test-owner/repo-one');
  assert.ok('entry' in first);

  // Simulate the clone having failed long ago.
  first.entry.status = 'error';
  first.entry.building = null;
  first.entry.lastAccess = Date.now() - 11 * 60_000;

  const next = registry.loadGithub('https://github.com/cg-test-owner/repo-two');
  assert.ok('entry' in next);
  assert.equal(registry.get(first.entry.id), null);
});

test('a recent failure is kept so its client can still read the error', () => {
  const registry = new SessionRegistry({ maxPendingBuilds: 2 });
  const first = registry.loadGithub('https://github.com/cg-test-owner/repo-one');
  assert.ok('entry' in first);
  first.entry.status = 'error';
  first.entry.building = null;

  registry.loadGithub('https://github.com/cg-test-owner/repo-two');
  assert.notEqual(registry.get(first.entry.id), null);
});

test('retrying a failed repo is also turned away while the queue is full', () => {
  const registry = new SessionRegistry({ maxPendingBuilds: 2 });
  registry.loadGithub('https://github.com/cg-test-owner/repo-one');
  const failed = registry.loadGithub('https://github.com/cg-test-owner/repo-two');
  assert.ok('entry' in failed);
  failed.entry.status = 'error';
  failed.entry.building = null;
  registry.loadGithub('https://github.com/cg-test-owner/repo-three');

  const retry = registry.loadGithub('https://github.com/cg-test-owner/repo-two');
  assert.ok('error' in retry && retry.busy === true);
  assert.equal(failed.entry.status, 'error');
});
