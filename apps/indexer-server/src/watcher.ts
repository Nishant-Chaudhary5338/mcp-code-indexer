import * as path from 'path';
import watcher, { type Event } from '@parcel/watcher';
import type { GraphService } from './graph-service.js';

const IGNORE = [
  'node_modules',
  '.git',
  'build',
  'dist',
  '.turbo',
  '.code-graph',
  'coverage',
  'storybook-static',
];

const DEBOUNCE_MS = 250;

const isSource = (filePath: string): boolean =>
  (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) &&
  !filePath.endsWith('.d.ts');

export const startWatcher = async (
  root: string,
  graph: GraphService,
): Promise<watcher.AsyncSubscription> => {
  // Absolute paths of files touched since the last flush. We coalesce here so a
  // burst of saves collapses into one reparse.
  let pending = new Set<string>();
  let timer: NodeJS.Timeout | null = null;
  // In-flight guard: heavy ts-morph reparse runs synchronously and must not
  // overlap with itself. If a flush is requested while one is running, we
  // re-arm the debounce instead of starting a second concurrent flush.
  let isFlushing = false;

  const flush = async (): Promise<void> => {
    timer = null;
    if (isFlushing) {
      // A flush is already running; re-arm so the just-arrived changes (which
      // were added to `pending` by onEvents) get processed afterwards.
      scheduleFlush();
      return;
    }

    // Snapshot and clear the pending set up front. Any events that land during
    // the (awaited) flush accumulate into a fresh `pending` for the next round.
    const changed = [...pending];
    pending = new Set();

    const absPaths = changed.filter(isSource);
    if (absPaths.length === 0) return;

    isFlushing = true;
    const startedAt = Date.now();
    try {
      // 1) Rebuild structural nodes/edges (and drop deleted files) via the
      //    engine, through the serialize queue, then broadcast the structural
      //    patch so live clients see new/removed nodes immediately.
      const patch = await graph.reparseAndEnrich(absPaths);
      graph.emitPatch(patch);

      // 2) Follow up with status (typecheck) enrichment for the affected files.
      const relPaths = absPaths.map((abs) => path.relative(root, abs));
      const updated = await graph.enrichFiles(relPaths);

      const upserts = patch.upsertNodes.length;
      const removes = patch.removeNodeIds.length;
      console.log(
        `   ↻ ${absPaths.length} file(s) → +${upserts}/-${removes} nodes, ${updated.length} re-checked in ${Date.now() - startedAt}ms`,
      );
    } catch (err) {
      console.error('watcher flush error:', err);
    } finally {
      isFlushing = false;
      // If changes arrived during this flush, process them on the next tick.
      if (pending.size > 0) scheduleFlush();
    }
  };

  const scheduleFlush = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void flush(), DEBOUNCE_MS);
  };

  const onEvents = (err: Error | null, events: Event[]): void => {
    if (err) {
      console.error('watcher error:', err);
      return;
    }
    for (const event of events) pending.add(event.path);
    scheduleFlush();
  };

  return watcher.subscribe(root, onEvents, { ignore: IGNORE });
};
