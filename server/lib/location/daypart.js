/**
 * server/lib/location/daypart.js
 *
 * 2026-07-06: All daypart/time-context logic moved to shared/dayparts.js —
 * the single adapter used by BOTH server and client (the client imports it
 * via the `@shared` alias in client/src/lib/daypart.ts). This file re-exports
 * it so existing server imports keep working.
 *
 * Do not add time math here — extend shared/dayparts.js instead.
 *
 * @module server/lib/location/daypart
 */

export * from '../../../shared/dayparts.js';
