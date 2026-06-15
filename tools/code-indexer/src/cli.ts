import * as path from 'path';
import { createConfig } from './config.js';
import { runFullIndex, runIncrementalIndex } from './engine/index.js';
import { writeSnapshot } from './engine/incremental/cache.js';
import {
  queryWhoRenders,
  queryWhoCalls,
  queryFindReferences,
  queryBlastRadius,
  queryFindCycles,
  queryFindOrphans,
  queryGraph,
  querySearchNodes,
  queryContextPack,
  queryEmbedRepo,
  querySemanticSearch,
  type GraphQueryOptions,
  type RefResult,
} from './query.js';
import type { NodeType } from '@repo/code-graph-core';

const flagValue = (argv: string[], name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : undefined;
};
const hasFlag = (argv: string[], name: string): boolean => argv.includes(name);
const rootOf = (argv: string[]): string => {
  const r = flagValue(argv, '--root');
  return r ? path.resolve(r) : process.cwd();
};
const requireId = (argv: string[]): string => {
  const id = flagValue(argv, '--id');
  if (!id) {
    console.error('Missing --id <node-id>');
    process.exit(1);
  }
  return id;
};

const summarize = (counts: Record<string, number>): string =>
  Object.entries(counts)
    .map(([k, v]) => `${v} ${k}`)
    .join(' · ');

const runIndexCommand = (root: string, incremental: boolean): void => {
  const config = createConfig(root);
  const { snapshot, durationMs } = incremental
    ? runIncrementalIndex(config)
    : runFullIndex(config);
  const typeCounts = snapshot.nodes.reduce<Record<string, number>>((acc, n) => {
    acc[n.type] = (acc[n.type] ?? 0) + 1;
    return acc;
  }, {});
  const target = writeSnapshot(snapshot.meta.root, snapshot);
  console.log(`Indexed ${snapshot.meta.root}`);
  console.log(`  nodes: ${snapshot.meta.nodeCount} (${summarize(typeCounts)})`);
  console.log(`  edges: ${snapshot.meta.edgeCount}`);
  console.log(`  time:  ${durationMs}ms`);
  console.log(`  wrote: ${target}`);
};

const printRefs = (label: string, count: number, results: RefResult[]): void => {
  console.log(`${count} ${label}`);
  for (const r of results) {
    const where = r.path ? ` (${r.path})` : '';
    const w = r.weight > 1 ? ` ×${r.weight}` : '';
    console.log(`  - ${r.type} ${r.name}${where}${w}`);
  }
};

const QUERY_USAGE =
  'Usage: code-indexer query <who-renders|who-calls|find-references|blast-radius|find-cycles|orphans|graph|search|context|semantic> [--root <path>] [--id <node-id>] [--types a,b] [--json]\n' +
  '  graph flags:    [--summary] [--full] [--lean] [--depth <n>] [--type a,b] [--fields a,b]\n' +
  '  search flags:   --query <text> [--type a,b] [--limit <n>]\n' +
  '  semantic flags: --query <text> [--type a,b] [--limit <n>]   (run `embed` first)\n' +
  '  context flags:  --id <node-id> [--max-refs <n>]';

/** Run an async CLI path, surfacing failures as a clean non-zero exit. */
const runAsync = (work: Promise<void>): void => {
  work.catch((err: unknown) => {
    console.error((err as Error).message);
    process.exit(1);
  });
};

const runEmbedCommand = async (root: string): Promise<void> => {
  const res = await queryEmbedRepo(root, (done, total) => {
    process.stderr.write(`\r  embedding ${done}/${total}…`);
    if (done === total) process.stderr.write('\n');
  });
  if (!res.available) {
    console.error(
      'Embedding model unavailable (optional dep @xenova/transformers not installed, ' +
        'or model could not be fetched). Semantic search will fall back to lexical.',
    );
    process.exit(1);
  }
  console.log(`Embedded with ${res.model}`);
  console.log(`  ${res.embedded} embedded · ${res.skipped} reused · ${res.total} total`);
};

