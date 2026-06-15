import { describe, it, expect } from 'vitest';
import {
  fileId,
  componentId,
  functionId,
  packageId,
  edgeId,
} from './ids';

describe('canonical ids', () => {
  it('normalizes windows separators in file ids', () => {
    expect(fileId('apps\\web\\code-graph\\src\\App.tsx')).toBe(
      'file:apps/web/code-graph/src/App.tsx',
    );
  });

  it('produces deterministic component ids', () => {
    const a = componentId('src/Button.tsx', 'Button');
    const b = componentId('src/Button.tsx', 'Button');
    expect(a).toBe(b);
    expect(a).toBe('cmp:src/Button.tsx#Button');
  });

  it('builds stable function ids that do not embed line numbers', () => {
    // The first (or only) occurrence has a clean, line-independent id, so adding
    // a blank line above the function does not change its id.
    expect(functionId('src/util.ts', 'parse')).toBe('fn:src/util.ts#parse');
    expect(functionId('src/util.ts', 'parse', 0)).toBe('fn:src/util.ts#parse');
  });

  it('disambiguates same-named symbols by occurrence index, not line', () => {
    const first = functionId('src/util.ts', 'parse', 0);
    const second = functionId('src/util.ts', 'parse', 1);
    expect(first).not.toBe(second);
    expect(second).toBe('fn:src/util.ts#parse~1');
  });

  it('produces deterministic function ids regardless of position in file', () => {
    expect(functionId('src/util.ts', 'parse')).toBe(
      functionId('src/util.ts', 'parse'),
    );
  });

  it('builds edge ids from source, target and type', () => {
    expect(edgeId(packageId('@repo/ui'), packageId('@repo/utils'), 'depends-on')).toBe(
      'pkg:@repo/ui->pkg:@repo/utils:depends-on',
    );
  });
});
