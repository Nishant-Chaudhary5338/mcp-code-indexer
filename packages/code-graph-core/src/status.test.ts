import { describe, it, expect } from 'vitest';
import { emptyStatus, deriveHealth, NodeStatus } from './status.schema';

describe('deriveHealth', () => {
  it('returns unknown when no signal is present', () => {
    expect(deriveHealth(emptyStatus())).toBe('unknown');
  });

  it('returns error on type errors', () => {
    expect(deriveHealth({ ...emptyStatus(), typeErrors: 1 })).toBe('error');
  });

  it('returns error on failing tests', () => {
    expect(
      deriveHealth({ ...emptyStatus(), testsPass: false, testsTotal: 3 }),
    ).toBe('error');
  });

  it('returns warn on lint warnings only', () => {
    expect(deriveHealth({ ...emptyStatus(), lintWarnings: 2 })).toBe('warn');
  });

  it('returns warn on low coverage', () => {
    expect(deriveHealth({ ...emptyStatus(), coveragePct: 20 })).toBe('warn');
  });

  it('returns ok when tests pass and nothing is wrong', () => {
    expect(
      deriveHealth({ ...emptyStatus(), testsPass: true, testsTotal: 5 }),
    ).toBe('ok');
  });
});

describe('NodeStatus schema', () => {
  it('rejects coverage above 100', () => {
    expect(() =>
      NodeStatus.parse({ ...emptyStatus(), coveragePct: 140 }),
    ).toThrow();
  });
});
