// server/api/venue/index.js - Barrel exports for venue routes
// Venue endpoints: intelligence, events, reasoning

export { default as venueIntelligenceRouter } from './venue-intelligence.js';
export { default as venueEventsRouter } from './venue-events.js';
export { default as closedVenueReasoningRouter } from './closed-venue-reasoning.js';

// Route summary:
// GET  /api/venues/* - Venue recommendations
// GET  /api/venue/events/* - Venue-specific events
// POST /api/closed-venue-reasoning - AI reasoning for closed venues
