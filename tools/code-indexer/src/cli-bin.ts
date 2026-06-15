#!/usr/bin/env node
// Thin executable entry for the `code-indexer` bin. The dispatch logic lives in
// cli.ts (`runCli`) as a side-effect-free module so it can be imported and reused
// by the published dist bundle without auto-running.
import { runCli } from './cli.js';

const argv = process.argv.slice(2);

// A full index of a large monorepo can exceed Node's default heap (the engine
// holds every package's ts-morph AST in memory at once). For the heavy commands,
// re-exec once with a bigger heap when the caller hasn't set one. Guarded by an
// env flag so it can never loop; opt out with CODE_INDEXER_NO_REEXEC=1.
const HEAVY = new Set(['index', 'embed']);
const heapAlreadySet =
  process.execArgv.some((a) => a.includes('max-old-space-size')) ||
  (process.env.NODE_OPTIONS ?? '').includes('max-old-space-size');

if (
  HEAVY.has(argv[0] ?? '') &&
  !heapAlreadySet &&
  !process.env.CODE_INDEXER_REEXEC &&
  process.env.CODE_INDEXER_NO_REEXEC !== '1'
) {
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync(
    process.execPath,
    ['--max-old-space-size=8192', process.argv[1] as string, ...argv],
    { stdio: 'inherit', env: { ...process.env, CODE_INDEXER_REEXEC: '1' } },
  );
  process.exit(result.status ?? 0);
}

runCli(argv);
