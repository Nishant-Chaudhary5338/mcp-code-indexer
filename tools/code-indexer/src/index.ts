#!/usr/bin/env node
import { CodeIndexerServer } from './server.js';

new CodeIndexerServer().run().catch((error) => {
  console.error('code-indexer failed to start:', error);
  process.exit(1);
});
