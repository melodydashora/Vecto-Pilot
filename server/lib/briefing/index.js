// server/lib/briefing/index.js - Barrel exports for briefing module
// Briefing generation: weather, traffic, events, news

// Main briefing service
// 2026-04-04: FIX C-1 — Export names must match actual function names in briefing-service.js
// Previously exported non-existent names (fetchTrafficBriefing, fetchEventsBriefing, fetchNewsBriefing)
export {
  generateAndStoreBriefing,
  getOrGenerateBriefing,
  fetchTrafficConditions,
  fetchEventsForBriefing,
  fetchRideshareNews
} from './briefing-service.js';

// Event cleanup (2026-02-17: past event deactivation)
export { deactivatePastEvents } from './cleanup-events.js';

// Module summary:
// - briefing-service.js: Main briefing orchestrator (Gemini + TomTom + Claude)
// - cleanup-events.js: Soft-deactivate past events per-snapshot