/**
 * CI gate. Indexes (incrementally) then asserts health: fails (exit 1) when the
 * dependency-cycle count exceeds `--max-cycles` (default 0). Orphans are reported
 * but non-fatal by default (entry points / public API create false positives);
 * `--fail-on-orphans` makes them fatal too.
 */
const runCheckCommand = (argv: string[]): void => {
  const root = rootOf(argv);
  const maxCyclesArg = flagValue(argv, '--max-cycles');
  const maxCycles = maxCyclesArg !== undefined ? Number(maxCyclesArg) : 0;
  const failOnOrphans = hasFlag(argv, '--fail-on-orphans');

  try {
    // Index first so `check` is a one-shot gate that doesn't depend on prior state.
    runIndexCommand(root, true);

    const cycles = queryFindCycles(root);
    const orphans = queryFindOrphans(root, false);

    console.log(`\nHealth check for ${root}`);
    console.log(`  cycles:  ${cycles.count} (max allowed ${maxCycles})`);
    console.log(`  orphans: ${orphans.count}${failOnOrphans ? ' (fatal)' : ' (warning)'}`);
    for (const cycle of cycles.cycles) {
      console.log(`    cycle: ${cycle.map((n) => n.name).join(' → ')}`);
    }

    const cyclesFail = cycles.count > maxCycles;
    const orphansFail = failOnOrphans && orphans.count > 0;
    if (cyclesFail || orphansFail) {
      console.error(
        `\n✗ check failed:${cyclesFail ? ` ${cycles.count} cycles (> ${maxCycles})` : ''}` +
          `${orphansFail ? ` ${orphans.count} orphans` : ''}`,
      );
      process.exit(1);
    }
    console.log('\n✓ check passed');
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
};

const runQueryCommand = (argv: string[]): void => {
  const [sub] = argv;
  const root = rootOf(argv);
  const json = hasFlag(argv, '--json');
  const out = (value: unknown): void => console.log(JSON.stringify(value, null, 2));

  // Semantic search is async (it loads the local model); handle it off the
  // synchronous switch below.
  if (sub === 'semantic') {
    const query = flagValue(argv, '--query');
    if (!query) {
      console.error('Missing --query <text>');
      process.exit(1);
    }
    const typeArg = flagValue(argv, '--type')?.split(',').filter(Boolean);
    const limitArg = flagValue(argv, '--limit');
    runAsync(
      querySemanticSearch(root, query, {
        type: typeArg as NodeType[] | undefined,
        limit: limitArg !== undefined ? Number(limitArg) : undefined,
      }).then((res) => {
        if (json) out(res);
        else {
          const mode = res.usedEmbeddings ? 'semantic' : 'lexical fallback';
          console.log(`${res.count} matches (${mode})`);
          if (res.hint) console.log(`  ! ${res.hint}`);
          for (const r of res.results) {
            console.log(`  - ${r.score.toFixed(3)}  ${r.type} ${r.name}${r.path ? ` (${r.path})` : ''}`);
          }
        }
      }),
    );
    return;
  }

  try {
    switch (sub) {
      case 'who-renders': {
        const res = queryWhoRenders(root, requireId(argv));
        if (json) out(res);
        else printRefs('renderers', res.count, res.results);
        return;
      }
      case 'who-calls': {
        const res = queryWhoCalls(root, requireId(argv));
        if (json) out(res);
        else printRefs('callers', res.count, res.results);
        return;
      }
      case 'find-references': {
        const types = flagValue(argv, '--types')?.split(',').filter(Boolean);
        const res = queryFindReferences(root, requireId(argv), types);
        if (json) out(res);
        else printRefs('references', res.count, res.results);
        return;
      }
      case 'blast-radius': {
        const res = queryBlastRadius(root, requireId(argv));
        if (json) out(res);
        else {
          console.log(`${res.count} impacted`);
          for (const n of res.impacted) {
            console.log(`  - ${n.type} ${n.name}${n.path ? ` (${n.path})` : ''}`);
          }
        }
        return;
      }
      case 'find-cycles': {
        const res = queryFindCycles(root);
        if (json) out(res);
        else {
          console.log(`${res.count} cycles`);
          for (const cycle of res.cycles) {
            console.log(`  - ${cycle.map((n) => n.name).join(' → ')}`);
          }
        }
        return;
      }
      case 'orphans': {
        const res = queryFindOrphans(root, hasFlag(argv, '--include-entry-points'));
        if (json) out(res);
        else {
          console.log(`${res.count} orphans (no incoming dependency)`);
          for (const o of res.orphans) {
            console.log(`  - ${o.type} ${o.name}${o.path ? ` (${o.path})` : ''}`);
          }
        }
        return;
      }
      case 'search': {
        const query = flagValue(argv, '--query');
        if (!query) {
          console.error('Missing --query <text>');
          process.exit(1);
        }
        const typeArg = flagValue(argv, '--type')?.split(',').filter(Boolean);
        const limitArg = flagValue(argv, '--limit');
        const res = querySearchNodes(root, query, {
          type: typeArg as NodeType[] | undefined,
          limit: limitArg !== undefined ? Number(limitArg) : undefined,
        });
        if (json) out(res);
        else {
          console.log(`${res.count} matches`);
          for (const r of res.results) {
            console.log(`  - ${r.type} ${r.name}${r.path ? ` (${r.path})` : ''}  [${r.id}]`);
          }
        }
        return;
      }
      case 'context': {
        const maxRefsArg = flagValue(argv, '--max-refs');
        const res = queryContextPack(root, requireId(argv), {
          maxRefs: maxRefsArg !== undefined ? Number(maxRefsArg) : undefined,
        });
        if (json) out(res);
        else {
          const t = res.target;
          console.log(`${t.type} ${t.name}${t.signature ?? ''}${t.path ? `  (${t.path})` : ''} — health: ${t.health}`);
          console.log(`  depends on (${res.dependencies.length}):`);
          for (const d of res.dependencies)
            console.log(`    → ${d.edgeType} ${d.type} ${d.name}${d.signature ?? ''}`);
          console.log(`  depended on by (${res.dependents.length}, blast radius ${res.blastRadiusCount}):`);
          for (const d of res.dependents)
            console.log(`    ← ${d.edgeType} ${d.type} ${d.name}${d.signature ?? ''}`);
          console.log(`  source: ${res.source ? `${res.source.length} chars` : 'none'}`);
        }
        return;
      }
      case 'graph': {
        const typeArg = flagValue(argv, '--type')?.split(',').filter(Boolean);
        const fields = flagValue(argv, '--fields')?.split(',').filter(Boolean);
        const depthArg = flagValue(argv, '--depth');
        const opts: GraphQueryOptions = {
          summary: hasFlag(argv, '--summary'),
          full: hasFlag(argv, '--full'),
          lean: hasFlag(argv, '--lean'),
          depth: depthArg !== undefined ? Number(depthArg) : undefined,
          type: typeArg as GraphQueryOptions['type'],
          fields,
        };
        out(queryGraph(root, opts));
        return;
      }
      default:
        console.error(QUERY_USAGE);
        process.exit(1);
    }
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
};

export const runCli = (argv: string[]): void => {
  const [command = 'index', ...rest] = argv;

  if (command === 'index') {
    runIndexCommand(rootOf(rest), rest.includes('--incremental'));
    return;
  }
  if (command === 'embed') {
    runAsync(runEmbedCommand(rootOf(rest)));
    return;
  }
  if (command === 'check') {
    runCheckCommand(rest);
    return;
  }
  if (command === 'query') {
    runQueryCommand(rest);
    return;
  }
  if (command === 'serve') {
    console.error(
      'The HTTP/WS server is provided by the published package: `npx <package> serve`, ' +
        'or run `pnpm serve` inside the monorepo.',
    );
    process.exit(1);
  }
  console.error(
    'Unknown command. Usage:\n' +
      '  code-indexer index [--root <path>] [--incremental]\n' +
      '  code-indexer embed [--root <path>]\n' +
      '  code-indexer check [--root <path>] [--max-cycles <n>] [--fail-on-orphans]\n' +
      `  code-indexer query ...\n${QUERY_USAGE}`,
  );
  process.exit(1);
};
