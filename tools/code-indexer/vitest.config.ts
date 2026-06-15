import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only our own tests under src/. Without this, vitest's default `**/*.test.ts`
    // glob also discovers the cloned repos under `scripts/.proof-cache/` (the
    // prove-any-repo corpus), running hundreds of foreign test files.
    include: ['src/**/*.test.ts'],
  },
});
