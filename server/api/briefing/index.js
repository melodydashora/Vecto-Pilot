// server/api/briefing/index.js - Barrel exports for briefing routes
// Briefing endpoints: weather, traffic, news, events, school closures

export { default as briefingRouter } from './briefing.js';
export { default as eventsRouter, phaseEmitter } from './events.js';

// Route summary:
// GET /api/briefing/weather/:snapshotId - Weather data
// GET /api/briefing/traffic/:snapshotId - Traffic conditions (TomTom + Claude analysis)
// GET /api/briefing/rideshare-news/:snapshotId - Rideshare news
// GET /api/briefing/events/:snapshotId - Local events
// GET /api/briefing/school-closures/:snapshotId - School closures
// GET /events - SSE stream for real-time updates
