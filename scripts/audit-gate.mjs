#!/usr/bin/env node
/**
 * Dependency audit gate.
 *
 * Two pnpm behaviours make `pnpm audit` unusable as a CI step on its own:
 *   1. it exits non-zero when it finds *any* advisory, and
 *   2. `--audit-level` does not change that exit code (unlike npm).
 *
 * So a plain `pnpm audit --audit-level high` is red from the first run and gets
 * switched off a week later. This gate instead fails only on what we have
 * actually committed to keeping at zero — criticals in production dependencies —
 * and prints everything else so it stays visible.
 *
 * Raise FAIL_ON as the remaining advisories get cleared; never lower it.
 */
import { execFileSync } from 'node:child_process';

const FAIL_ON = ['critical'];
const ORDER = ['critical', 'high', 'moderate', 'low'];

let raw;
try {
  // Non-zero exit is expected whenever anything is found, so read stdout and
  // judge it ourselves rather than trusting the status code.
  raw = execFileSync('pnpm', ['audit', '--prod', '--json'], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
} catch (err) {
  raw = err.stdout ?? '';
  if (!raw.trim()) {
    console.error('audit-gate: pnpm audit produced no output');
    console.error(err.stderr ?? err.message);
    process.exit(1);
  }
}

let counts;
try {
  counts = JSON.parse(raw).metadata.vulnerabilities;
} catch {
  console.error('audit-gate: could not parse pnpm audit output');
  process.exit(1);
}

const summary = ORDER.map((s) => `${counts[s] ?? 0} ${s}`).join(' · ');
console.log(`production dependencies: ${summary}`);

const breached = FAIL_ON.filter((s) => (counts[s] ?? 0) > 0);
if (breached.length > 0) {
  console.error(
    `\nFAIL: ${breached.map((s) => `${counts[s]} ${s}`).join(', ')} ` +
      `advisor${breached.length === 1 && counts[breached[0]] === 1 ? 'y' : 'ies'} in production dependencies.`,
  );
  console.error('Run `pnpm audit --prod` for the detail.');
  process.exit(1);
}

console.log(`gate: no ${FAIL_ON.join('/')} advisories in production dependencies`);
