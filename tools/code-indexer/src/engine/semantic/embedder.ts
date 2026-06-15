/**
 * Optional local embedder. Wraps transformers.js (all-MiniLM-L6-v2, 384-dim) and
 * is loaded **lazily and defensively**: if the package or its native runtime
 * isn't installed, or the model can't be fetched offline, every entry point
 * resolves to `null` and the caller falls back to lexical search. Nothing here is
 * a hard dependency — consistent with the engine's "LLM is optional" rule.
 */

export const EMBED_MODEL = 'Xenova/all-MiniLM-L6-v2';
export const EMBED_DIM = 384;

// Embed in chunks rather than one giant tensor — a few thousand nodes in a single
// call pads to the longest sequence and blows memory/time. 32 keeps it bounded.
const BATCH_SIZE = 32;

// transformers.js types aren't imported (the dep is optional); the pipeline is a
// callable returning a tensor with `.tolist()`. This is the minimal shape we use.
type Extractor = (
  input: string | string[],
  opts: { pooling: 'mean'; normalize: boolean },
) => Promise<{ tolist: () => number[][] }>;

let extractorPromise: Promise<Extractor | null> | null = null;

const loadExtractor = async (): Promise<Extractor | null> => {
  try {
    const mod = (await import('@xenova/transformers')) as {
      pipeline: (task: string, model: string) => Promise<Extractor>;
      env?: { allowLocalModels?: boolean };
    };
    return await mod.pipeline('feature-extraction', EMBED_MODEL);
  } catch {
    return null; // package missing, native runtime missing, or model unavailable
  }
};

/** Whether the embedder loaded — resolves the model once and caches the result. */
export const embedderAvailable = async (): Promise<boolean> =>
  (await getExtractor()) !== null;

const getExtractor = (): Promise<Extractor | null> => {
  if (!extractorPromise) extractorPromise = loadExtractor();
  return extractorPromise;
};

/**
 * Embed texts → one 384-d vector each, or `null` if the model is unavailable.
 * Processes in fixed-size batches so a large repo can't pad into one oversized
 * tensor. `onProgress` (if given) reports embedded-count after each batch.
 */
export const embedTexts = async (
  texts: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<number[][] | null> => {
  if (texts.length === 0) return [];
  const extractor = await getExtractor();
  if (!extractor) return null;

  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const out = await extractor(batch, { pooling: 'mean', normalize: true });
    vectors.push(...out.tolist());
    onProgress?.(Math.min(i + BATCH_SIZE, texts.length), texts.length);
  }
  return vectors;
};

/** Embed a single query string → its vector, or `null` if unavailable. */
export const embedQuery = async (text: string): Promise<number[] | null> => {
  const vecs = await embedTexts([text]);
  return vecs?.[0] ?? null;
};
