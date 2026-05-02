// 2026-05-02: Workstream 6 Step 1 commit 9/11 — Phase 1 shim (aggregator inversion).
// All orchestration logic moved to ./briefing-aggregator.js. All per-pipeline data
// fetching lives in ./pipelines/{schools,weather,airport,news,traffic,events}.js.
//
// This file is now a pure re-export facade. It preserves the exact module.exports
// contract that briefing-service.js previously had, plus (per Master Architect's
// Revision 1 — Facade Purity) the discoverX pipeline contracts. The defensive
// expansion covers any unseen test harness or debug script that might import
// the discoverX symbols directly from briefing-service.js.
//
// External callers (server/api/briefing/briefing.js, server/api/location/snapshot.js,
// server/api/location/location.js dynamic import, server/lib/briefing/dump-last-briefing.js)
// continue importing from this file in Phase 1 — no caller migration in this commit.
// Phase 2 (post-soak ≥7 days from prod deploy) will migrate them to direct imports
// from briefing-aggregator.js + pipelines/*.js, after which this shim can be deleted.
//
// Identity preservation: ESM re-exports are bindings, not copies. Two callers
// reaching generateAndStoreBriefing — one via this shim, one direct from the
// aggregator — observe the SAME function, the SAME inFlightBriefings Map, and
// therefore the SAME concurrency dedup. Verified via dynamic-import identity test.

// Orchestration entry points (from aggregator)
export {
  generateAndStoreBriefing,
  getBriefingBySnapshotId,
  getOrGenerateBriefing,
  refreshEventsInBriefing,
} from './briefing-aggregator.js';

// Pipeline contracts (Revision 1 — Facade Purity) + legacy fetch* surface.
// Each line re-exports BOTH the new discoverX pipeline contract AND the legacy
// fetch* function (where applicable) from the underlying pipeline module.
export { discoverSchools, fetchSchoolClosures } from './pipelines/schools.js';
export { discoverWeather, fetchWeatherConditions } from './pipelines/weather.js';
export { discoverAirport } from './pipelines/airport.js';
export { discoverNews, fetchRideshareNews } from './pipelines/news.js';
export { discoverTraffic, fetchTrafficConditions } from './pipelines/traffic.js';
export { discoverEvents, fetchEventsForBriefing, deduplicateEvents, filterInvalidEvents } from './pipelines/events.js';
