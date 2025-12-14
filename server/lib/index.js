// server/lib/index.js - Master barrel exports for all library modules
// Import from specific modules for tree-shaking, or use this for convenience

// AI Module - Model adapters and providers
export * from './ai/index.js';

// Strategy Module - TRIAD pipeline
export * from './strategy/index.js';

// Venue Module - Smart Blocks and enrichment
export * from './venue/index.js';

// Location Module - GPS, geocoding, snapshots
export * from './location/index.js';

// Briefing Module - Weather, traffic, events
export * from './briefing/index.js';

// External APIs - Third-party integrations
export * from './external/index.js';

// Infrastructure - Background jobs
export * from './infrastructure/index.js';

// Root-level utilities
export { generateToken, verifyToken } from './auth.js';
export { capabilities } from './capabilities.js';

// Module Map:
// ┌─────────────────────────────────────────────────┐
// │                  server/lib/                     │
// ├─────────────────────────────────────────────────┤
// │  ai/          → Model adapters, providers       │
// │  strategy/    → TRIAD pipeline, planners        │
// │  venue/       → Smart Blocks, enrichment        │
// │  location/    → GPS, geocoding, snapshots       │
// │  briefing/    → Weather, traffic, events        │
// │  external/    → TomTom, Google, Perplexity      │
// │  infrastructure/ → Job queue                    │
// └─────────────────────────────────────────────────┘
