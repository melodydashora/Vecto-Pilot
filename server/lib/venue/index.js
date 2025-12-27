// server/lib/venue/index.js - Barrel exports for venue module
// Venue intelligence, enrichment, and Smart Blocks

// Core venue operations
export { generateEnhancedSmartBlocks } from './enhanced-smart-blocks.js';
export { venueIntelligence, getVenueRecommendations } from './venue-intelligence.js';
export { enrichVenues, enrichVenueWithGoogleData } from './venue-enrichment.js';

// Event integration
export { boostFromEvents } from './event-proximity-boost.js';
export { validateVenueEvent } from './venue-event-verifier.js';

// Address resolution
export { resolveVenueAddress } from './venue-address-resolver.js';

// Module summary:
// - enhanced-smart-blocks.js: Main Smart Blocks generator (GPT-5.2 + Google APIs)
// - venue-intelligence.js: Venue recommendations and analysis
// - venue-enrichment.js: Google Places/Routes enrichment
// - event-proximity-boost.js: Boost venues near active events
// - venue-event-verifier.js: Validate venue-specific events
// - venue-address-resolver.js: Address normalization and lookup
