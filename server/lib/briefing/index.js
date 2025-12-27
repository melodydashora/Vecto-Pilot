// server/lib/briefing/index.js - Barrel exports for briefing module
// Briefing generation: weather, traffic, events, news

// Main briefing service
export {
  generateAndStoreBriefing,
  getOrGenerateBriefing,
  fetchTrafficBriefing,
  fetchEventsBriefing,
  fetchNewsBriefing
} from './briefing-service.js';

// Event validation
export { validateEventSchedule } from './event-schedule-validator.js';

// Module summary:
// - briefing-service.js: Main briefing orchestrator (Gemini + TomTom + Claude)
// - event-schedule-validator.js: Verify event schedules with web search
