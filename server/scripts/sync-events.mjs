// Retired September 29, 2026 after source/caller trace: no active runtime callers.
// Current event discovery is the admitted Briefing pipeline; this legacy module
// bypassed its timezone, coordinate, provider and atomic-write contracts.
// Recovery/provenance: docs/architecture/removals/2026-09-29-independent-pipelines.md
import { pathToFileURL } from 'node:url';

export const RETIRED_EVENT_SYNC_MESSAGE = 'Legacy event sync is retired. Use the admitted MAIN Briefing event discovery flow; see docs/architecture/ai-pipeline.md.';
export function retiredEventSync() {
  const error = new Error(RETIRED_EVENT_SYNC_MESSAGE);
  error.code = 'legacy_event_sync_retired';
  throw error;
}

// Fail explicitly for saved scripts/imports instead of silently invoking a stale
// writer. No database, credentials, provider, environment-loader or timer imports.
export {
  retiredEventSync as syncEventsForLocation,
  retiredEventSync as searchWithSerpAPI,
  retiredEventSync as searchWithGPT52,
  retiredEventSync as searchWithGoogleSearch,
  retiredEventSync as searchWithClaude,
  retiredEventSync as searchWithPerplexityReasoning,
  retiredEventSync as generateEventHash,
  retiredEventSync as storeEvents,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.error(RETIRED_EVENT_SYNC_MESSAGE);
  process.exitCode = 1;
}
