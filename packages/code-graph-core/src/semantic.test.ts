import { describe, it, expect } from 'vitest';
import { cosineSimilarity, rankBySimilarity, type VectorEntry } from './semantic';

describe('cosineSimilarity', () => {
  it('is 1 for identical direction', () => {
    expect(cosineSimilarity([1, 0], [2, 0])).toBeCloseTo(1);
  });

  it('is 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('is negative for opposite direction', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it('returns 0 on a length mismatch or zero vector', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

describe('rankBySimilarity', () => {
  const entries: VectorEntry[] = [
    { id: 'a', vec: [1, 0, 0], hash: 'x' },
    { id: 'b', vec: [0.9, 0.1, 0], hash: 'x' },
    { id: 'c', vec: [0, 1, 0], hash: 'x' },
    { id: 'd', vec: [-1, 0, 0], hash: 'x' },
  ];

  it('orders by closeness to the query, highest first', () => {
    const hits = rankBySimilarity([1, 0, 0], entries);
    // a (1.0) > b (~0.994); c is orthogonal (0) and d opposite (-1) → both dropped at minScore 0.
    expect(hits.map((h) => h.id)).toEqual(['a', 'b']);
  });

  it('respects the limit', () => {
    expect(rankBySimilarity([1, 0, 0], entries, 1)).toHaveLength(1);
  });

  it('drops hits at or below minScore', () => {
    const hits = rankBySimilarity([1, 0, 0], entries, 20, 0.999);
    expect(hits.map((h) => h.id)).toEqual(['a']); // only the exact match clears 0.999
  });
});
