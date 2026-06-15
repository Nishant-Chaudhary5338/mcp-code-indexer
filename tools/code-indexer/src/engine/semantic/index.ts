export { embedSnapshot, type EmbedResult } from './embed-snapshot.js';
export {
  semanticSearch,
  type SemanticSearchResult,
  type SemanticHitResult,
  type SemanticSearchOptions,
} from './semantic-search.js';
export { embedderAvailable, EMBED_MODEL, EMBED_DIM } from './embedder.js';
export { readEmbeddingStore, embedStorePath } from './store.js';
