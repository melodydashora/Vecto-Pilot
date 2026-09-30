// Retired September 29, 2026. Gateway stopped starting this job in February.
// Keep an explicit failure for old manual entry points; no legacy cleanup,
// provider calls, DB initialization or scheduler survives here.
import { pathToFileURL } from 'node:url';
import { retiredEventSync, RETIRED_EVENT_SYNC_MESSAGE } from '../scripts/sync-events.mjs';

export function startEventSyncJob() { return retiredEventSync(); }
export function stopEventSyncJob() { /* Retired: no timer or run exists to stop. */ }

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.error(RETIRED_EVENT_SYNC_MESSAGE);
  process.exitCode = 1;
}
