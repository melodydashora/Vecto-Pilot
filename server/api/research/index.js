// server/api/research/index.js - Barrel exports for research routes
// Research endpoints: vector search, research queries

export { default as researchRouter } from './research.js';
export { default as vectorSearchRouter } from './vector-search.js';

// Route summary:
// GET /api/research/* - Research queries
// GET /api/vector-search/* - Vector similarity search
