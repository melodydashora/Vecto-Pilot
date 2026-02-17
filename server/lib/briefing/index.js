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

// Event cleanup (2026-02-17: past event deactivation)
export { deactivatePastEvents } from './cleanup-events.js';

// Module summary:
// - briefing-service.js: Main briefing orchestrator (Gemini + TomTom + Claude)
// - cleanup-events.js: Soft-deactivate past events per-snapshot
