// server/api/briefing/index.js - Barrel exports for briefing routes
// Briefing endpoints: weather, traffic, news, events, school closures

export { default as briefingRouter } from './briefing.js';

// 2026-01-09: phaseEmitter moved to server/events/phase-emitter.js
// 2026-01-09: eventsRouter removed (SSE consolidated to server/api/strategy/strategy-events.js)
// Import phaseEmitter from dedicated module if needed elsewhere:
//   import { phaseEmitter } from '../../events/phase-emitter.js';

// Route summary:
// GET /api/briefing/weather/:snapshotId - Weather data
// GET /api/briefing/traffic/:snapshotId - Traffic conditions (TomTom + Claude analysis)
// GET /api/briefing/rideshare-news/:snapshotId - Rideshare news
// GET /api/briefing/events/:snapshotId - Local events
// GET /api/briefing/school-closures/:snapshotId - School closures
// SSE: All SSE endpoints now at /events/* via strategy-events.js
