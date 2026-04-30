// server/api/venue/index.js - Barrel exports for venue routes

export { default as venueIntelligenceRouter } from './venue-intelligence.js';

// Route summary:
// GET  /api/venues/* - Venue recommendations
//
// 2026-02-17: Removed venue-events.js and closed-venue-reasoning.js
// - venue-events: Fully duplicated by event-matcher.js + venue-event-verifier.js in SmartBlocks pipeline
// - closed-venue-reasoning: Fully duplicated by tactical-planner.js (strategic_timing field)
