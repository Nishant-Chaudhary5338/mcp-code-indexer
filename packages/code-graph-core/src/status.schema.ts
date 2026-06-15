import { z } from 'zod';

export const HealthLevel = z.enum(['ok', 'warn', 'error', 'unknown']);
export type HealthLevel = z.infer<typeof HealthLevel>;

export const NodeStatus = z.object({
  typeErrors: z.number().int().nonnegative(),
  lintWarnings: z.number().int().nonnegative(),
  lintErrors: z.number().int().nonnegative(),
  testsPass: z.boolean().nullable(),
  testsTotal: z.number().int().nonnegative().nullable(),
  coveragePct: z.number().min(0).max(100).nullable(),
  buildOk: z.boolean().nullable(),
  health: HealthLevel,
});
export type NodeStatus = z.infer<typeof NodeStatus>;

export const emptyStatus = (): NodeStatus => ({
  typeErrors: 0,
  lintWarnings: 0,
  lintErrors: 0,
  testsPass: null,
  testsTotal: null,
  coveragePct: null,
  buildOk: null,
  health: 'unknown',
});

const COVERAGE_WARN_THRESHOLD = 50;

export const deriveHealth = (status: NodeStatus): HealthLevel => {
  if (status.typeErrors > 0 || status.lintErrors > 0) return 'error';
  if (status.testsPass === false || status.buildOk === false) return 'error';

  const lowCoverage =
    status.coveragePct !== null && status.coveragePct < COVERAGE_WARN_THRESHOLD;
  if (status.lintWarnings > 0 || lowCoverage) return 'warn';

  const hasSignal =
    status.testsPass !== null ||
    status.buildOk !== null ||
    status.coveragePct !== null;
  return hasSignal ? 'ok' : 'unknown';
};
